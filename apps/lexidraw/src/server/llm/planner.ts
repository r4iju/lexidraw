export interface PlanToolsArgs {
  prompt: string;
  availableTools: string[];
  documentMarkdown?: string;
  max: number;
  provider: string;
}

export interface PlanToolsResult {
  tools: string[];
}

export async function planTools(
  _args: PlanToolsArgs,
): Promise<PlanToolsResult> {
  throw new Error("Planner requires the bounded parent operation");
}
