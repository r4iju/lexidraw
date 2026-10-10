import { executeProTextStep } from "./execute-step";
export async function proTextWorkflow(
  account: string,
  id: string,
  text: string,
) {
  "use workflow";
  return executeProTextStep(account, id, text);
}
