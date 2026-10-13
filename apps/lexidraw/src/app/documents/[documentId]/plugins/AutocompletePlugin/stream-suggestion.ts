import { confirmedNonAcceptance } from "~/lib/generation/pro-admission";
import type { PowerPreference } from "~/lib/byok/preference";
import type { createByokSession } from "~/lib/byok/session";
export type SuggestionRequest = {
  title: string;
  before: string;
  after: string;
  entityId?: string;
};
export type ProResult = Pick<
  import("~/trpc/shared").RouterOutputs["pro"]["operation"],
  "id" | "state" | "result"
>;
type ProInput = import("zod").infer<
  typeof import("~/server/pro/contracts").AutocompleteInput
>;
export type ProSuggestions = {
  start(input: ProInput): Promise<ProResult>;
  recover(input: ProInput): Promise<ProResult>;
  read(id: string): Promise<ProResult>;
  cancel(id: string): Promise<ProResult>;
  owner?: { id: string; current: () => boolean };
};
type Pending =
  | { kind: "acceptanceUncertain"; input: ProInput; entityId?: string }
  | { kind: "owned"; input: ProInput; entityId?: string; operation: ProResult };
type Recovery = { pending?: Pending; busy: boolean };
const recoveries = new WeakMap<
  ReturnType<typeof createByokSession>,
  Map<string, Recovery>
>();
export function suggestionRecovery(
  session: ReturnType<typeof createByokSession>,
  pro: ProSuggestions,
): Recovery {
  let scopes = recoveries.get(session);
  if (!scopes) {
    scopes = new Map();
    recoveries.set(session, scopes);
  }
  const scope = pro.owner?.id ?? "session";
  let recovery = scopes.get(scope);
  if (!recovery) {
    scopes.clear();
    recovery = { busy: false };
    scopes.set(scope, recovery);
  }
  return recovery;
}
const active = (operation: ProResult) =>
  ["reserved", "running", "unknown"].includes(operation.state);
function checkOwner(pro: ProSuggestions) {
  if (pro.owner && !pro.owner.current())
    throw new Error("Suggestion account changed");
}
async function readPending(recovery: Recovery, pro: ProSuggestions) {
  checkOwner(pro);
  const pending = recovery.pending;
  if (!pending) return;
  const operation =
    pending.kind === "owned"
      ? await pro.read(pending.operation.id)
      : await pro.recover(pending.input);
  checkOwner(pro);
  if (pending.kind === "owned" && operation.id !== pending.operation.id)
    throw new Error("Suggestion identity changed");
  recovery.pending = { ...pending, kind: "owned", operation };
  return operation;
}
async function stopPending(recovery: Recovery, pro: ProSuggestions) {
  const pending = recovery.pending;
  if (!pending || pending.kind !== "owned") return;
  checkOwner(pro);
  const stopped = await pro.cancel(pending.operation.id);
  checkOwner(pro);
  if (stopped.id !== pending.operation.id)
    throw new Error("Suggestion identity changed");
  recovery.pending = active(stopped)
    ? { ...pending, operation: stopped }
    : undefined;
  return stopped;
}
export async function refreshOwnedSuggestion(
  session: ReturnType<typeof createByokSession>,
  pro: ProSuggestions,
  cancel = false,
) {
  const recovery = suggestionRecovery(session, pro);
  if (recovery.busy) throw new Error("Suggestion acceptance is still pending");
  recovery.busy = true;
  try {
    const operation = await readPending(recovery, pro);
    if (cancel && operation) return await stopPending(recovery, pro);
    if (operation && !active(operation)) recovery.pending = undefined;
    return operation;
  } finally {
    recovery.busy = false;
  }
}
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
    const recovery = suggestionRecovery(session, pro);
    const bounded = {
      title: clipBytes(input.title, 100),
      before: clipBytes(input.before, 900, true),
      after: clipBytes(input.after, 150),
    };
    session.assertSafe(JSON.stringify(bounded));
    if (!recovery.pending && preference.mode === "local")
      throw new Error(
        "Local text is unavailable in this browser. Use a supported Apple device.",
      );
    if (preference.mode === "byok") {
      checkOwner(pro);
      if (signal.aborted) throw new Error("Suggestions stopped");
      const reference = session.reference();
      if (!reference)
        throw new Error("Set up your key on this device in AI Power.");
      const result = await session.autocomplete(reference, bounded.before, {
        title: bounded.title,
        after: bounded.after,
        signal,
      });
      checkOwner(pro);
      if (signal.aborted) throw new Error("Suggestions stopped");
      return result;
    }
    if (recovery.busy)
      throw new Error("A suggestion is reconciling; credits remain reserved.");
    if (signal.aborted && !recovery.pending)
      throw new Error("Suggestions stopped");
    recovery.busy = true;
    let operation: ProResult | undefined;
    const existing = recovery.pending;
    const matches =
      !existing ||
      (existing.entityId === input.entityId &&
        existing.input.title === bounded.title &&
        existing.input.before === bounded.before &&
        existing.input.after === bounded.after);
    try {
      checkOwner(pro);
      if (existing) operation = await readPending(recovery, pro);
      else {
        const submitted = { ...bounded, idempotencyKey: crypto.randomUUID() };
        recovery.pending = {
          kind: "acceptanceUncertain",
          input: submitted,
          entityId: input.entityId,
        };
        try {
          operation = await pro.start(submitted);
        } catch (error) {
          checkOwner(pro);
          if (
            confirmedNonAcceptance(
              error,
              "autocomplete",
              submitted.idempotencyKey,
            )
          ) {
            recovery.pending = undefined;
            throw new Error(
              "Suggestion was not accepted. Try again when allowance and limits permit.",
            );
          }
          operation = await pro.recover(submitted);
        }
        checkOwner(pro);
        recovery.pending = {
          kind: "owned",
          input: submitted,
          entityId: input.entityId,
          operation,
        };
      }
      if (!operation) throw new Error("Suggestion acceptance is unconfirmed");
      if (!matches || preference.mode !== "pro" || signal.aborted)
        throw new Error("Suggestions stopped");
      for (
        let count = 0;
        ["reserved", "running"].includes(operation.state) && count < 150;
        count++
      ) {
        if (signal.aborted) throw new Error("Suggestions stopped");
        await new Promise((resolve) => setTimeout(resolve, 200));
        operation = await readPending(recovery, pro);
        if (!operation) throw new Error("Suggestion acceptance is unconfirmed");
      }
      checkOwner(pro);
      changed(operation.state);
      if (signal.aborted) throw new Error("Suggestions stopped");
      if (operation.state === "settled") {
        session.assertSafe(operation.result ?? "");
        recovery.pending = undefined;
        return operation.result ?? "";
      }
      if (!active(operation)) recovery.pending = undefined;
      throw new Error(
        operation.state === "unknown"
          ? "A suggestion is reconciling. Its credits remain reserved."
          : "Suggestion unavailable. Check AI Power and allowance.",
      );
    } catch (error) {
      if (recovery.pending?.kind === "acceptanceUncertain")
        changed("acceptanceUncertain");
      throw error;
    } finally {
      try {
        if (
          operation &&
          (signal.aborted ||
            !matches ||
            preference.mode !== "pro" ||
            ["reserved", "running"].includes(operation.state))
        ) {
          const stopped = await stopPending(recovery, pro);
          if (stopped) changed(stopped.state);
        }
      } catch {
        changed("cancellationUnconfirmed");
      }
      recovery.busy = false;
    }
  };
}
