import { serverProNarration } from "~/server/pro/narration-provider";
import { FatalError } from "workflow";
import { NARRATION_UNAVAILABLE } from "~/lib/narration/contracts";
// Replayed steps resume from durable chunk fences instead of reissuing uncertain requests.
export async function executeProNarrationStep(
  account: string,
  operationId: string,
) {
  "use step";
  const executor = serverProNarration();
  if (!executor) throw new FatalError(NARRATION_UNAVAILABLE);
  return executor.execute(account, operationId);
}
executeProNarrationStep.maxRetries = 2;
