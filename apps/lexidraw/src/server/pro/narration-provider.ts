import "server-only";
import env from "@packages/env";
import { ProNarration } from "./narration";
import { createGeminiNarrationTransport } from "./narration-gemini";
import { proLedger } from "./runtime";
export function serverProNarration(): ProNarration | undefined {
  if (!env.GOOGLE_API_KEY) return undefined;
  const ledger = proLedger();
  return new ProNarration(
    ledger,
    createGeminiNarrationTransport({
      authorize: ({ operationId, attemptId, accountId }) =>
        ledger.authorizeDispatch(operationId, attemptId, accountId),
      resolveKey: () => env.GOOGLE_API_KEY,
      fetch: (request) => globalThis.fetch(request),
    }),
  );
}
