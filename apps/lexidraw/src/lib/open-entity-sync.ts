/**
 * What an open editor does when the entity stored under it moves: a write over
 * `/api/v1`, `/api/mcp`, the CLI, a workflow, or another tab.
 *
 * The invariant: an open editor never silently shows a stale entity, and never
 * silently discards unsaved local edits. Nothing on the server can tell a
 * browser its page is stale (see `server/api/entity-cache.ts`), so the editor
 * asks: it holds the revision it shows, compares that with the stored one
 * whenever `check` runs, and decides:
 *
 * - the stored content is what it holds or already shows → adopt the revision
 *   quietly (a rename or a thumbnail moves `updatedAt` without touching
 *   `elements`; a collaborator's edit arrives live before their save does);
 * - it changed and the editor has no edits of its own → show it, and say so;
 * - it changed under local edits → ask, and replace nothing until the user
 *   chooses. Autosave waits while the question stands, since a save would
 *   answer it. Keeping theirs is not asked again for the same content, and a
 *   question already asked is not worked out again by the next poll.
 *
 * An entity that goes away (deleted, or no longer shared) is said so once, and
 * asked about again only when the user comes back to the tab or after a while.
 *
 * `updatedAt` is only the cheap question; `elements` is the answer, because
 * `updatedAt` moves for writes that do not change what the editor shows.
 */

/** What the server stores for an entity, as far as an editor is concerned. */
export type StoredRevision = { updatedAt: Date; elements: string };

/**
 * The editor side. `shows` and `hasLocalEdits` may err only towards "no" and
 * "yes" respectively: that costs the user a question, the other way loses a
 * write or an edit.
 */
export interface SyncedEditor {
  /** The editor shows exactly this stored content, with nothing on top. */
  shows(elements: string): boolean;
  /** The user changed something the server does not store yet. */
  hasLocalEdits(): boolean;
  /** Show this revision instead, dropping whatever the editor holds. */
  replace(revision: StoredRevision): void;
  /**
   * The server now stores `elements`, which this editor sent, with the
   * `appState` sent alongside for editors that keep one.
   */
  saved(elements: string, appState?: string): void;
}

export interface SyncSource {
  /**
   * The stored revision's `updatedAt`, without its content; null once the
   * entity is gone for this user, deleted or no longer shared.
   */
  updatedAt(): Promise<Date | null>;
  load(): Promise<StoredRevision>;
}

export type SyncNotice =
  | { kind: "reloaded" }
  | { kind: "conflict" }
  /** A conflict announced earlier no longer stands. */
  | { kind: "settled" }
  /** The user kept their edits: saving them is the editor's call again. */
  | { kind: "resumed" }
  /** The entity is gone for this user: deleted, or no longer shared. */
  | { kind: "gone" }
  | { kind: "back" };

/** A poll, or the user coming back to the tab. */
export type CheckTrigger = "poll" | "focus";

export type Clock = {
  now(): number;
  /** Runs `run` after `ms`; the answer cancels it. */
  after(ms: number, run: () => void): () => void;
};

const realClock: Clock = {
  now: () => Date.now(),
  after: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
};

/** How long polls leave a gone entity alone. */
const GONE_POLL_MS = 5 * 60_000;
/**
 * How long a reload the user chose waits for a save on the wire. A request
 * that never answers must not leave autosave held with no question showing.
 */
const RELOAD_WAIT_MS = 30_000;

export class OpenEntitySync {
  private editor: SyncedEditor | null = null;
  private checking = false;
  /** The saves on the wire, by the id `saveStarted` gave each. */
  private inFlight = new Set<number>();
  private lastSave = 0;
  /** Bumped by every save, so a check that straddles one is dropped. */
  private saveEpoch = 0;
  /** The last revision loaded, so asking again for it costs no download. */
  private lastLoaded: StoredRevision | null = null;
  private conflict: StoredRevision | null = null;
  /** The stored revision last put to the user, asked or kept over. */
  private asked: Date | null = null;
  /** The content the user chose to keep their edits over. */
  private kept: string | null = null;
  /** Cancels the wait of a reload chosen while a save was in flight. */
  private reloadWait: (() => void) | null = null;
  /** Saves still on the wire when a reload went ahead without them. */
  private abandoned = new Set<number>();
  /** When the entity was last found gone; null while it is there. */
  private goneAt: number | null = null;

  constructor(
    private held: StoredRevision,
    private readonly source: SyncSource,
    private readonly notify: (notice: SyncNotice) => void,
    private readonly clock: Clock = realClock,
  ) {}

