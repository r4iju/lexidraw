import { StaleDocumentError } from "./conflict";
import {
  type InsertPlacement,
  insertBlocks,
  markdownToEditorState,
  parseEditorState,
  resolveInsertIndex,
} from "./markdown";
import { replaceStateFromMarkdown } from "./replace";

/** A document as a write needs to see it, already checked for write access. */
export type DocumentRevision = {
  id: string;
  elements: string;
  updatedAt: Date;
};

/**
 * The storage a write talks to. `write` is compare-and-set: it stores
 * `elements` only while the row still carries `expectedUpdatedAt`, and answers
 * null when another write got there first.
 */
export type DocumentStore = {
  read(id: string): Promise<DocumentRevision | null>;
  write(
    id: string,
    elements: string,
    expectedUpdatedAt: Date,
  ): Promise<{ id: string; updatedAt: Date } | null>;
};

export class DocumentGoneError extends Error {
  constructor() {
    super("Document not found");
    this.name = "DocumentGoneError";
  }
}

export type InsertResult = {
  id: string;
  updatedAt: Date;
  insertedBlocks: number;
  /** Where the first inserted block ended up among the root's children. */
  blockIndex: number;
};

export type AppendResult = {
  id: string;
  updatedAt: Date;
  appendedBlocks: number;
};

export type ReplaceResult = {
  id: string;
  updatedAt: Date;
  /** Top-level blocks the document now holds. */
  blocks: number;
  restoredPlaceholders: number;
  removedPlaceholders: number;
};

/**
 * Inserts `markdown` into `revision` where `placement` says and stores the
 * result.
 *
 * The write is a compare-and-set against the `updatedAt` the blocks were
 * inserted into, so a save that lands between the read and the write is never
 * clobbered. Without a precondition, losing that race is retried once against
 * what the other writer left. With one, the retry would insert into a revision
 * the caller has not seen, so a lost race is a conflict straight away.
 */
export async function insertMarkdownIntoDocument(
  store: DocumentStore,
  revision: DocumentRevision,
  markdown: string,
  placement: InsertPlacement,
  ifUnmodifiedSince?: string,
): Promise<InsertResult> {
  let current = revision;
  let state = parseEditorState(current.elements);
  const blocks = markdownToEditorState(markdown).root.children;
  if (
    ifUnmodifiedSince !== undefined &&
    new Date(ifUnmodifiedSince).getTime() !== current.updatedAt.getTime()
  ) {
    throw new StaleDocumentError(current.updatedAt);
  }

  for (let attempt = 0; ; attempt++) {
    // Resolved against the state this attempt writes into, never against the
    // stale read. Only a call without a precondition retries today, and the
    // only placement such a call carries is the append's `end`.
    const blockIndex = resolveInsertIndex(state, placement);
    const written = await store.write(
      current.id,
      JSON.stringify(insertBlocks(state, blockIndex, blocks)),
      current.updatedAt,
    );
    if (written) {
      return { ...written, insertedBlocks: blocks.length, blockIndex };
    }
    const reread = await store.read(current.id);
    if (!reread) {
      throw new DocumentGoneError();
    }
    if (attempt > 0 || ifUnmodifiedSince !== undefined) {
      throw new StaleDocumentError(reread.updatedAt);
    }
    current = reread;
    state = parseEditorState(current.elements);
  }
}

/**
 * Rewrites `revision` to hold what `markdown` says and stores the result.
 *
 * The precondition is required rather than optional: a replace decides what
 * every block of the document becomes, including which nodes without a
 * markdown form survive, so it can only be resolved against the revision the
 * caller read. Losing the compare-and-set is therefore a conflict, never a
 * retry.
 */
export async function replaceMarkdownInDocument(
  store: DocumentStore,
  revision: DocumentRevision,
  markdown: string,
  ifUnmodifiedSince: string,
): Promise<ReplaceResult> {
  // Before the stored content is looked at, so a caller holding a stale
  // revision of a document that is now unreadable still hears about the race
  // rather than about the content, exactly as an insert would.
  if (new Date(ifUnmodifiedSince).getTime() !== revision.updatedAt.getTime()) {
    throw new StaleDocumentError(revision.updatedAt);
  }
  const stored = parseEditorState(revision.elements);
  const { state, restoredPlaceholders, removedPlaceholders } =
    replaceStateFromMarkdown(stored, markdown);

  const written = await store.write(
    revision.id,
    JSON.stringify(state),
    revision.updatedAt,
  );
  if (written) {
    return {
      ...written,
      blocks: state.root.children.length,
      restoredPlaceholders,
      removedPlaceholders,
    };
  }
  const reread = await store.read(revision.id);
  if (!reread) {
    throw new DocumentGoneError();
  }
  throw new StaleDocumentError(reread.updatedAt);
}

/** {@link insertMarkdownIntoDocument} at the end of the document. */
export async function appendMarkdownToDocument(
  store: DocumentStore,
  revision: DocumentRevision,
  markdown: string,
  ifUnmodifiedSince?: string,
): Promise<AppendResult> {
  const { id, updatedAt, insertedBlocks } = await insertMarkdownIntoDocument(
    store,
    revision,
    markdown,
    { kind: "end" },
    ifUnmodifiedSince,
  );
  return { id, updatedAt, appendedBlocks: insertedBlocks };
}
