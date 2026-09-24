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
 *   answer it. Keeping theirs is not asked again for the same content.
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
  /** The server now stores `elements`, which this editor sent. */
  saved(elements: string): void;
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
  | { kind: "settled" };

export class OpenEntitySync {
  private editor: SyncedEditor | null = null;
  private checking = false;
  private savesInFlight = 0;
  /** Bumped by every save, so a check that straddles one is dropped. */
  private saveEpoch = 0;
  /** The last revision loaded, so asking again for it costs no download. */
  private lastLoaded: StoredRevision | null = null;
  private conflict: StoredRevision | null = null;
  /** The content the user chose to keep their edits over. */
  private kept: string | null = null;
  /** The user chose to reload while a save was in flight. */
  private reloadAfterSave = false;
  private gone = false;

  constructor(
    private held: StoredRevision,
    private readonly source: SyncSource,
    private readonly notify: (notice: SyncNotice) => void,
  ) {}

  /** The editor, once it can answer; checks wait for it. */
  attach(editor: SyncedEditor | null): void {
    this.editor = editor;
  }

  async check(): Promise<void> {
    if (this.gone || this.checking || this.savesInFlight > 0 || !this.editor)
      return;
    this.checking = true;
    try {
      const epoch = this.saveEpoch;
      const updatedAt = await this.source.updatedAt();
      if (!updatedAt) {
        this.gone = true;
        return;
      }
      if (epoch !== this.saveEpoch || sameTime(updatedAt, this.held.updatedAt))
        return;
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
    const stored = this.conflict;
    if (!stored || !this.editor) return;
    // A save on the wire decides what is stored; see `saveFailed` and
    // `saveSucceeded`.
    if (this.savesInFlight > 0) {
      this.reloadAfterSave = true;
      return;
    }
    this.editor.replace(stored);
    this.held = stored;
    this.settle();
  }

  /** The user chose their edits; saving them will overwrite the stored ones. */
  keep(): void {
    if (!this.conflict) return;
    this.kept = this.conflict.elements;
    this.settle();
  }

  saveStarted(): void {
    this.savesInFlight++;
    this.saveEpoch++;
  }

  saveSucceeded(saved: StoredRevision): void {
    this.saveSettled();
    // The stored content is the user's now: there is nothing to reload to.
    this.reloadAfterSave = false;
    // Answers can arrive out of order; an older one says nothing new.
    if (saved.updatedAt.getTime() > this.held.updatedAt.getTime()) {
      this.held = saved;
      this.editor?.saved(saved.elements);
    }
    this.settle();
  }

  saveFailed(): void {
    this.saveSettled();
    if (this.reloadAfterSave && this.savesInFlight === 0) {
      this.reloadAfterSave = false;
      this.reload();
    }
  }

  private saveSettled(): void {
    this.savesInFlight = Math.max(0, this.savesInFlight - 1);
    this.saveEpoch++;
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
