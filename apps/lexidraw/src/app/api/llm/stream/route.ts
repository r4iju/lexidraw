import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import { recordLlmAudit } from "~/server/audit/llm-audit";
import env from "@packages/env";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  streamText,
  type FilePart,
  type TextPart,
  type ModelMessage,
  type LanguageModel,
} from "ai";
import { getEffectiveLlmConfig } from "~/server/llm/get-effective-config";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const contentType = req.headers.get("content-type") || "";
  const requestId = crypto.randomUUID();

  let system = "";
  let prompt = "";
  let temperature: number | undefined;
  const files: File[] = [];
  let entityId: string | undefined;

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      system = (form.get("system") ?? "").toString();
      prompt = (form.get("prompt") ?? "").toString();
      const e = form.get("entityId");
      if (typeof e === "string" && e) entityId = e;
      const t = form.get("temperature");
      if (typeof t === "string" && t) temperature = Number(t);
      const maybeFiles = form.getAll("files");
      for (const f of maybeFiles) {
        if (f instanceof File) files.push(f);
      }
    } else {
      const body = (await req.json()) as {
        system?: string;
        prompt?: string;
        temperature?: number;
        entityId?: string;
      };
      system = (body?.system ?? "").toString();
      prompt = (body?.prompt ?? "").toString();
      if (typeof body?.temperature === "number") temperature = body.temperature;
      if (typeof body?.entityId === "string") entityId = body.entityId;
    }
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  if (!prompt) {
    return new Response("Missing prompt", { status: 400 });
  }

  // Get effective config from policies (with user overrides)
  const chatCfg = await getEffectiveLlmConfig({
    mode: "chat",
    userConfig: session.user.config?.llm as {
      chat?: {
        provider: string;
        modelId: string;
        temperature: number;
        maxOutputTokens: number;
      };
    },
  });

  const effectiveTemperature =
    typeof temperature === "number" ? temperature : chatCfg.temperature;
  const effectiveMaxTokens = chatCfg.maxOutputTokens;

  const provider = chatCfg.provider;
  const modelId = chatCfg.modelId;

  // Use app-level API keys
  const openaiApiKey = env.OPENAI_API_KEY;
  const googleApiKey = env.GOOGLE_API_KEY;

  let model: ReturnType<
    | ReturnType<typeof createOpenAI>
    | ReturnType<typeof createGoogleGenerativeAI>
  > | null = null;
  if (provider === "openai") {
    if (!openaiApiKey)
      return new Response("Missing OpenAI API key", { status: 400 });
    const openai = createOpenAI({ apiKey: openaiApiKey });
    model = openai(modelId);
  } else if (provider === "google") {
    if (!googleApiKey)
      return new Response("Missing Google API key", { status: 400 });
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    model = google(modelId);
  } else {
    return new Response("Unsupported provider", { status: 400 });
  }

  // Prepare input
  async function toFileParts(f: File[]): Promise<FilePart[]> {
    const parts: FilePart[] = [];
    for (const file of f) {
      const buf = new Uint8Array(await file.arrayBuffer());
      parts.push({
        type: "file",
        data: buf,
        mediaType: file.type || "application/octet-stream",
        filename: file.name,
      });
    }
    return parts;
  }

  const hasFiles = files.length > 0;
  let input: { prompt?: string; messages?: ModelMessage[] } = { prompt };
  if (hasFiles) {
    const fileParts = await toFileParts(files);
    const parts: (TextPart | FilePart)[] = [
      { type: "text", text: prompt },
      ...fileParts,
    ];
    input = { messages: [{ role: "user", content: parts }] };
  }

  try {
    const startedAt = Date.now();
    const result = streamText({
      model: model as unknown as LanguageModel,
      ...(input.messages
        ? { messages: input.messages }
        : { prompt: input.prompt ?? "" }),
      system,
      temperature: effectiveTemperature,
      maxOutputTokens: effectiveMaxTokens,
      abortSignal: req.signal,
    });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const delta of result.fullStream) {
            if (delta.type === "text-delta") {
              controller.enqueue(encoder.encode(`data: ${delta.text}\n\n`));
            } else if (delta.type === "error") {
              const msg = (delta as { error?: unknown }).error;
              controller.enqueue(
                encoder.encode(
                  `event: error\ndata: ${JSON.stringify({ message: String(msg ?? "error") })}\n\n`,
                ),
              );
            }
          }
          controller.enqueue(encoder.encode("event: finish\ndata: done\n\n"));
        } catch (e) {
          // On unexpected errors
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({ message: e instanceof Error ? e.message : String(e) })}\n\n`,
            ),
          );
        } finally {
          try {
            controller.close();
          } catch {}
          // Persist audit at end of stream
          try {
            const usage = (await result.usage) as
              | {
                  promptTokens?: number;
                  completionTokens?: number;
                  totalTokens?: number;
                  inputTokens?: number;
                  outputTokens?: number;
                }
              | undefined;
            await recordLlmAudit({
              requestId,
              timestampMs: Date.now(),
              route: "/api/llm/stream",
              mode: "chat",
              userId: session.user.id,
              entityId: entityId ?? null,
              provider,
              modelId,
              temperature: effectiveTemperature,
              maxOutputTokens: effectiveMaxTokens,
              usage: usage
                ? {
                    promptTokens: usage.promptTokens ?? usage.inputTokens ?? 0,
                    completionTokens:
                      usage.completionTokens ?? usage.outputTokens ?? 0,
                    totalTokens:
                      usage.totalTokens ??
                      (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
                  }
                : null,
              latencyMs: Math.max(0, Date.now() - startedAt),
              stream: true,
              promptLen: input.prompt ? input.prompt.length : undefined,
              messagesCount: input.messages ? input.messages.length : undefined,
            });
          } catch {}
        }
      },
    });

    const response = new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Request-Id": requestId,
      },
    });
    return response;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      await recordLlmAudit({
        requestId,
        timestampMs: Date.now(),
        route: "/api/llm/stream",
        mode: "chat",
        userId: session.user.id,
        entityId: entityId ?? null,
        provider,
        modelId,
        temperature: effectiveTemperature,
        maxOutputTokens: effectiveMaxTokens,
        usage: null,
        latencyMs: 0,
        stream: true,
        errorCode: "AbortError",
        errorMessage: "client aborted",
        httpStatus: 499,
      }).catch(() => {});
      return new Response(null, { status: 499 });
    }
    await recordLlmAudit({
      requestId,
      timestampMs: Date.now(),
      route: "/api/llm/stream",
      mode: "chat",
      userId: session.user.id,
      entityId: entityId ?? null,
      provider,
      modelId,
      temperature: effectiveTemperature,
      maxOutputTokens: effectiveMaxTokens,
      usage: null,
      latencyMs: 0,
      stream: true,
      errorCode: "UpstreamError",
      errorMessage: e instanceof Error ? e.message : String(e),
      httpStatus: 502,
    }).catch(() => {});
    return new Response("Upstream error", { status: 502 });
  }
}