  /** The editor, once it can answer; checks wait for it. */
  attach(editor: SyncedEditor | null): void {
    this.editor = editor;
  }

  async check(trigger: CheckTrigger = "poll"): Promise<void> {
    if (this.checking || this.inFlight.size > 0 || !this.editor) return;
    if (
      this.goneAt !== null &&
      trigger === "poll" &&
      this.clock.now() - this.goneAt < GONE_POLL_MS
    )
      return;
    this.checking = true;
    try {
      const epoch = this.saveEpoch;
      const updatedAt = await this.source.updatedAt();
      if (!updatedAt) {
        if (this.goneAt === null) this.notify({ kind: "gone" });
        this.goneAt = this.clock.now();
        return;
      }
      if (this.goneAt !== null) {
        this.goneAt = null;
        this.notify({ kind: "back" });
      }
      if (epoch !== this.saveEpoch || sameTime(updatedAt, this.held.updatedAt))
        return;
      if (this.asked && sameTime(this.asked, updatedAt)) return;
      const stored =
        this.lastLoaded && sameTime(this.lastLoaded.updatedAt, updatedAt)
          ? this.lastLoaded
          : await this.source.load();
      this.lastLoaded = stored;
      if (epoch !== this.saveEpoch) return;
      this.reconcile(stored);
    } finally {
      this.checking = false;
    }
  }

  private reconcile(stored: StoredRevision): void {
    const editor = this.editor;
    if (!editor) return;
    if (
      stored.elements === this.held.elements ||
      editor.shows(stored.elements)
    ) {
      this.held = stored;
      this.settle();
      return;
    }
    if (!editor.hasLocalEdits()) {
      // Replaced before it is held: a replace that throws leaves the editor
      // behind the stored revision, and the next check tries again.
      editor.replace(stored);
      this.held = stored;
      this.settle();
      this.notify({ kind: "reloaded" });
      return;
    }
    this.asked = stored.updatedAt;
    if (this.kept === stored.elements) return;
    this.conflict = stored;
    this.notify({ kind: "conflict" });
  }

  /**
   * A question stands, and a save would answer it by overwriting what was
   * written elsewhere. Saves the user asks for still go through.
   */
  holdsSaves(): boolean {
    return this.conflict !== null;
  }

  /** The user chose the stored revision over their edits. */
  reload(): void {
    if (!this.conflict || !this.editor) return;
    // A save on the wire decides what is stored; see `saveFailed` and
    // `saveSucceeded`.
    if (this.inFlight.size > 0) {
      this.reloadWait ??= this.clock.after(RELOAD_WAIT_MS, () => {
        this.reloadWait = null;
        // Whatever those saves answer later is older than what shows now,
        // and checks need not wait for them any more.
        for (const save of this.inFlight) this.abandoned.add(save);
        this.inFlight.clear();
        this.applyReload();
      });
      return;
    }
    this.applyReload();
  }

  private applyReload(): void {
    const stored = this.conflict;
    if (!stored || !this.editor) return;
    this.editor.replace(stored);
    this.held = stored;
    this.settle();
  }

  /** The user chose their edits; saving them will overwrite the stored ones. */
  keep(): void {
    if (!this.conflict) return;
    this.kept = this.conflict.elements;
    this.settle();
    this.notify({ kind: "resumed" });
  }

  /** A save went out; answers the id its answer is reported under. */
  saveStarted(): number {
    const save = ++this.lastSave;
    this.inFlight.add(save);
    this.saveEpoch++;
    return save;
  }

  saveSucceeded(save: number, saved: StoredRevision, appState?: string): void {
    if (this.saveSettled(save)) return;
    // The stored content is the user's now: there is nothing to reload to.
    this.stopReloadWait();
    // Answers can arrive out of order; an older one says nothing new.
    if (saved.updatedAt.getTime() > this.held.updatedAt.getTime()) {
      this.held = saved;
      this.editor?.saved(saved.elements, appState);
    }
    this.settle();
  }

  saveFailed(save: number): void {
    if (this.saveSettled(save)) return;
    if (this.reloadWait && this.inFlight.size === 0) {
      this.stopReloadWait();
      this.applyReload();
    }
  }

  /** Answers whether this save was abandoned, so its answer means nothing. */
  private saveSettled(save: number): boolean {
    this.saveEpoch++;
    if (this.abandoned.delete(save)) return true;
    this.inFlight.delete(save);
    return false;
  }

  private stopReloadWait(): void {
    this.reloadWait?.();
    this.reloadWait = null;
  }

  private settle(): void {
    if (!this.conflict) return;
    this.conflict = null;
    this.notify({ kind: "settled" });
  }
}

function sameTime(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}
