import "server-only";

import type { ModelMessage, LanguageModel } from "ai";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { z } from "zod";
import env from "@packages/env";
import type { EffectiveLlmConfig } from "~/server/llm/get-effective-config";

export interface DecisionStepArgs {
  messages: ModelMessage[];
  system: string;
  config: EffectiveLlmConfig;
  priorAssistantText?: string;
}

export interface DecisionStepResult {
  decision: "summarize" | "planNext";
  summary?: string;
}

export async function decisionStep(
  args: DecisionStepArgs,
): Promise<DecisionStepResult> {
  "use step";

  const { messages, system, config, priorAssistantText } = args;

  // Create model instance
  const openaiApiKey = env.OPENAI_API_KEY;
  const googleApiKey = env.GOOGLE_API_KEY;

  let model: ReturnType<
    | ReturnType<typeof createOpenAI>
    | ReturnType<typeof createGoogleGenerativeAI>
  > | null = null;

  if (config.provider === "openai") {
    if (!openaiApiKey) {
      throw new Error("Missing OpenAI API key");
    }
    const openai = createOpenAI({ apiKey: openaiApiKey });
    model = openai(config.modelId);
  } else if (config.provider === "google") {
    if (!googleApiKey) {
      throw new Error("Missing Google API key");
    }
    const google = createGoogleGenerativeAI({ apiKey: googleApiKey });
    model = google(config.modelId);
  } else {
    throw new Error(`Unsupported provider: ${config.provider}`);
  }

  // Build decision messages
  const decisionMessages: ModelMessage[] = [
    ...messages,
    ...(priorAssistantText
      ? [{ role: "assistant" as const, content: priorAssistantText }]
      : []),
    {
      role: "user" as const,
      content:
        "Choose exactly one action next:\n1) summarizeAfterToolCallExecution\n2) planNextToolSelection",
    },
  ];

  const decisionSystem = `${system}\n\nYou are in a decision step. Choose exactly one: summarizeAfterToolCallExecution OR planNextToolSelection.`;

  // Use generateObject to get structured decision
  const DecisionSchema = z.object({
    action: z.enum([
      "summarizeAfterToolCallExecution",
      "planNextToolSelection",
    ]),
    summary: z.string().optional(),
  });

  const isReasoning =
    config.modelId.includes("gpt-5") ||
    config.modelId.includes("o1") ||
    config.modelId.includes("o3");

  console.log(
    "[decisionStep] start",
    JSON.stringify({
      provider: config.provider,
      modelId: config.modelId,
      isReasoning,
      messages: decisionMessages.length,
      hasPriorText: !!priorAssistantText,
    }),
  );

  const result = await generateObject({
    model: model as unknown as LanguageModel,
    messages: decisionMessages,
    system: decisionSystem,
    schema: DecisionSchema,
    ...(isReasoning ? {} : { temperature: config.temperature }),
    maxOutputTokens: config.maxOutputTokens,
  });

  console.log(
    "[decisionStep] result",
    JSON.stringify({
      action: result.object?.action ?? null,
      hasSummary: !!result.object?.summary,
    }),
  );

  const action = result.object?.action ?? "summarizeAfterToolCallExecution";
  const decision =
    action === "summarizeAfterToolCallExecution" ? "summarize" : "planNext";

  return {
    decision,
    summary: result.object?.summary,
  };
}

decisionStep.maxRetries = 0;
