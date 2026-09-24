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
    /** Every save that reached it, with the revision it was made over. */
    saves: [] as { elements: string; over: string | undefined }[],
    /** Answers to saves wait here while set, until the test lets one go. */
    held: null as null | (() => void)[],
    /** Saves are stored, and their answers lost on the way back. */
    lose: false,
  };
  const labelOf = (at: Date) =>
    `r${(at.getTime() - rev(0, "").updatedAt.getTime()) / 1000}`;
  return {
    state,
    /** Answers the oldest save still waiting. */
    release() {
      state.held?.shift()?.();
    },
    source: {
      save: async (content: { elements: string }, over: Date) => {
        state.saves.push({ elements: content.elements, over: labelOf(over) });
        const stored = state.current;
        if (!stored) throw new Error("NOT_FOUND");
        const written =
          stored.updatedAt.getTime() === over.getTime()
            ? {
                updatedAt: new Date(stored.updatedAt.getTime() + 1000),
                elements: content.elements,
              }
            : null;
        if (written) state.current = written;
        if (state.lose) throw new Error("connection reset");
        // Stored, with the answer still on the wire.
        if (state.held) {
          const queue = state.held;
          await new Promise<void>((resolve) => queue.push(resolve));
        }
        return written?.updatedAt ?? null;
      },
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

/** Lets every promise already settled run its reactions. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

/** Time the test moves by hand. */
function clock() {
  const state = { now: 0 };
  return {
    now: () => state.now,
    advance(ms: number) {
      state.now += ms;
    },
  };
}

function setup(
  held: StoredRevision,
  ed: ReturnType<typeof editor>,
  saveTimeoutMs?: number,
) {
  const srv = server(held);
  const time = clock();
  const notices: SyncNotice["kind"][] = [];
  const sync = new OpenEntitySync(
    held,
    srv.source,
    (n) => notices.push(n.kind),
    { now: time.now },
    saveTimeoutMs,
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
    srv.state.held = [];
    const saving = sync.save({ elements: "v1 edited" });
    await sync.check();
    expect(srv.state.asked).toBe(0);

    srv.release();
    await saving;
    ed.state.edited = true; // typed on after the save went out
    await sync.check();
    expect(notices).toEqual([]);
    expect(ed.state.replaced).toEqual([]);
    expect(srv.state.loads).toBe(0);
  });

  test("a save that lands while a check is in flight voids that check", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    srv.state.pending = () => {};
    const checking = sync.check();
    await Promise.resolve();
    // The save commits server-side, the check reads it back, and only then
    // does the save's own answer arrive.
    srv.state.held = [];
    const saving = sync.save({ elements: "v1 edited" });
    ed.state.edited = true; // typed on after the save went out
    srv.state.pending?.();
    await checking;
    srv.release();
    await saving;

    expect(notices).toEqual([]);
    expect(ed.state.replaced).toEqual([]);
  });

  test("autosave waits while the question stands, and so does a save the user asks for", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);
    expect(sync.holdsSaves()).toBe(false);

    srv.state.current = rev(2, "v2");
    await sync.check();
    // An autosave landing now would overwrite v2 before the user chose.
    expect(sync.holdsSaves()).toBe(true);
    const saving = sync.save({ elements: "mine" });
    await flush();
    expect(srv.state.saves).toEqual([]);

    // Keeping theirs sends it over the revision it was asked about.
    sync.keep();
    expect(sync.holdsSaves()).toBe(false);
    expect(await saving).toBe("saved");
    expect(srv.state.saves).toEqual([{ elements: "mine", over: "r2" }]);
    expect(notices).toEqual(["conflict", "settled", "resumed"]);
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

describe("the editor's saves", () => {
  test("go out one at a time, each over the revision the one before produced, and only the latest of those waiting is sent", async () => {
    const ed = editor("v1", true);
    const { srv, sync } = setup(rev(1, "v1"), ed);

    srv.state.held = [];
    const a = sync.save({ elements: "a" });
    const ab = sync.save({ elements: "ab" });
    const abc = sync.save({ elements: "abc" });
    await flush();
    expect(srv.state.saves).toEqual([{ elements: "a", over: "r1" }]);

    srv.release();
    await flush();
    srv.release();
    expect(await Promise.all([a, ab, abc])).toEqual([
      "saved",
      "saved",
      "saved",
    ]);
    expect(srv.state.saves).toEqual([
      { elements: "a", over: "r1" },
      { elements: "abc", over: "r2" },
    ]);
    expect(srv.state.current?.elements).toBe("abc");
  });

  test("a write elsewhere that lands before the next save, unseen by any poll, is asked about rather than overwritten", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    srv.state.current = rev(2, "v2 from the API");
    const saving = sync.save({ elements: "mine" });
    await flush();
    expect(srv.state.current?.elements).toBe("v2 from the API");
    expect(notices).toEqual(["conflict"]);
    expect(sync.holdsSaves()).toBe(true);

    // What is typed while the question stands goes nowhere yet.
    const typedOn = sync.save({ elements: "mine, and more" });
    await flush();
    expect(srv.state.saves).toHaveLength(1);

    sync.keep();
    expect(await Promise.all([saving, typedOn])).toEqual(["saved", "saved"]);
    expect(srv.state.saves.slice(1)).toEqual([
      { elements: "mine, and more", over: "r2" },
    ]);
    expect(notices).toEqual(["conflict", "settled", "resumed"]);
  });

  test("reloading over a refused save drops it, and the next save goes over what was reloaded", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    srv.state.current = rev(2, "v2");
    const saving = sync.save({ elements: "mine" });
    await flush();
    sync.reload();
    expect(await saving).toBe("dropped");
    expect(ed.state.replaced.map((r) => r.elements)).toEqual(["v2"]);
    expect(notices).toEqual(["conflict", "settled"]);

    expect(await sync.save({ elements: "v2 edited" })).toBe("saved");
    expect(srv.state.saves.at(-1)).toEqual({
      elements: "v2 edited",
      over: "r2",
    });
  });

  test("a save refused over a write that left the content alone goes out again without asking", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    // A rename moves updatedAt without touching elements.
    srv.state.current = rev(2, "v1");
    expect(await sync.save({ elements: "mine" })).toBe("saved");
    expect(srv.state.saves).toEqual([
      { elements: "mine", over: "r1" },
      { elements: "mine", over: "r2" },
    ]);
    expect(notices).toEqual([]);
  });

  test("a save refused after its editor went away is dropped, not sent again", async () => {
    const ed = editor("v1", true);
    const { srv, sync } = setup(rev(1, "v1"), ed);

    // A write lands elsewhere, and the user leaves while the refusal of
    // their save is on its way back.
    srv.state.held = [];
    srv.state.current = rev(5, "v2 from the API");
    const saving = sync.save({ elements: "mine" });
    await flush();
    sync.attach(null);
    srv.release();
    await flush();
    srv.release();
    await flush();
    expect(srv.state.saves).toHaveLength(1);
    expect(await saving).toBe("dropped");
  });

  test("an editor that goes away answers every save still waiting", async () => {
    const ed = editor("v1", true);
    const { srv, sync } = setup(rev(1, "v1"), ed);

    srv.state.current = rev(2, "v2");
    const refused = sync.save({ elements: "mine" });
    await flush();
    const typedOn = sync.save({ elements: "mine, and more" });
    sync.dispose();
    expect(await Promise.all([refused, typedOn])).toEqual([
      "dropped",
      "dropped",
    ]);
    expect(srv.state.saves).toHaveLength(1);
  });

  test("a save whose answer is lost is known again by its content, not asked about", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);

    srv.state.lose = true;
    await expect(sync.save({ elements: "a" })).rejects.toThrow();
    srv.state.lose = false;
    // Stored after all; the next save is refused over it, and is ours.
    expect(await sync.save({ elements: "ab" })).toBe("saved");
    expect(notices).toEqual([]);
    expect(srv.state.saves).toEqual([
      { elements: "a", over: "r1" },
      { elements: "ab", over: "r1" },
      { elements: "ab", over: "r2" },
    ]);
  });

  test("a save that gets no answer gives up, and the saves after it go out", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed, 20);

    srv.state.held = [];
    const outcome = (saving: Promise<unknown>) =>
      saving.then(
        () => "answered",
        () => "gave up",
      );
    const hung = outcome(sync.save({ elements: "a" }));
    const next = outcome(sync.save({ elements: "ab" }));
    expect(await hung).toBe("gave up");
    expect(await next).toBe("gave up");
    srv.state.held = null;
    expect(await sync.save({ elements: "abc" })).toBe("saved");
    expect(srv.state.current?.elements).toBe("abc");
    expect(notices).toEqual([]);
  });

  test("while collaborators are connected, their saves are not a question", async () => {
    const ed = editor("v1", true);
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);
    sync.setPeersConnected(true);

    // A peer saved what both editors show live; this user typed on.
    srv.state.current = rev(2, "v1, and theirs");
    await sync.check();
    expect(await sync.save({ elements: "v1, and theirs, and mine" })).toBe(
      "saved",
    );
    srv.state.current = rev(7, "v1, and theirs, and more of theirs");
    ed.state.edited = true;
    expect(await sync.save({ elements: "all of it" })).toBe("saved");
    expect(notices).toEqual([]);
    expect(ed.state.replaced).toEqual([]);
    expect(srv.state.current?.elements).toBe("all of it");
  });

  test("while collaborators are connected, an editor with no edits of its own still shows what it missed", async () => {
    const ed = editor("v1");
    const { srv, notices, sync } = setup(rev(1, "v1"), ed);
    sync.setPeersConnected(true);

    // A peer's edit that never reached this editor live, saved.
    srv.state.current = rev(2, "v1, and theirs");
    await sync.check();
    expect(ed.state.replaced.map((r) => r.elements)).toEqual([
      "v1, and theirs",
    ]);
    expect(notices).toEqual([]);
  });
});
