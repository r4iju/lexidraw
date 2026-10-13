import { serverProAgent } from "~/server/pro/agent-runtime";
import { FatalError } from "workflow";
export async function executeProAgentStep(account: string, id: string) {
  "use step";
  const operation = serverProAgent();
  if (!operation) throw new FatalError("Pro agent capability unavailable");
  return operation.execute(account, id);
}
