import "server-only";
import { createProChatTransport } from "./chat-provider";
import { ProChat } from "./chat";
import { ProTextOperation } from "./operation";
import { proLedger } from "./runtime";
export const PRO_CHAT_AVAILABLE = false;
export const PRO_CHAT_UNAVAILABLE =
  "Pro chat is Coming soon until provider streaming, quality and billable bounds are verified. Your saved history is preserved.";
export function proChat() {
  // Production stays closed. Local callers inject an executable ProChat and provider transport.
  if (!PRO_CHAT_AVAILABLE) throw new Error(PRO_CHAT_UNAVAILABLE);
  const ledger = proLedger();
  return new ProChat(
    ledger,
    new ProTextOperation(
      ledger,
      createProChatTransport({
        authorize: ({ operationId, attemptId, accountId }) =>
          ledger.authorizeDispatch(operationId, attemptId, accountId),
        resolveServerKey: () => process.env.OPENAI_API_KEY,
        fetch: (request) => globalThis.fetch(request),
      }),
    ),
  );
}
