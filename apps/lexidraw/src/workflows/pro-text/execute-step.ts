import { proLedger } from "~/server/pro/runtime";
import { ProTextOperation } from "~/server/pro/operation";
export async function executeProTextStep(
  account: string,
  id: string,
  text: string,
) {
  "use step";
  return new ProTextOperation(proLedger(), async () => ({
    kind: "failed",
    retryable: false,
    actualCostNanoUsd: 0,
  })).execute(account, id, text);
}
