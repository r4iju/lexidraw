import { serverProNarration } from "~/server/pro/narration-provider";
import { FatalError } from "workflow";
import { NARRATION_UNAVAILABLE } from "~/lib/narration/contracts";
// A few parts per step keeps each step well inside the function time limit.
const PARTS_PER_STEP = 4;
// Replayed steps resume from durable chunk fences instead of reissuing uncertain requests.
// Returns only progress: step results are persisted, so audio must stay out of them.
export async function executeProNarrationStep(
  account: string,
  operationId: string,
) {
  "use step";
  const executor = serverProNarration();
  if (!executor) throw new FatalError(NARRATION_UNAVAILABLE);
  return executor.step(account, operationId, PARTS_PER_STEP);
}
executeProNarrationStep.maxRetries = 2;
