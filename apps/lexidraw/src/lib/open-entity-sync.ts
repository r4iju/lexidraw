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
 *   chooses. Saves wait while the question stands, since a save would
 *   answer it. Keeping theirs is not asked again for the same content, and a
 *   question already asked is not worked out again by the next poll.
 *
 * The editor's own saves go through here too, one at a time, each carrying the
 * revision the one before produced (see `save`). The server refuses a save
 * whose revision has moved on, and that refusal is decided exactly like a check
 * that found the move, so a write that lands between two keystrokes is asked
 * about even before any poll sees it.
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

/** What a save stores: `appState` for the editors that keep one. */
export type SaveContent = { elements: string; appState?: string };

/**
 * What became of a save: stored, by itself or by a later one sent in its
 * place, or dropped because the user reloaded what was written elsewhere.
 */
export type SaveOutcome = "saved" | "dropped";

export interface SyncSource {
  /**
   * The stored revision's `updatedAt`, without its content; null once the
   * entity is gone for this user, deleted or no longer shared.
   */
  updatedAt(): Promise<Date | null>;
  load(): Promise<StoredRevision>;
  /**
   * Stores `content` if the entity still carries `ifUnmodifiedSince`, and
   * answers the `updatedAt` it carries then; answers null, storing nothing,
   * when it has moved on.
   */
  save(content: SaveContent, ifUnmodifiedSince: Date): Promise<Date | null>;
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

export type Clock = { now(): number };

const realClock: Clock = { now: () => Date.now() };

/** How long polls leave a gone entity alone. */
const GONE_POLL_MS = 5 * 60_000;

/** A save not sent yet, and everyone waiting for it or for one it replaced. */
type QueuedSave = {
  content: SaveContent;
  waiters: {
    resolve(outcome: SaveOutcome): void;
    reject(error: unknown): void;
  }[];
};

export class OpenEntitySync {
  private editor: SyncedEditor | null = null;
  private checking = false;
  /** A save is on the wire, or its refusal is being decided. */
  private sending = false;
  /** The latest content asked to be saved and not sent yet. */
  private queued: QueuedSave | null = null;
  /** Bumped by every save, so a check that straddles one is dropped. */
  private saveEpoch = 0;
  /** The last revision loaded, so asking again for it costs no download. */
  private lastLoaded: StoredRevision | null = null;
  private conflict: StoredRevision | null = null;
  /** The stored revision last put to the user, asked or kept over. */
  private asked: Date | null = null;
  /** The content the user chose to keep their edits over. */
  private kept: string | null = null;
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
    if (this.checking || this.sending || !this.editor) return;
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
    if (stored.elements === this.held.elements) {
      this.held = stored;
      this.settle();
      return;
    }
    if (editor.shows(stored.elements)) {
      this.held = stored;
      // What the user sees is stored; a save queued before would take it back.
      this.finishQueued("saved");
      this.settle();
      return;
    }
    if (!editor.hasLocalEdits()) {
      // Replaced before it is held: a replace that throws leaves the editor
      // behind the stored revision, and the next check tries again.
      editor.replace(stored);
      this.held = stored;
      this.finishQueued("dropped");
      this.settle();
      this.notify({ kind: "reloaded" });
      return;
    }
    this.asked = stored.updatedAt;
    if (this.kept === stored.elements) {
      this.held = stored;
      return;
    }
    this.conflict = stored;
    this.notify({ kind: "conflict" });
  }

  /**
   * A question stands, and a save would answer it by overwriting what was
   * written elsewhere. Saves wait for the answer.
   */
  holdsSaves(): boolean {
    return this.conflict !== null;
  }

  /** The user chose the stored revision over their edits. */
  reload(): void {
    const stored = this.conflict;
    if (!stored || !this.editor) return;
    // Nothing is on the wire: saves wait while a question stands, and one
    // that was refused is what raised it.
    this.editor.replace(stored);
    this.held = stored;
    this.finishQueued("dropped");
    this.settle();
  }

  /** The user chose their edits: the next save overwrites the stored ones. */
  keep(): void {
    const stored = this.conflict;
    if (!stored) return;
    this.kept = stored.elements;
    this.held = stored;
    this.settle();
    this.notify({ kind: "resumed" });
    this.sendQueued();
  }

  /**
   * Saves `content` over the revision this editor holds.
   *
   * One save is on the wire at a time. A second one sent before the first
   * answers would carry a revision the first is about to replace, so it waits,
   * and only the latest of those waiting is sent: it holds everything the
   * earlier ones did. A refused save waits for the question it raises, then
   * goes out over the revision the user kept their edits over, or is dropped
   * with the edits.
   */
  save(content: SaveContent): Promise<SaveOutcome> {
    return new Promise((resolve, reject) => {
      this.queued = {
        content,
        waiters: [...(this.queued?.waiters ?? []), { resolve, reject }],
      };
      this.sendQueued();
    });
  }

  private sendQueued(): void {
    const queued = this.queued;
    if (!queued || this.sending || this.conflict) return;
    this.queued = null;
    this.sending = true;
    this.saveEpoch++;
    this.send(queued).finally(() => {
      this.sending = false;
      this.saveEpoch++;
      this.sendQueued();
    });
  }

  private async send(save: QueuedSave): Promise<void> {
    let updatedAt: Date | null;
    try {
      updatedAt = await this.source.save(save.content, this.held.updatedAt);
    } catch (error) {
      for (const waiter of save.waiters) waiter.reject(error);
      return;
    }
    if (updatedAt) {
      this.held = { updatedAt, elements: save.content.elements };
      this.editor?.saved(save.content.elements, save.content.appState);
      for (const waiter of save.waiters) waiter.resolve("saved");
      return;
    }
    // Refused: this content, or anything newer asked for meanwhile, waits
    // for what the stored revision decides.
    this.queued = {
      content: this.queued?.content ?? save.content,
      waiters: [...save.waiters, ...(this.queued?.waiters ?? [])],
    };
    try {
      const stored = await this.source.load();
      this.lastLoaded = stored;
      this.reconcile(stored);
    } catch (error) {
      for (const waiter of this.takeQueued()) waiter.reject(error);
    }
  }

  /** Answers everyone waiting on a save that will not be sent. */
  private finishQueued(outcome: SaveOutcome): void {
    for (const waiter of this.takeQueued()) waiter.resolve(outcome);
  }

  private takeQueued(): QueuedSave["waiters"] {
    const waiters = this.queued?.waiters ?? [];
    this.queued = null;
    return waiters;
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
