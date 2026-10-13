import { executeProAgentStep } from "./execute-step";
export async function proAgentWorkflow(account: string, id: string) {
  "use workflow";
  return executeProAgentStep(account, id);
}
