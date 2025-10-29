import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import env from "@packages/env";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, tool, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  system: z.string().optional(),
  prompt: z.string().optional(),
  messages: z.array(z.any()).optional(),
  temperature: z.number().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  tools: z.array(z.string()).default([]),
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
  const section =
    session.user.config?.llm?.agent ?? session.user.config?.llm?.chat;
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
  const effectiveMaxTokens =
    typeof parsed.maxOutputTokens === "number"
      ? parsed.maxOutputTokens
      : cfg.maxOutputTokens;

  // Build permissive tool schemas on the server (args validated client-side)
  const toolMap = Object.fromEntries(
    parsed.tools.map((name) => [
      name,
      tool({
        description: `Remote-executed tool: ${name}`,
        inputSchema: z.record(z.string(), z.any()).default({}),
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
    const result = await generateText({
      model: model as unknown as LanguageModel,
      ...(hasMessages ? { messages } : { prompt }),
      system,
      temperature: effectiveTemperature,
      maxOutputTokens: effectiveMaxTokens,
      // Enable tool calls; client will execute them and call again if needed
      tools: toolMap,
      toolChoice: "auto",
    });

    const toolCalls = (result.toolCalls ?? []).map((c) => ({
      toolCallId: c.toolCallId,
      toolName: c.toolName,
      // @ts-expect-error structured input provided by model
      input: (c as unknown as { input?: Record<string, unknown> }).input ?? {},
    }));

    return Response.json({ text: result.text, toolCalls });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg || "Agent generation error", { status: 500 });
  }
}
