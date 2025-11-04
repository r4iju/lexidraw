import "server-only";

import { getEffectiveLlmConfig } from "~/server/llm/get-effective-config";
import { planTools } from "~/server/llm/planner";

export interface CallPlannerStepArgs {
  prompt: string;
  availableTools: string[];
  documentMarkdown?: string;
  max: number;
  userId: string;
}

export interface CallPlannerStepResult {
  tools: string[];
  correlationId?: string;
}

export async function callPlannerStep(
  args: CallPlannerStepArgs,
): Promise<CallPlannerStepResult> {
  "use step";
  // Log the prompt being sent to planner
  console.log("[callPlannerStep] Calling planner with:", {
    prompt: args.prompt,
    promptLength: args.prompt.length,
    promptPreview: args.prompt.substring(0, 200),
    availableTools: args.availableTools,
    max: args.max,
    userId: args.userId,
  });

  // Resolve provider from effective config (agent mode)
  const cfg = await getEffectiveLlmConfig({
    mode: "agent",
    userConfig: undefined,
  });

  // Call server-side planner directly (no tRPC)
  const result = await planTools({
    prompt: args.prompt,
    availableTools: args.availableTools,
    documentMarkdown: args.documentMarkdown,
    max: args.max,
    provider: cfg.provider,
  });

  console.log("[callPlannerStep] Planner result:", {
    tools: result.tools,
    toolsCount: result.tools?.length ?? 0,
  });

  // TODO: throw if no tools are returned
  // if (result.tools.length === 0) {
  //   throw new RetryableError("Planner returned no tools", {
  //     retryAfter: 1000,
  //   });
  // }

  return {
    tools: result.tools,
    correlationId: undefined,
  };
}

callPlannerStep.maxRetries = 2;
