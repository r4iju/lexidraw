import { SupplierContract, textCost } from "./supplier-contract";
import "server-only";
import { z } from "zod";
import {
  ChatRequest,
  CHAT_OUTPUT_BYTES,
  CHAT_WIRE_BYTES,
} from "~/lib/generation/chat";
import { createByokSession } from "~/lib/byok/session";
import { Completion, TextBook, Usage } from "./contracts";
import type { ProTransport } from "./operation";
const ResponseId = z.string().min(1).max(200);
const WireUsage = z
  .object({
    input_tokens: z.number().int().nonnegative().max(4096),
    input_tokens_details: z.object({
      cached_tokens: z.number().int().nonnegative().max(4096),
    }),
    output_tokens: z.number().int().nonnegative().max(512),
  })
  .refine(
    (usage) => usage.input_tokens_details.cached_tokens <= usage.input_tokens,
  );
const Event = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("response.output_text.delta"),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("response.created"),
    response: z.object({
      id: ResponseId,
      status: z.enum(["queued", "in_progress"]),
    }),
  }),
  z.object({
    type: z.literal("response.completed"),
    response: z.object({
      id: ResponseId,
      status: z.literal("completed"),
      usage: WireUsage,
    }),
  }),
  z.object({
    type: z.literal("response.failed"),
    response: z.object({
      id: ResponseId,
      status: z.literal("failed"),
      usage: WireUsage.nullish(),
    }),
  }),
  z.object({
    type: z.literal("response.incomplete"),
    response: z.object({
      id: ResponseId,
      status: z.literal("incomplete"),
      usage: WireUsage.nullish(),
    }),
  }),
  z.object({
    type: z.literal("error"),
    code: z.string().min(1).max(200),
    message: z.string().max(16000),
    param: z.string().nullable(),
    sequence_number: z.number().int().nonnegative(),
  }),
]);
export function createProChatTransport(deps: {
  authorize: (
    context: Parameters<ProTransport>[2],
  ) => Promise<SupplierContract>;
  resolveServerKey: () => string | undefined;
  fetch: (request: Request) => Promise<Response>;
}): ProTransport {
  return async (text, signal, context) => {
    const request = ChatRequest.parse(JSON.parse(text));
    if (new TextEncoder().encode(text).length > CHAT_WIRE_BYTES)
      return { kind: "failed", retryable: false, actualCostNanoUsd: 0 };
    let contract: SupplierContract;
    try {
      contract = SupplierContract.parse(await deps.authorize(context));
      if (contract.feature !== "chat")
        throw new Error("Supplier feature mismatch");
    } catch {
      return { kind: "failed", retryable: false, actualCostNanoUsd: 0 };
    }
    const book = TextBook.parse(contract.book);
    const key = deps.resolveServerKey();
    if (!key) return { kind: "failed", retryable: false, actualCostNanoUsd: 0 };
    const guard = createByokSession(async () => {
      throw new Error("No device network");
    }, "https://app.invalid");
    guard.replace("openrouter", key);
    try {
      guard.assertSafe(text);
    } catch {
      guard.remove();
      return { kind: "failed", retryable: false, actualCostNanoUsd: 0 };
    }
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
      let responseId: string | undefined;
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
              const type = z.object({ type: z.string() }).parse(raw).type;
              if (
                /failed|error|incomplete/.test(type) ||
                [
                  "response.failed",
                  "response.incomplete",
                  "response.completed",
                  "response.created",
                  "error",
                ].includes(type)
              )
                return { kind: "unknown" };
              continue;
            }
            if (event.data.type === "error") {
              // The validated error belongs to this authenticated, redirect-free request stream; it has no response payload or metered usage.
              return { kind: "failed", retryable: false };
            }
            if ("response" in event.data) {
              if (responseId && responseId !== event.data.response.id)
                return { kind: "unknown" };
              responseId = event.data.response.id;
            }
            if (event.data.type === "response.created") continue;
            if (
              event.data.type === "response.failed" ||
              event.data.type === "response.incomplete"
            ) {
              const usage = event.data.response.usage;
              // Known technical failure releases customer credits even when supplier cost needs reconciliation.
              return {
                kind: "failed",
                retryable: false,
                ...(usage
                  ? {
                      actualCostNanoUsd: textCost(
                        Usage.parse({
                          input: usage.input_tokens,
                          cachedInput: usage.input_tokens_details.cached_tokens,
                          output: usage.output_tokens,
                        }),
                        book,
                      ),
                    }
                  : {}),
              };
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
              const usage = Usage.parse({
                input: event.data.response.usage.input_tokens,
                cachedInput:
                  event.data.response.usage.input_tokens_details.cached_tokens,
                output: event.data.response.usage.output_tokens,
              });
              guard.assertSafe(output);
              if (output.length > emitted) context.onText?.(output);
              return {
                kind: "completed",
                completion: Completion.parse({
                  text: output,
                  usage,
                  actualCostNanoUsd: textCost(usage, book),
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
