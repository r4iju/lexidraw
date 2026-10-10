import "server-only";
import { z } from "zod";
import {
  ChatRequest,
  CHAT_OUTPUT_BYTES,
  CHAT_INPUT_BYTES,
} from "~/lib/generation/chat";
import { createByokSession } from "~/lib/byok/session";
import { Completion, TextBook } from "./contracts";
import type { ProTransport } from "./operation";
const Event = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("response.output_text.delta"),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("response.completed"),
    response: z.object({
      id: z.string(),
      status: z.literal("completed"),
      usage: z.object({
        input_tokens: z.number().int(),
        input_tokens_details: z.object({ cached_tokens: z.number().int() }),
        output_tokens: z.number().int(),
      }),
    }),
  }),
]);
export function createProChatTransport(deps: {
  authorize: (context: Parameters<ProTransport>[2]) => Promise<void>;
  resolveServerKey: () => string | undefined;
  fetch: (request: Request) => Promise<Response>;
}): ProTransport {
  return async (text, signal, context) => {
    const request = ChatRequest.parse(JSON.parse(text));
    const book = TextBook.parse(context.book);
    if (new TextEncoder().encode(text).length > CHAT_INPUT_BYTES)
      return { kind: "failed", retryable: false, actualCostNanoUsd: 0 };
    try {
      await deps.authorize(context);
    } catch {
      return { kind: "failed", retryable: false, actualCostNanoUsd: 0 };
    }
    const key = deps.resolveServerKey();
    if (!key) return { kind: "failed", retryable: false, actualCostNanoUsd: 0 };
    const guard = createByokSession(async () => {
      throw new Error("No device network");
    }, "https://app.invalid");
    guard.replace("openrouter", key);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await deps.fetch(
        new Request("https://api.openai.com/v1/responses", {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
            "X-Client-Request-Id": context.attemptId,
          },
          body: JSON.stringify({
            model: book.model,
            instructions: request.system,
            input: request.messages,
            max_output_tokens: book.maxOutputTokens,
            reasoning: { effort: "low" },
            stream: true,
          }),
        }),
      );
      if ([400, 401, 403, 404, 422, 429].includes(response.status))
        return {
          kind: "failed",
          retryable: response.status === 429,
          actualCostNanoUsd: 0,
        };
      if (
        !response.ok ||
        response.redirected ||
        response.headers.has("Content-Encoding") ||
        response.headers.get("Content-Type")?.split(";")[0] !==
          "text/event-stream"
      )
        return { kind: "unknown" };
      reader = response.body?.getReader();
      if (!reader) return { kind: "unknown" };
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "",
        output = "",
        wire = "",
        bytes = 0,
        emitted = 0;
      const abort = () => {
        void reader?.cancel().catch(() => {});
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) return { kind: "unknown" };
          bytes += next.value.length;
          if (bytes > 131072) return { kind: "unknown" };
          const chunk = decoder.decode(next.value, { stream: true });
          wire += chunk;
          guard.assertSafe(wire);
          // Process only complete SSE frames; framing bytes count toward the wire bound.
          buffer = (buffer + chunk).replaceAll("\r\n", "\n");
          while (buffer.includes("\n\n")) {
            const boundary = buffer.indexOf("\n\n");
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (!data) continue;
            const raw: unknown = JSON.parse(data);
            const event = Event.safeParse(raw);
            if (!event.success) {
              if (
                z
                  .object({ type: z.string() })
                  .parse(raw)
                  .type.match(/failed|error|incomplete/)
              )
                return { kind: "unknown" };
              continue;
            }
            if (event.data.type === "response.output_text.delta") {
              output += event.data.delta;
              guard.assertSafe(output);
              if (new TextEncoder().encode(output).length > CHAT_OUTPUT_BYTES)
                return { kind: "unknown" };
              const safeEnd = output.search(/\S*$/);
              if (safeEnd > emitted) {
                context.onText?.(output.slice(0, safeEnd));
                emitted = safeEnd;
              }
            } else {
              const usage = {
                input: event.data.response.usage.input_tokens,
                cachedInput:
                  event.data.response.usage.input_tokens_details.cached_tokens,
                output: event.data.response.usage.output_tokens,
              };
              guard.assertSafe(output);
              if (output.length > emitted) context.onText?.(output);
              return {
                kind: "completed",
                completion: Completion.parse({
                  text: output,
                  usage,
                  actualCostNanoUsd:
                    (usage.input - usage.cachedInput) * book.inputNanoUsd +
                    usage.cachedInput * book.cachedInputNanoUsd +
                    usage.output * book.outputNanoUsd,
                  providerResponseId: event.data.response.id,
                }),
              };
            }
          }
        }
      } finally {
        signal.removeEventListener("abort", abort);
      }
    } catch {
      return { kind: "unknown" };
    } finally {
      await reader?.cancel().catch(() => {});
      reader?.releaseLock();
      guard.remove();
    }
  };
}
