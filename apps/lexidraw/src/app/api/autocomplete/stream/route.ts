import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import { getEffectiveLlmConfig } from "~/server/llm/get-effective-config";
import env from "@packages/env";

type Body = {
  system?: string;
  prompt?: string;
  temperature?: number;
  maxOutputTokens?: number;
  modelId?: string;
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
  const prompt = (body?.prompt ?? "").toString();
  if (!prompt) {
    return new Response("Missing prompt", { status: 400 });
  }

  const ac = session.user.config?.autocomplete ?? {};
  if ((ac as { enabled?: boolean }).enabled === false) {
    return new Response(null, { status: 204 });
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

  const resolvedModelId = (body?.modelId || cfg.modelId).toString();
  const resolvedTemperature =
    typeof body?.temperature === "number" ? body?.temperature : cfg.temperature;
  const resolvedMaxTokens =
    typeof body?.maxOutputTokens === "number"
      ? body?.maxOutputTokens
      : cfg.maxOutputTokens;
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

  const openaiApiKey = env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return new Response(
      "Missing OpenAI API key. Please set OPENAI_API_KEY environment variable.",
      { status: 400 },
    );
  }

  const upstreamController = new AbortController();
  // Propagate client aborts to upstream OpenAI request
  try {
    req.signal.addEventListener("abort", () => {
      upstreamController.abort();
    });
  } catch {}

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
    stream: true,
  } as const;
  const withTemp = { ...base, temperature: resolvedTemperature } as const;
  const withoutTemp = { ...base } as const;

  if (process.env.NEXT_PUBLIC_LLM_DEBUG === "1") {
    // Avoid logging prompt/system content in full
    console.log("[autocomplete][sse]", {
      model: withTemp.model,
      temperature: (withTemp as { temperature?: number }).temperature,
      max_output_tokens: withTemp.max_output_tokens,
      reasoning: withTemp.reasoning,
      text: withTemp.text,
      tool_choice: withTemp.tool_choice,
      parallel_tool_calls: withTemp.parallel_tool_calls,
      sysLen: system.length,
      promptLen: prompt.length,
    });
  }

  try {
    async function call(payload: unknown) {
      return fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify(payload),
        signal: upstreamController.signal,
      });
    }
    let upstream = await call(withTemp);
    if (!upstream.ok) {
      try {
        const err = await upstream.text();
        if (err.includes("Unsupported parameter: 'temperature'")) {
          upstream = await call(withoutTemp);
        }
      } catch {}
    }

    if (!upstream.ok || !upstream.body) {
      let err = "OpenAI error";
      try {
        err = await upstream.text();
      } catch {}
      return new Response(err || "OpenAI error", {
        status: upstream.status || 500,
      });
    }

    // Pass-through SSE from upstream to client
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const body = upstream.body;
        if (!body) {
          controller.close();
          return;
        }
        const reader = body.getReader();
        const forward = async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) controller.enqueue(value);
            }
          } catch {
            // Ignore abort errors
          } finally {
            try {
              controller.close();
            } catch {}
          }
        };
        forward();
      },
      cancel: () => {
        try {
          upstreamController.abort();
        } catch {}
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Next.js hints
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
