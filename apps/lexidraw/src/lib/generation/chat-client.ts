import { z } from "zod";
import {
  CHAT_UNCERTAIN,
  ChatDeclined,
  chatStopped,
  type ChatInput,
  type ChatPort,
} from "./chat";
import { Operation } from "~/server/pro/contracts";
import { ChatQuote as ChatQuoteSchema } from "./chat-contracts";
export type ChatQuote = z.infer<typeof ChatQuoteSchema>;
const Event = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("text"), text: z.string().max(16000) }),
  z.strictObject({ kind: z.literal("operation"), operation: Operation }),
  z.strictObject({ kind: z.literal("error"), message: z.string() }),
]);
/** Scoped client submission identity; recovery reads cannot turn into another generation. */
export class OwnedChatSubmission {
  private pending: { idempotencyKey: string; input: ChatInput } | null = null;
  submitted(idempotencyKey: string, input: ChatInput) {
    this.pending = { idempotencyKey, input };
  }
  confirmed() {
    this.pending = null;
  }
  async beforeNewTurn(
    read: (input: {
      idempotencyKey: string;
      input: ChatInput;
    }) => Promise<z.infer<typeof Operation>>,
  ) {
    if (!this.pending) return;
    const operation = Operation.parse(await read(this.pending));
    if (["settled", "cancelled", "refunded"].includes(operation.state))
      this.pending = null;
    throw new Error(
      "Refresh the owned chat result or cancel the owned chat before starting another turn.",
    );
  }
}
export function proChatPort(
  input: ChatInput,
  deps: {
    quote(input: ChatInput): Promise<ChatQuote>;
    confirm(quote: ChatQuote): Promise<boolean>;
    accept(input: {
      idempotencyKey: string;
      input: ChatInput;
      quote: ChatQuote;
    }): Promise<z.infer<typeof Operation>>;
    recover?(input: {
      idempotencyKey: string;
      input: ChatInput;
    }): Promise<z.infer<typeof Operation>>;
    cancel(id: string): Promise<unknown>;
    fetch(request: Request): Promise<Response>;
    origin: string;
    idempotencyKey: string;
    submission?: OwnedChatSubmission;
  },
): ChatPort {
  return {
    async *stream(_request, signal) {
      await deps.submission?.beforeNewTurn(async (input) => {
        if (!deps.recover) throw new Error(CHAT_UNCERTAIN);
        return deps.recover(input);
      });
      const quote = ChatQuoteSchema.parse(await deps.quote(input));
      if (signal.aborted || !(await deps.confirm(quote)))
        throw new ChatDeclined();
      // Await the ID even after the abort so the durable reservation is never orphaned.
      const acceptance = { idempotencyKey: deps.idempotencyKey, input, quote };
      deps.submission?.submitted(deps.idempotencyKey, input);
      let accepted: unknown;
      try {
        accepted = await deps.accept(acceptance);
      } catch {
        // Recover only existing work. A lost reply must never admit or dispatch another operation.
        if (!deps.recover) throw new Error(CHAT_UNCERTAIN);
        accepted = await deps.recover({
          idempotencyKey: deps.idempotencyKey,
          input,
        });
      }
      const operation = Operation.parse(accepted);
      deps.submission?.confirmed();
      // Only an explicit Stop cancels. Leaving the page detaches while the server settles the operation.
      const cancel = () => {
        if (chatStopped(signal)) void deps.cancel(operation.id).catch(() => {});
      };
      signal.addEventListener("abort", cancel, { once: true });
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        if (signal.aborted) {
          cancel();
          throw new Error(CHAT_UNCERTAIN);
        }
        if (operation.state === "settled" && operation.result) {
          yield operation.result;
          return;
        }
        const response = await deps.fetch(
          new Request(new URL("/api/chat/stream", deps.origin), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            signal,
            body: JSON.stringify({ id: operation.id, input }),
          }),
        );
        if (!response.ok) throw new Error(CHAT_UNCERTAIN);
        reader = response.body?.getReader();
        if (!reader) throw new Error(CHAT_UNCERTAIN);
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let buffer = "",
          previous = "",
          size = 0;
        let settled = false;
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.length;
          if (size > 1048576) throw new Error(CHAT_UNCERTAIN);
          buffer += decoder.decode(next.value, { stream: true });
          while (buffer.includes("\n")) {
            const boundary = buffer.indexOf("\n");
            const line = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 1);
            if (!line) continue;
            const event = Event.parse(JSON.parse(line));
            if (event.kind === "error") throw new Error(CHAT_UNCERTAIN);
            if (event.kind === "text") {
              if (!event.text.startsWith(previous))
                throw new Error(CHAT_UNCERTAIN);
              yield event.text.slice(previous.length);
              previous = event.text;
            } else {
              if (
                event.operation.id !== operation.id ||
                event.operation.state !== "settled" ||
                !event.operation.result
              )
                throw new Error(CHAT_UNCERTAIN);
              settled = true;
              if (!previous) yield event.operation.result;
            }
          }
        }
        if (!settled) throw new Error(CHAT_UNCERTAIN);
      } finally {
        signal.removeEventListener("abort", cancel);
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
      }
    },
  };
}

export function chatBrowserFetch(
  session: { fetch(request: Request): Promise<Response> },
  request: Request,
) {
  return session.fetch(request);
}
