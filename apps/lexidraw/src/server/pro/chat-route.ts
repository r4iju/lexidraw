import { z } from "zod";
import { ChatInput } from "~/lib/generation/chat";
import type { ProChat } from "./chat";
export const ChatStreamInput = z.strictObject({
  id: z.string().min(1).max(100),
  input: ChatInput,
});
export function createChatStreamRoute(deps: {
  authorize: (request: Request) => Promise<string | null>;
  chat: () => ProChat;
}) {
  return async (request: Request) => {
    const account = await deps.authorize(request);
    if (!account) return new Response(null, { status: 401 });
    const length = Number(request.headers.get("Content-Length") ?? 0);
    if (length > 4096) return new Response(null, { status: 413 });
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    let raw = "",
      size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 4096) {
          await reader.cancel();
          return new Response(null, { status: 413 });
        }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    const parsed = ChatStreamInput.safeParse(
      (() => {
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      })(),
    );
    if (!parsed.success) return new Response(null, { status: 400 });
    let chat: ProChat;
    try {
      chat = deps.chat();
      const op = await chat.ledger.operation(account, parsed.data.id);
      if (op.feature !== "chat") return new Response(null, { status: 404 });
    } catch {
      return new Response("Chat unavailable", { status: 503 });
    }
    const encoder = new TextEncoder();
    let connected = true;
    const cancel = () => {
      connected = false;
      void chat.ledger.cancel(account, parsed.data.id).catch(() => {});
    };
    request.signal.addEventListener("abort", cancel, { once: true });
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => {
          if (connected)
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        };
        try {
          if (request.signal.aborted) cancel();
          const result = await chat.stream(
            account,
            parsed.data.id,
            parsed.data.input,
            (text) => send({ kind: "text", text }),
          );
          send({ kind: "operation", operation: result });
        } catch {
          send({
            kind: "error",
            message:
              "Chat could not complete. Check the existing operation; no automatic repeat was performed.",
          });
        } finally {
          request.signal.removeEventListener("abort", cancel);
          if (connected) controller.close();
        }
      },
      cancel,
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
