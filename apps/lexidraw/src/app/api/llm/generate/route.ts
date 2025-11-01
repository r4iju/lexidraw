import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import env from "@packages/env";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, type ModelMessage, type LanguageModel } from "ai";
import { recordLlmAudit, withTiming } from "~/server/audit/llm-audit";
import { getEffectiveLlmConfig } from "~/server/llm/get-effective-config";
import { generateUUID } from "~/lib/utils";

export const dynamic = "force-dynamic";

type Body = {
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  mode?: "chat" | "agent";
  entityId?: string;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: Body | null = null;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const system = (body?.system ?? "").toString();
  const inputMessages = Array.isArray(body?.messages)
    ? (body?.messages as ModelMessage[])
    : undefined;
  const hasMessages = Array.isArray(inputMessages) && inputMessages.length > 0;
  const prompt = (body?.prompt ?? (hasMessages ? "" : "")).toString();
  if (!hasMessages && !prompt) {
    return new Response("Missing prompt or messages", { status: 400 });
  }

  const mode = (body?.mode === "agent" ? "agent" : "chat") as "chat" | "agent";

  // Get effective config from policies (with user overrides)
  const cfg = await getEffectiveLlmConfig({
    mode,
    userConfig: session.user.config?.llm as {
      chat?: {
        provider: string;
        modelId: string;
        temperature: number;
        maxOutputTokens: number;
      };
      agent?: {
        provider: string;
        modelId: string;
        temperature: number;
        maxOutputTokens: number;
      };
    },
  });

  const effectiveTemperature =
    typeof body?.temperature === "number" ? body.temperature : cfg.temperature;
  const effectiveMaxTokens = cfg.maxOutputTokens;

  const provider = cfg.provider;
  const modelId = cfg.modelId;

  // Use app-level API keys
  const openaiApiKey = env.OPENAI_API_KEY;
  const googleApiKey = env.GOOGLE_API_KEY;

  let model: ReturnType<
    | ReturnType<typeof createOpenAI>
    | ReturnType<typeof createGoogleGenerativeAI>
  > | null = null;
  if (provider === "openai") {
    if (!openaiApiKey) {
      return new Response(
        "Missing OpenAI API key. Please set OPENAI_API_KEY environment variable.",
        { status: 400 },
      );
    }
    const openai = createOpenAI({ apiKey: openaiApiKey });
    model = openai(modelId);
  } else if (provider === "google") {
    if (!googleApiKey) {
      return new Response(
        "Missing Google API key. Please set GOOGLE_API_KEY environment variable.",
        { status: 400 },
      );
    }
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    model = google(modelId);
  } else {
    return new Response("Unsupported provider", { status: 400 });
  }

  try {
    const { result, elapsedMs } = await withTiming(() =>
      generateText({
        model: model as unknown as LanguageModel,
        ...(hasMessages && inputMessages
          ? { messages: inputMessages }
          : { prompt }),
        system,
        temperature: effectiveTemperature,
        maxOutputTokens: effectiveMaxTokens,
      }),
    );

    const usage = result.usage as
      | {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
          inputTokens?: number;
          outputTokens?: number;
        }
      | undefined;
    await recordLlmAudit({
      requestId: generateUUID(),
      timestampMs: Date.now(),
      route: "/api/llm/generate",
      mode,
      userId: session.user.id,
      entityId: body.entityId ?? null,
      provider,
      modelId,
      temperature: effectiveTemperature,
      maxOutputTokens: effectiveMaxTokens,
      usage: usage
        ? {
            promptTokens: usage.promptTokens ?? usage.inputTokens ?? 0,
            completionTokens: usage.completionTokens ?? usage.outputTokens ?? 0,
            totalTokens:
              usage.totalTokens ??
              (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          }
        : null,
      latencyMs: Math.round(elapsedMs),
      stream: false,
      promptLen: hasMessages ? undefined : prompt.length,
      messagesCount: hasMessages ? inputMessages?.length : undefined,
    });

    return Response.json({ text: result.text });
  } catch (e) {
    await recordLlmAudit({
      requestId: generateUUID(),
      timestampMs: Date.now(),
      route: "/api/llm/generate",
      mode,
      userId: session.user.id,
      entityId: body.entityId ?? null,
      provider,
      modelId,
      temperature: effectiveTemperature,
      maxOutputTokens: effectiveMaxTokens,
      usage: null,
      latencyMs: 0,
      stream: false,
      errorCode: "GenerationError",
      errorMessage: e instanceof Error ? e.message : String(e),
      httpStatus: 500,
    }).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg || "Generation error", { status: 500 });
  }
}
