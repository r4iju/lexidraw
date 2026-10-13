import { z } from "zod";
import { CHAT_UNCERTAIN } from "./chat";
const Delta = z.object({
  choices: z
    .array(
      z.object({
        delta: z.object({ content: z.string().nullable().optional() }),
      }),
    )
    .max(1),
});

/** Hold incomplete tokens so a key split across SSE/network chunks cannot reach callbacks. */
export async function* providerChatStream(
  response: Response,
  signal: AbortSignal,
  assertSafe: (text: string) => void = () => {},
  valid: () => boolean = () => true,
) {
  if (
    !response.ok ||
    response.redirected ||
    response.headers.has("Content-Encoding") ||
    response.headers.get("Content-Type")?.split(";")[0] !== "text/event-stream"
  )
    throw new Error(CHAT_UNCERTAIN);
  const reader = response.body?.getReader();
  if (!reader) throw new Error(CHAT_UNCERTAIN);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "",
    text = "",
    emitted = 0,
    bytes = 0,
    wire = "";
  let completed = false;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (!completed) {
      if (signal.aborted || !valid()) throw new Error(CHAT_UNCERTAIN);
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > 131072) throw new Error(CHAT_UNCERTAIN);
      const chunk = decoder.decode(next.value, { stream: true });
      wire += chunk;
      assertSafe(wire);
      buffer = (buffer + chunk).replaceAll("\r\n", "\n");
      while (buffer.includes("\n\n")) {
        const boundary = buffer.indexOf("\n\n");
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") {
          completed = true;
          break;
        }
        const parsed = Delta.parse(JSON.parse(data));
        text += parsed.choices[0]?.delta.content ?? "";
        if (new TextEncoder().encode(text).length > 16000 || !valid())
          throw new Error(CHAT_UNCERTAIN);
        assertSafe(text);
        const safeEnd = text.search(/\S*$/);
        if (safeEnd > emitted) {
          yield text.slice(emitted, safeEnd);
          emitted = safeEnd;
        }
      }
    }
    if (!completed || signal.aborted || !valid())
      throw new Error(CHAT_UNCERTAIN);
    assertSafe(text);
    if (text.length > emitted) yield text.slice(emitted);
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
