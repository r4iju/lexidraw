/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  OpenEntitySync,
  type StoredRevision,
  type SyncedEditor,
  type SyncNotice,
} from "./open-entity-sync";

const rev = (at: number, elements: string): StoredRevision => ({
  updatedAt: new Date(Date.UTC(2026, 8, 24, 0, 0, at)),
  elements,
});

/** The server: the revision it stores now, and how often it was asked. */
function server(initial: StoredRevision) {
  const state = {
    current: initial as StoredRevision | null,
    asked: 0,
    loads: 0,
    pending: null as null | (() => void),
  };
  return {
    state,
    source: {
      updatedAt: async () => {
        state.asked++;
        if (state.pending === null) return state.current?.updatedAt ?? null;
        // A request still on the wire: resolves when the test says so.
        await new Promise<void>((resolve) => {
          state.pending = resolve;
        });
        return state.current?.updatedAt ?? null;
      },
      load: async () => {
        state.loads++;
        if (!state.current) throw new Error("NOT_FOUND");
        return state.current;
      },
    },
  };
}

/** An editor showing `showing`, with or without edits of its own on top. */
function editor(showing: string, edited = false) {
  const state = {
    showing,
    edited,
    replaced: [] as StoredRevision[],
    /** Stored content this editor cannot parse, like a corrupt write. */
    unparsable: null as string | null,
    /** How often it was asked what it shows: a full parse in a real editor. */
    parses: 0,
  };
  const port: SyncedEditor = {
    shows: (elements) => {
      state.parses++;
      return !state.edited && elements === state.showing;
    },
    hasLocalEdits: () => state.edited,
    replace: (revision) => {
      if (revision.elements === state.unparsable) throw new SyntaxError("bad");
      state.replaced.push(revision);
      state.showing = revision.elements;
      state.edited = false;
    },
    saved: (elements) => {
      state.showing = elements;
      state.edited = false;
    },
  };
  return { state, port };
}

/** Time the test moves by hand, and the timers waiting on it. */
function clock() {
  const state = { now: 0, timers: [] as { at: number; run: () => void }[] };
  return {
    state,
    now: () => state.now,
    after: (ms: number, run: () => void) => {
      const timer = { at: state.now + ms, run };
      state.timers.push(timer);
      return () => {
        state.timers = state.timers.filter((t) => t !== timer);
      };
    },
    advance(ms: number) {
      state.now += ms;
      const due = state.timers.filter((t) => t.at <= state.now);
      state.timers = state.timers.filter((t) => t.at > state.now);
      for (const timer of due) timer.run();
    },
  };
}

function setup(held: StoredRevision, ed: ReturnType<typeof editor>) {
  const srv = server(held);
  const time = clock();
  const notices: SyncNotice["kind"][] = [];
  const sync = new OpenEntitySync(
    held,
    srv.source,
    (n) => notices.push(n.kind),
    { now: time.now, after: time.after },
  );
  sync.attach(ed.port);
  return { srv, notices, sync, time };
}

