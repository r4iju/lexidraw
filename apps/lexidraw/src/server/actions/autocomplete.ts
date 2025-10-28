"use server";

import { auth } from "~/server/auth";

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
  const resolvedModelId = (modelId || ac.modelId || "gpt-5-nano").toString();
  const resolvedTemperature =
    typeof temperature === "number"
      ? temperature
      : typeof ac.temperature === "number"
        ? ac.temperature
        : 0.3;
  const resolvedMaxTokens =
    typeof maxOutputTokens === "number"
      ? maxOutputTokens
      : typeof ac.maxOutputTokens === "number"
        ? ac.maxOutputTokens
        : 400;
  const reasoningEffort =
    (ac.reasoningEffort as "minimal" | "standard" | "heavy" | undefined) ||
    "minimal";
  const verbosity =
    (ac.verbosity as "low" | "medium" | "high" | undefined) || "low";

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

  let resp = await call(withTemp);
  if (!resp.ok) {
    try {
      const errText = await resp.text();
      if (errText.includes("Unsupported parameter: 'temperature'")) {
        resp = await call(withoutTemp);
      } else {
        throw new Error(errText || "OpenAI error");
      }
    } catch {
      // fall through to generic handling below
    }
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(errText || "OpenAI error");
  }

  const json = (await resp.json()) as {
    output?: Array<{
      type: string;
      content?: Array<{ type: string; text?: string }>;
    }>;
    output_text?: string;
  };

  if (typeof json.output_text === "string" && json.output_text) {
    return json.output_text;
  }

  let text = "";
  const out = Array.isArray(json.output) ? json.output : [];
  for (const part of out) {
    if (part?.type === "message" && Array.isArray(part.content)) {
      for (const c of part.content) {
        if (c?.type === "output_text" && typeof c.text === "string") {
          text += c.text;
        }
      }
    }
  }
  return text;
}
