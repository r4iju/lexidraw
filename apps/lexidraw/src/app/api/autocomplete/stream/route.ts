import type { NextRequest } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import env from "@packages/env";
import { auth } from "~/server/auth";
import { recordLlmAudit } from "~/server/audit/llm-audit";
import { getEffectiveLlmConfig } from "~/server/llm/get-effective-config";
import {
  MAX_SUGGESTION_TOKENS,
  autocompletePrompt,
} from "~/server/llm/autocomplete";
import {
  createCredentialReference,
  generateAutocomplete,
} from "~/lib/generation/autocomplete";
import { createSdkTextTransport } from "~/lib/generation/sdk-text-transport";
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
    // Each consumed field is checked by text() before entering generation.
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
  } else if (cfg.provider === "openrouter" && env.OPENROUTER_API_KEY) {
    model = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY }).chat(
      cfg.modelId,
    );
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

  const credential = createCredentialReference();
  const suggestion = generateAutocomplete(
    {
      title: text(body.title),
      before,
      after: text(body.after),
      config: cfg,
      credential,
    },
    {
      transport: createSdkTextTransport((reference) => {
        if (reference !== credential)
          throw new Error("Unknown credential reference");
        return model;
      }),
      execution: { run: (start) => start(req.signal) },
      persistence: {
        finish: (usage) =>
          recordLlmAudit({
            ...audit,
            timestampMs: Date.now(),
            latencyMs: Date.now() - startedAt,
            usage: {
              promptTokens: usage.inputTokens,
              completionTokens: usage.outputTokens,
              totalTokens: usage.totalTokens,
            },
          }).catch(() => {}),
        error: (error) =>
          recordLlmAudit({
            ...audit,
            timestampMs: Date.now(),
            latencyMs: Date.now() - startedAt,
            usage: null,
            errorCode: "UpstreamError",
            errorMessage:
              error instanceof Error ? error.message : String(error),
          }).catch(() => {}),
      },
    },
  ).pipeThrough(new TextEncoderStream());
  return new Response(suggestion, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
