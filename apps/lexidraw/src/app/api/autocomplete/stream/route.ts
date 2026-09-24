import type { NextRequest } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { streamText, type LanguageModel } from "ai";
import env from "@packages/env";
import { auth } from "~/server/auth";
import { recordLlmAudit } from "~/server/audit/llm-audit";
import { getEffectiveLlmConfig } from "~/server/llm/get-effective-config";
import {
  AUTOCOMPLETE_SYSTEM,
  MAX_SUGGESTION_TOKENS,
  autocompletePrompt,
  lowestReasoning,
} from "~/server/llm/autocomplete";
import { generateUUID } from "~/lib/utils";

type Body = {
  title?: unknown;
  before?: unknown;
  after?: unknown;
  entityId?: unknown;
};

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * Streams the text to show after the cursor, as plain text. The prompt and
 * model are decided here so the route cannot be used as a general LLM proxy.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = session.user.id;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const before = text(body.before);
  if (!before.trim()) {
    return new Response("Missing text before the cursor", { status: 400 });
  }

  const ac = session.user.config?.autocomplete ?? {};
  if (ac.enabled === false) {
    return new Response(null, { status: 204 });
  }

  const cfg = await getEffectiveLlmConfig({
    mode: "autocomplete",
    userConfig: {
      autocomplete: {
        provider: ac.provider,
        modelId: ac.modelId,
        temperature: ac.temperature,
        maxOutputTokens: ac.maxOutputTokens,
      },
    },
  });

  let model: LanguageModel;
  if (cfg.provider === "openai" && env.OPENAI_API_KEY) {
    model = createOpenAI({ apiKey: env.OPENAI_API_KEY })(cfg.modelId);
  } else if (cfg.provider === "google" && env.GOOGLE_API_KEY) {
    model = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY })(
      cfg.modelId,
    );
  } else {
    return new Response(`No API key for provider ${cfg.provider}`, {
      status: 500,
    });
  }

  const maxOutputTokens = Math.min(cfg.maxOutputTokens, MAX_SUGGESTION_TOKENS);
  const prompt = autocompletePrompt({
    title: text(body.title),
    before,
    after: text(body.after),
  });
  const entityId = text(body.entityId) || null;
  const startedAt = Date.now();
  const audit = {
    requestId: generateUUID(),
    route: "/api/autocomplete/stream",
    mode: "autocomplete",
    userId,
    entityId,
    provider: cfg.provider,
    modelId: cfg.modelId,
    temperature: cfg.temperature,
    maxOutputTokens,
    stream: true,
    promptLen: prompt.length,
  } as const;

  const result = streamText({
    model,
    system: AUTOCOMPLETE_SYSTEM,
    prompt,
    temperature: cfg.temperature,
    maxOutputTokens,
    // A retried suggestion arrives after the user has typed past it.
    maxRetries: 0,
    providerOptions: lowestReasoning(cfg.provider, cfg.modelId),
    abortSignal: req.signal,
    onFinish: ({ totalUsage }) =>
      recordLlmAudit({
        ...audit,
        timestampMs: Date.now(),
        latencyMs: Date.now() - startedAt,
        usage: {
          promptTokens: totalUsage.inputTokens ?? 0,
          completionTokens: totalUsage.outputTokens ?? 0,
          totalTokens: totalUsage.totalTokens ?? 0,
        },
      }).catch(() => {}),
    onError: ({ error }) =>
      recordLlmAudit({
        ...audit,
        timestampMs: Date.now(),
        latencyMs: Date.now() - startedAt,
        usage: null,
        errorCode: "UpstreamError",
        errorMessage: error instanceof Error ? error.message : String(error),
      }).catch(() => {}),
  });

  return result.toTextStreamResponse({
    headers: { "Cache-Control": "no-cache, no-transform" },
  });
}
