import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
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

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const contentType = req.headers.get("content-type") || "";

  let system = "";
  let prompt = "";
  let temperature: number | undefined;
  let maxOutputTokens: number | undefined;
  let files: File[] = [];

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      system = (form.get("system") ?? "").toString();
      prompt = (form.get("prompt") ?? "").toString();
      const t = form.get("temperature");
      const m = form.get("maxOutputTokens");
      if (typeof t === "string" && t) temperature = Number(t);
      if (typeof m === "string" && m) maxOutputTokens = Number(m);
      const maybeFiles = form.getAll("files");
      for (const f of maybeFiles) {
        if (f instanceof File) files.push(f);
      }
    } else {
      const body = (await req.json()) as {
        system?: string;
        prompt?: string;
        temperature?: number;
        maxOutputTokens?: number;
      };
      system = (body?.system ?? "").toString();
      prompt = (body?.prompt ?? "").toString();
      if (typeof body?.temperature === "number") temperature = body.temperature;
      if (typeof body?.maxOutputTokens === "number")
        maxOutputTokens = body.maxOutputTokens;
    }
  } catch {
    return new Response("Invalid request body", { status: 400 });
  }

  if (!prompt) {
    return new Response("Missing prompt", { status: 400 });
  }

  const chatCfg = (session.user.config?.llm?.chat ?? {
    modelId: "gemini-2.5-flash",
    provider: "google",
    temperature: 0.7,
    maxOutputTokens: 100000,
  }) as {
    modelId: string;
    provider: string;
    temperature: number;
    maxOutputTokens: number;
  };

  const effectiveTemperature =
    typeof temperature === "number" ? temperature : chatCfg.temperature;
  const effectiveMaxTokens =
    typeof maxOutputTokens === "number"
      ? maxOutputTokens
      : chatCfg.maxOutputTokens;

  const provider = chatCfg.provider;
  const modelId = chatCfg.modelId;

  // Resolve API keys (user-provided overrides app env)
  const openaiApiKey =
    session.user.config?.llm?.openaiApiKey || env.OPENAI_API_KEY;
  const googleApiKey =
    session.user.config?.llm?.googleApiKey || env.GOOGLE_API_KEY;

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
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return new Response(null, { status: 499 });
    }
    return new Response("Upstream error", { status: 502 });
  }
}
