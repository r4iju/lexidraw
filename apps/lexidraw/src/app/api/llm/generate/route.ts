import type { NextRequest } from "next/server";
import { auth } from "~/server/auth";
import env from "@packages/env";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, type ModelMessage, type LanguageModel } from "ai";

export const dynamic = "force-dynamic";

type Body = {
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  mode?: "chat" | "agent";
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
  const section =
    session.user.config?.llm?.[mode] ?? session.user.config?.llm?.chat;
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
    typeof body?.temperature === "number" ? body.temperature : cfg.temperature;
  const effectiveMaxTokens =
    typeof body?.maxOutputTokens === "number"
      ? body.maxOutputTokens
      : cfg.maxOutputTokens;

  const provider = cfg.provider;
  const modelId = cfg.modelId;

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

  try {
    const result = await generateText({
      model: model as unknown as LanguageModel,
      ...(hasMessages && inputMessages
        ? { messages: inputMessages }
        : { prompt }),
      system,
      temperature: effectiveTemperature,
      maxOutputTokens: effectiveMaxTokens,
    });

    return Response.json({ text: result.text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(msg || "Generation error", { status: 500 });
  }
}
