import { executeProNarrationStep } from "./execute-step";
export async function proNarrationWorkflow(
  account: string,
  operationId: string,
) {
  "use workflow";
  return executeProNarrationStep(account, operationId);
}
