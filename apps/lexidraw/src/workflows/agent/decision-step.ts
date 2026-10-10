import "server-only";

import type { ModelMessage } from "ai";
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
  _args: DecisionStepArgs,
): Promise<DecisionStepResult> {
  "use step";
  throw new Error(
    "Legacy agent paid steps are disabled. Use the bounded parent operation.",
  );
}
