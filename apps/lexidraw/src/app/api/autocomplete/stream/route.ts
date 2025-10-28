import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";

export const dynamic = "force-dynamic";

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
  const resolvedModelId = (body?.modelId || ac.modelId || "gpt-5-nano").toString();
  const resolvedTemperature =
    typeof body?.temperature === "number"
      ? body?.temperature
      : typeof ac.temperature === "number"
        ? ac.temperature
        : 0.3;
  const resolvedMaxTokens =
    typeof body?.maxOutputTokens === "number"
      ? body?.maxOutputTokens
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
    return new Response("Missing OpenAI API key", { status: 400 });
  }

  const upstreamController = new AbortController();
  // Propagate client aborts to upstream OpenAI request
  try {
    req.signal.addEventListener("abort", () => {
      upstreamController.abort();
    });
  } catch {}

  const payload = {
    model: resolvedModelId,
    input: [
      { role: "developer", content: system },
      { role: "user", content: [{ type: "input_text", text: prompt }] },
    ],
    reasoning: { effort: reasoningEffort },
    text: { verbosity },
    tool_choice: "none" as const,
    parallel_tool_calls: false,
    temperature: resolvedTemperature,
    max_output_tokens: resolvedMaxTokens,
    stream: true,
  } as const;

  if (process.env.NEXT_PUBLIC_LLM_DEBUG === "1") {
    // Avoid logging prompt/system content in full
    console.log("[autocomplete][sse]", {
      model: payload.model,
      temperature: payload.temperature,
      max_output_tokens: payload.max_output_tokens,
      reasoning: payload.reasoning,
      text: payload.text,
      tool_choice: payload.tool_choice,
      parallel_tool_calls: payload.parallel_tool_calls,
      sysLen: system.length,
      promptLen: prompt.length,
    });
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(payload),
      signal: upstreamController.signal,
    });

    if (!upstream.ok || !upstream.body) {
      let err = "OpenAI error";
      try {
        err = await upstream.text();
      } catch {}
      return new Response(err || "OpenAI error", { status: upstream.status || 500 });
    }

    // Pass-through SSE from upstream to client
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        const reader = upstream.body!.getReader();
        const forward = async () => {
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) controller.enqueue(value);
            }
          } catch (e) {
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


