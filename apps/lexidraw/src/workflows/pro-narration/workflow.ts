import { executeProNarrationStep } from "./execute-step";
export async function proNarrationWorkflow(
  account: string,
  operationId: string,
) {
  "use workflow";
  // Bounded by the plan: each step either dispatches a part or reports no more work.
  for (;;) {
    const progress = await executeProNarrationStep(account, operationId);
    if (!progress.more) return progress;
  }
}
