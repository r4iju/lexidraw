"use server";

import { auth } from "~/server/auth";
import { recordLlmAudit, withTiming } from "~/server/audit/llm-audit";
import { getEffectiveLlmConfig } from "~/server/llm/get-effective-config";

type Params = {
  system: string;
  prompt: string;
  temperature?: number;
  maxOutputTokens?: number;
  modelId?: string;
};

export async function runAutocomplete({
  system,
  prompt,
  temperature,
  maxOutputTokens,
  modelId,
}: Params): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  const ac = session.user.config?.autocomplete ?? {};
  if ((ac as { enabled?: boolean }).enabled === false) {
    return "";
  }

  // Get effective config from policies (with user overrides)
  const cfg = await getEffectiveLlmConfig({
    mode: "autocomplete",
    userConfig: {
      autocomplete: {
        provider: ac.provider,
        modelId: ac.modelId,
        temperature: ac.temperature,
        maxOutputTokens: ac.maxOutputTokens,
        extraConfig:
          ac.reasoningEffort || ac.verbosity
            ? {
                reasoningEffort: ac.reasoningEffort,
                verbosity: ac.verbosity,
              }
            : undefined,
      },
    },
  });

  const resolvedModelId = (modelId || cfg.modelId).toString();
  const resolvedTemperature =
    typeof temperature === "number" ? temperature : cfg.temperature;
  const resolvedMaxTokens =
    typeof maxOutputTokens === "number" ? maxOutputTokens : cfg.maxOutputTokens;
  const reasoningEffort =
    (ac.reasoningEffort as "minimal" | "standard" | "heavy" | undefined) ||
    (cfg.extraConfig?.reasoningEffort as
      | "minimal"
      | "standard"
      | "heavy"
      | undefined) ||
    "minimal";
  const verbosity =
    (ac.verbosity as "low" | "medium" | "high" | undefined) ||
    (cfg.extraConfig?.verbosity as "low" | "medium" | "high" | undefined) ||
    "low";

  const openaiApiKey =
    session.user.config?.llm?.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("Missing OpenAI API key");
  }

  const base = {
    model: resolvedModelId,
    input: [
      { role: "developer", content: system },
      { role: "user", content: [{ type: "input_text", text: prompt }] },
    ],
    reasoning: { effort: reasoningEffort },
    text: { verbosity },
    tool_choice: "none" as const,
    parallel_tool_calls: false,
    max_output_tokens: resolvedMaxTokens,
  };
  const withTemp = { ...base, temperature: resolvedTemperature } as const;
  const withoutTemp = { ...base } as const;

  if (process.env.NEXT_PUBLIC_LLM_DEBUG === "1") {
    console.log("[autocomplete][sa]", {
      model: withTemp.model,
      temperature: withTemp.temperature,
      max_output_tokens: withTemp.max_output_tokens,
      reasoning: withTemp.reasoning,
      text: withTemp.text,
      tool_choice: withTemp.tool_choice,
      parallel_tool_calls: withTemp.parallel_tool_calls,
      sysLen: system.length,
      promptLen: prompt.length,
    });
  }

  async function call(payload: unknown) {
    return fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  }

  let measured = await withTiming(() => call(withTemp));
  let resp = measured.result;
  let elapsedMs = measured.elapsedMs;
  if (!resp.ok) {
    try {
      const errText = await resp.text();
      if (errText.includes("Unsupported parameter: 'temperature'")) {
        measured = await withTiming(() => call(withoutTemp));
        resp = measured.result;
        elapsedMs = measured.elapsedMs;
      } else {
        throw new Error(errText || "OpenAI error");
      }
    } catch {
      // fall through to generic handling below
    }
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    await recordLlmAudit({
      requestId: crypto.randomUUID(),
      timestampMs: Date.now(),
      route: "server/actions/autocomplete",
      mode: "autocomplete",
      userId: session.user.id,
      entityId: null,
      provider: cfg.provider,
      modelId: resolvedModelId,
      temperature: resolvedTemperature,
      maxOutputTokens: resolvedMaxTokens,
      usage: null,
      latencyMs: Math.round(elapsedMs),
      stream: false,
      errorCode: "UpstreamError",
      errorMessage: errText,
      httpStatus: resp.status,
    }).catch(() => {});
    throw new Error(errText || "OpenAI error");
  }

  const json = (await resp.json()) as {
    output?: Array<{
      type: string;
      content?: Array<{ type: string; text?: string }>;
    }>;
    output_text?: string;
  };

  const text =
    typeof json.output_text === "string" && json.output_text
      ? json.output_text
      : (() => {
          let t = "";
          const out = Array.isArray(json.output) ? json.output : [];
          for (const part of out) {
            if (part?.type === "message" && Array.isArray(part.content)) {
              for (const c of part.content) {
                if (c?.type === "output_text" && typeof c.text === "string") {
                  t += c.text;
                }
              }
            }
          }
          return t;
        })();

  await recordLlmAudit({
    requestId: crypto.randomUUID(),
    timestampMs: Date.now(),
    route: "server/actions/autocomplete",
    mode: "autocomplete",
    userId: session.user.id,
    entityId: null,
    provider: cfg.provider,
    modelId: resolvedModelId,
    temperature: resolvedTemperature,
    maxOutputTokens: resolvedMaxTokens,
    usage: null, // Responses API doesn't include classic token usage here reliably
    latencyMs: Math.round(elapsedMs),
    stream: false,
    promptLen: system.length + prompt.length,
    messagesCount: undefined,
  }).catch(() => {});

  return text;
}