describe("an open editor and the entity stored under it", () => {
  test("a write made elsewhere replaces what a clean editor shows, and says so", async () => {
    const r1 = rev(1, "v1");
    const ed = editor("v1");
    const { srv, notices, sync } = setup(r1, ed);

    srv.state.current = rev(2, "v2 from the API");
    await Promise.all([sync.check(), sync.check()]);

    expect(ed.state.replaced.map((r) => r.elements)).toEqual([
      "v2 from the API",
    ]);
    expect(notices).toEqual(["reloaded"]);
    expect(srv.state.loads).toBe(1);

    await sync.check();
    expect(ed.state.replaced).toHaveLength(1);
    expect(notices).toEqual(["reloaded"]);
  });

  test("unsaved local edits are never replaced without the user choosing to", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    srv.state.current = rev(2, "v2");
    await sync.check();
    expect(ed.state.replaced).toEqual([]);
    expect(notices).toEqual(["conflict"]);

    // Keeping theirs is not asked again for the same write...
    sync.keep();
    await sync.check();
    expect(ed.state.replaced).toEqual([]);
    // Saving the edits it kept is up to the editor again.
    expect(notices).toEqual(["conflict", "settled", "resumed"]);

    // ...but the next write is announced again, and reloading takes it.
    srv.state.current = rev(3, "v3");
    await sync.check();
    expect(notices).toEqual(["conflict", "settled", "resumed", "conflict"]);
    sync.reload();
    expect(ed.state.replaced.map((r) => r.elements)).toEqual(["v3"]);
    expect(notices).toEqual([
      "conflict",
      "settled",
      "resumed",
      "conflict",
      "settled",
    ]);
    await sync.check();
    expect(ed.state.replaced).toHaveLength(1);
  });

  test("a revision that did not change the content is adopted, not reloaded", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    // A rename or a thumbnail moves updatedAt without touching elements.
    srv.state.current = rev(2, "v1");
    await sync.check();
    await sync.check();

    expect(ed.state.replaced).toEqual([]);
    expect(notices).toEqual([]);
    expect(srv.state.loads).toBe(1);
  });

  test("content the editor already shows is adopted without a reload", async () => {
    // A collaborator's edit that arrived live, then their save.
    const ed = editor("v2");
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    srv.state.current = rev(2, "v2");
    await sync.check();

    expect(ed.state.replaced).toEqual([]);
    expect(notices).toEqual([]);
  });

  test("the editor's own save is not a change made elsewhere", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    // A check while the save is in flight looks at nothing.
    sync.saveStarted();
    srv.state.current = rev(2, "v1 edited");
    await sync.check();
    expect(srv.state.loads).toBe(0);

    sync.saveSucceeded(rev(2, "v1 edited"));
    ed.state.edited = true; // typed on after the save went out
    await sync.check();
    expect(notices).toEqual([]);
    expect(ed.state.replaced).toEqual([]);
  });

  test("a save that lands while a check is in flight voids that check", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    srv.state.pending = () => {};
    const checking = sync.check();
    await Promise.resolve();
    // The save commits server-side, the check reads it back, and only then
    // does the save's own answer arrive.
    sync.saveStarted();
    srv.state.current = rev(2, "v1 edited");
    ed.state.edited = true; // typed on after the save went out
    srv.state.pending?.();
    await checking;
    sync.saveSucceeded(rev(2, "v1 edited"));

    expect(notices).toEqual([]);
    expect(ed.state.replaced).toEqual([]);
  });

  test("autosave waits while the question stands; a save the user makes answers it", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);
    expect(sync.holdsSaves()).toBe(false);

    srv.state.current = rev(2, "v2");
    await sync.check();
    // An autosave landing now would overwrite v2 before the user chose.
    expect(sync.holdsSaves()).toBe(true);
    sync.keep();
    expect(sync.holdsSaves()).toBe(false);

    srv.state.current = rev(3, "v3");
    await sync.check();
    expect(sync.holdsSaves()).toBe(true);
    // Saving by hand is a choice: the stored content is theirs now.
    sync.saveStarted();
    srv.state.current = rev(4, "mine");
    sync.saveSucceeded(rev(4, "mine"));
    expect(sync.holdsSaves()).toBe(false);
    expect(notices).toEqual([
      "conflict",
      "settled",
      "resumed",
      "conflict",
      "settled",
    ]);
    sync.reload();
    expect(ed.state.replaced).toEqual([]);
  });

  test("keeping edits over some content is not asked again when only updatedAt moves", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    srv.state.current = rev(2, "v2");
    await sync.check();
    sync.keep();
    // A thumbnail or a rename moves updatedAt over the same content.
    srv.state.current = rev(3, "v2");
    await sync.check();
    expect(notices).toEqual(["conflict", "settled", "resumed"]);

    srv.state.current = rev(4, "v4");
    await sync.check();
    expect(notices).toEqual(["conflict", "settled", "resumed", "conflict"]);
  });

  test("a replace that fails leaves the editor behind, so the next check tries again", async () => {
    const ed = editor("v1");
    const { srv, sync } = setup(rev(1, "v1"), ed);

    srv.state.current = rev(2, "v2");
    ed.state.unparsable = "v2";
    await expect(sync.check()).rejects.toThrow(SyntaxError);
    expect(ed.state.replaced).toEqual([]);

    ed.state.unparsable = null;
    await sync.check();
    expect(ed.state.replaced.map((r) => r.elements)).toEqual(["v2"]);
  });

  test("a reload chosen while a save is in flight waits for the save", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    srv.state.current = rev(2, "v2");
    await sync.check();
    sync.saveStarted();
    sync.reload();
    expect(ed.state.replaced).toEqual([]);
    // The save failed: v2 still stands over the edits, and the user chose it.
    sync.saveFailed();
    expect(ed.state.replaced.map((r) => r.elements)).toEqual(["v2"]);
    expect(notices).toEqual(["conflict", "settled"]);

    // Had it landed, the stored content would be the user's, and there would
    // be nothing left to reload to.
    const ed2 = editor("v1", true);
    const second = setup(rev(1, "v1"), ed2);
    second.srv.state.current = rev(2, "v2");
    await second.sync.check();
    second.sync.saveStarted();
    second.sync.reload();
    second.sync.saveSucceeded(rev(3, "mine"));
    expect(ed2.state.replaced).toEqual([]);
    expect(second.notices).toEqual(["conflict", "settled"]);
  });

  test("a save answered out of order does not move the held revision back", async () => {
    const ed = editor("v1", true);
    const { srv, sync } = setup(rev(1, "v1"), ed);

    sync.saveStarted();
    sync.saveStarted();
    srv.state.current = rev(3, "b");
    sync.saveSucceeded(rev(3, "b"));
    sync.saveSucceeded(rev(2, "a"));

    await sync.check();
    expect(srv.state.loads).toBe(0);
  });

  test("a standing question is not parsed or asked again by later polls", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    srv.state.current = rev(2, "v2");
    await sync.check();
    await sync.check();
    await sync.check();
    expect(notices).toEqual(["conflict"]);
    expect(ed.state.parses).toBe(1);

    // Nor is content the user already kept theirs over.
    sync.keep();
    await sync.check();
    await sync.check();
    expect(ed.state.parses).toBe(1);
    expect(srv.state.loads).toBe(1);
  });

  test("a reload waiting on a save that never answers goes ahead after a while", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync, time } = setup(rev(1, "v1"), ed);

    srv.state.current = rev(2, "v2");
    await sync.check();
    sync.saveStarted();
    sync.reload();
    expect(sync.holdsSaves()).toBe(true);

    time.advance(30_000);
    expect(ed.state.replaced.map((r) => r.elements)).toEqual(["v2"]);
    expect(sync.holdsSaves()).toBe(false);
    expect(notices).toEqual(["conflict", "settled"]);

    // The save lands after all: the tab shows v2 over what is stored now,
    // so the next check has to bring it back, not take the save as shown.
    srv.state.current = rev(3, "mine");
    sync.saveSucceeded(rev(3, "mine"));
    await sync.check();
    expect(ed.state.replaced.map((r) => r.elements)).toEqual(["v2", "mine"]);
    expect(notices).toEqual(["conflict", "settled", "reloaded"]);
  });

  test("an entity that is gone is said so once, asked about sparingly, and followed when it returns", async () => {
    const ed = editor("v1");
    const { srv, notices, sync, time } = setup(rev(1, "v1"), ed);

    const held = srv.state.current;
    srv.state.current = null;
    await sync.check();
    expect(notices).toEqual(["gone"]);

    // Polls leave it alone for a while; the user coming back does not.
    await sync.check();
    await sync.check();
    expect(srv.state.asked).toBe(1);
    await sync.check("focus");
    expect(srv.state.asked).toBe(2);
    time.advance(5 * 60_000);
    await sync.check();
    expect(srv.state.asked).toBe(3);
    expect(notices).toEqual(["gone"]);

    // Shared again, or restored: back to normal, with what it holds now.
    srv.state.current = held && rev(9, "v9");
    await sync.check("focus");
    expect(notices).toEqual(["gone", "back", "reloaded"]);
    expect(ed.state.replaced.map((r) => r.elements)).toEqual(["v9"]);
  });
});
