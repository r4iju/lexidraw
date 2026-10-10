import type { PowerPreference } from "~/lib/byok/preference";
import type { createByokSession } from "~/lib/byok/session";
export type SuggestionRequest = {
  title: string;
  before: string;
  after: string;
  entityId?: string;
};
type ProResult = { id: string; state: string; result: string | null };
export type ProSuggestions = {
  start(input: {
    idempotencyKey: string;
    title: string;
    before: string;
    after: string;
  }): Promise<ProResult>;
  read(id: string): Promise<ProResult>;
  cancel(id: string): Promise<unknown>;
};
function clipBytes(text: string, max: number, tail = false) {
  // UTF-8 needs at least one byte per UTF-16 unit. Examine only a bounded
  // window, and advance by whole code points so clipping cannot split a pair.
  const window = tail ? text.slice(-max * 2) : text.slice(0, max * 2);
  const chars = Array.from(window);
  let bytes = 0;
  let count = 0;
  for (let i = 0; i < chars.length; i++) {
    const char = chars[tail ? chars.length - 1 - i : i];
    if (!char) break;
    const code = char.codePointAt(0) ?? 0;
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + size > max) break;
    bytes += size;
    count++;
  }
  return (
    tail ? chars.slice(chars.length - count) : chars.slice(0, count)
  ).join("");
}
export function createSuggestionSource(
  preference: PowerPreference,
  session: ReturnType<typeof createByokSession>,
  pro: ProSuggestions,
  changed: (state: string) => void = () => {},
) {
  return async (
    input: SuggestionRequest,
    signal: AbortSignal,
  ): Promise<string> => {
    if (signal.aborted) throw new Error("Suggestions stopped");
    if (preference.mode === "local")
      throw new Error(
        "Local text is unavailable in this browser. Use a supported Apple device.",
      );
    const bounded = {
      title: clipBytes(input.title, 100),
      before: clipBytes(input.before, 900, true),
      after: clipBytes(input.after, 150),
    };
    session.assertSafe(JSON.stringify(bounded));
    if (preference.mode === "byok") {
      const reference = session.reference();
      if (!reference)
        throw new Error("Set up your key on this device in AI Power.");
      return session.autocomplete(reference, bounded.before, {
        title: bounded.title,
        after: bounded.after,
        signal,
      });
    }
    // Obtain the durable identity even if cancelled during submission, then release through the operation API.
    let operation = await pro.start({
      ...bounded,
      idempotencyKey: crypto.randomUUID(),
    });
    try {
      for (
        let count = 0;
        ["reserved", "running"].includes(operation.state) && count < 150;
        count++
      ) {
        if (signal.aborted) throw new Error("Suggestions stopped");
        await new Promise((resolve) => setTimeout(resolve, 200));
        operation = await pro.read(operation.id);
      }
      changed(operation.state);
      if (signal.aborted) throw new Error("Suggestions stopped");
      if (operation.state === "settled") return operation.result ?? "";
      throw new Error(
        operation.state === "unknown"
          ? "A suggestion is reconciling. Its credits remain reserved."
          : "Suggestion unavailable. Check AI Power and allowance.",
      );
    } finally {
      if (signal.aborted || ["reserved", "running"].includes(operation.state)) {
        await pro.cancel(operation.id);
        changed("cancelled");
      }
    }
  };
}
