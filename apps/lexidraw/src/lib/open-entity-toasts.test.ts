/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { StoredRevision, SyncedEditor } from "./open-entity-sync";
import { announcedSync, type Toaster } from "./open-entity-toasts";

const rev = (at: number, elements: string): StoredRevision => ({
  updatedAt: new Date(Date.UTC(2026, 8, 24, 0, 0, at)),
  elements,
});

type Shown = {
  kind: "info" | "warning";
  title: string;
  options: Parameters<Toaster["warning"]>[1];
};

/** Sonner, as far as the sync speaks to it: what shows, and what went away. */
function toaster() {
  const shown: Shown[] = [];
  const dismissed: (string | number | undefined)[] = [];
  const port: Toaster = {
    info: (title, options) => {
      shown.push({ kind: "info", title: String(title), options });
      return "";
    },
    warning: (title, options) => {
      shown.push({ kind: "warning", title: String(title), options });
      return "";
    },
    dismiss: (id) => {
      dismissed.push(id);
      // Sonner calls onDismiss for a toast dismissed in code as well.
      const toast = shown.find((t) => t.options?.id === id);
      toast?.options?.onDismiss?.({ id: id ?? "" });
      return id ?? "";
    },
  };
  return { shown, dismissed, port };
}

/** An open drawing with edits of its own, over a server someone wrote to. */
function editedOverAWrite() {
  let stored: StoredRevision | null = rev(1, "v1");
  const toasts = toaster();
  const resumed: number[] = [];
  const editor: SyncedEditor = {
    shows: () => false,
    hasLocalEdits: () => true,
    replace: () => {},
    saved: () => {},
  };
  const sync = announcedSync({
    held: rev(1, "v1"),
    source: {
      updatedAt: async () => stored?.updatedAt ?? null,
      load: async () => stored ?? rev(0, ""),
    },
    noun: "drawing",
    entityId: "d1",
    toaster: toasts.port,
    onSavesResumed: () => resumed.push(1),
  });
  sync.attach(editor);
  return {
    sync,
    toasts,
    resumed,
    write: (next: StoredRevision | null) => {
      stored = next;
    },
  };
}

describe("what an open editor tells the user", () => {
  test("closing the question keeps the user's edits and lets autosave go on", async () => {
    const { sync, toasts, resumed, write } = editedOverAWrite();
    write(rev(2, "theirs"));
    await sync.check();
    const question = toasts.shown.find((t) => t.kind === "warning");
    expect(sync.holdsSaves()).toBe(true);

    question?.options?.onDismiss?.({ id: question.options.id ?? "" });

    expect(sync.holdsSaves()).toBe(false);
    expect(resumed).toHaveLength(1);
  });

  test("Keep mine lets autosave go on; Reload does not ask it to", async () => {
    const kept = editedOverAWrite();
    kept.write(rev(2, "theirs"));
    await kept.sync.check();
    const question = kept.toasts.shown.find((t) => t.kind === "warning");
    const keep = question?.options?.cancel;
    if (!keep || typeof keep !== "object" || !("onClick" in keep))
      throw new Error("no Keep mine");
    keep.onClick({} as never);
    expect(kept.resumed).toHaveLength(1);

    const reloaded = editedOverAWrite();
    reloaded.write(rev(2, "theirs"));
    await reloaded.sync.check();
    const asked = reloaded.toasts.shown.find((t) => t.kind === "warning");
    const reload = asked?.options?.action;
    if (!reload || typeof reload !== "object" || !("onClick" in reload))
      throw new Error("no Reload");
    reload.onClick({} as never);
    expect(reloaded.sync.holdsSaves()).toBe(false);
    expect(reloaded.resumed).toHaveLength(0);
  });

  test("an entity that goes away is said so once, and the notice goes when it is back", async () => {
    const { sync, toasts, write } = editedOverAWrite();
    write(null);
    await sync.check("focus");
    await sync.check("focus");
    const gone = toasts.shown.filter((t) => t.title.includes("no longer"));
    expect(gone).toHaveLength(1);

    write(rev(1, "v1"));
    await sync.check("focus");
    expect(toasts.dismissed).toContain(gone[0]?.options?.id);
  });
});
