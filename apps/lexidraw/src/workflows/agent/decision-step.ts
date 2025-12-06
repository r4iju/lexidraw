import "server-only";

import type { ModelMessage } from "ai";
import { z } from "zod";
import type { EffectiveLlmConfig } from "~/server/llm/get-effective-config";
import type { LanguageModelV2 } from "@ai-sdk/provider";
import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import env from "@packages/env";

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

  console.log("[decisionStep] args", JSON.stringify(args, null, 2));
  const { messages, system, config, priorAssistantText } = args;

  let model: ReturnType<
    | ReturnType<typeof createOpenAI>
    | ReturnType<typeof createGoogleGenerativeAI>
  > | null = null;

  if (config.provider === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new Error("Missing OpenAI API key");
    }
    const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
    model = openai(config.modelId);
  } else if (config.provider === "google") {
    if (!env.GOOGLE_API_KEY) {
      throw new Error("Missing Google API key");
    }
    const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY });
    model = google(config.modelId);
  } else {
    throw new Error(`Unsupported provider: ${config.provider}`);
  }

  // Build decision messages
  const decisionMessages = [
    ...messages,
    ...(priorAssistantText
      ? [{ role: "assistant" as const, content: priorAssistantText }]
      : []),
    {
      role: "user" as const,
      content:
        "Choose exactly one action next:\n1) summarizeAfterToolCallExecution\n2) planNextToolSelection",
    },
    // A message that can be used in the messages field of a prompt. It can be a user message, an assistant message, or a tool message.
  ] satisfies ModelMessage[];

  console.log(
    "[decisionStep] decisionMessages",
    JSON.stringify(decisionMessages, null, 2),
  );

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
    model: model as LanguageModelV2,
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
