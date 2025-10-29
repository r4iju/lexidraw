import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import env from "@packages/env";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, tool, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { recordLlmAudit, withTiming } from "~/server/audit/llm-audit";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  system: z.string().optional(),
  prompt: z.string().optional(),
  messages: z.array(z.any()).optional(),
  temperature: z.number().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  tools: z.array(z.string()).default([]),
  entityId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const system = (parsed.system ?? "").toString();
  const hasMessages =
    Array.isArray(parsed.messages) && parsed.messages.length > 0;
  const prompt = (parsed.prompt ?? (hasMessages ? "" : "")).toString();
  const messages = (parsed.messages as ModelMessage[] | undefined) || undefined;
  if (!hasMessages && !prompt) {
    return new Response("Missing prompt or messages", { status: 400 });
  }

  // Use agent config if present, fall back to chat
  const llmCfg = (session.user.config?.llm ?? {}) as unknown as {
    agent?: {
      modelId: string;
      provider: string;
      temperature: number;
      maxOutputTokens: number;
    };
    chat?: {
      modelId: string;
      provider: string;
      temperature: number;
      maxOutputTokens: number;
    };
  };
  const section = llmCfg.agent ?? llmCfg.chat;
  const cfg = (section ?? {
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
    typeof parsed.temperature === "number"
      ? parsed.temperature
      : cfg.temperature;
  const effectiveMaxTokens = cfg.maxOutputTokens;

  // Build permissive tool schemas on the server (args validated client-side)
  // NOTE: OpenAI function schema requires at least one defined property.
  // We expose a single optional property "args" to carry arbitrary input.
  const toolMap = Object.fromEntries(
    parsed.tools.map((name) => [
      name,
      tool({
        description: `Remote-executed tool: ${name}`,
        inputSchema: z.object({
          args: z.record(z.string(), z.any()).optional(),
        }),
      }),
    ]),
  );

  // Resolve provider and model
  const provider = cfg.provider;
  const modelId = cfg.modelId;
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

  try {
    const input = hasMessages
      ? { messages: messages as ModelMessage[] }
      : { prompt };
    const { result, elapsedMs } = await withTiming(() =>
      generateText({
        model: model as unknown as LanguageModel,
        ...input,
        system,
        temperature: effectiveTemperature,
        maxOutputTokens: effectiveMaxTokens,
        // Enable tool calls; client will execute them and call again if needed
        tools: toolMap,
        toolChoice: "auto",
      }),
    );

    const toolCalls = (result.toolCalls ?? []).map((c) => {
      const rawInput = (c as unknown as { input?: Record<string, unknown> })
        .input;
      const input =
        rawInput && typeof rawInput === "object" && "args" in rawInput
          ? ((rawInput as { args?: Record<string, unknown> }).args ?? {})
          : (rawInput ?? {});
      return {
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        input,
      };
    });

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
      requestId: crypto.randomUUID(),
      timestampMs: Date.now(),
      route: "/api/llm/agent",
      mode: "agent",
      userId: session.user.id,
      entityId: parsed.entityId ?? null,
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
      toolCalls: toolCalls.length
        ? Object.entries(
            toolCalls.reduce<Record<string, number>>((acc, c) => {
              acc[c.toolName] = (acc[c.toolName] || 0) + 1;
              return acc;
            }, {}),
          ).map(([name, count]) => ({ name, count }))
        : undefined,
      promptLen: hasMessages ? undefined : prompt.length,
      messagesCount: hasMessages ? messages?.length : undefined,
    });

    return Response.json({ text: result.text, toolCalls });
  } catch (e) {
    await recordLlmAudit({
      requestId: crypto.randomUUID(),
      timestampMs: Date.now(),
      route: "/api/llm/agent",
      mode: "agent",
      userId: session.user.id,
      entityId: parsed.entityId ?? null,
      provider,
      modelId,
      temperature: effectiveTemperature,
      maxOutputTokens: effectiveMaxTokens,
      usage: null,
      latencyMs: 0,
      stream: false,
      errorCode: "AgentError",
      errorMessage: e instanceof Error ? e.message : String(e),
      httpStatus: 500,
    }).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg || "Agent generation error", { status: 500 });
  }
}
