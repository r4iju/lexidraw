import { StaleDocumentError } from "./conflict";
import {
  appendBlocks,
  markdownToEditorState,
  parseEditorState,
} from "./markdown";

/** A document as an append needs to see it, already checked for write access. */
export type DocumentRevision = {
  id: string;
  elements: string;
  updatedAt: Date;
};

/**
 * The storage an append talks to. `write` is compare-and-set: it stores
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

// Every transformer today yields at least an empty paragraph, so this guards
// against a future one silently rewriting the document with nothing added.
export class EmptyMarkdownError extends Error {
  constructor() {
    super("Markdown produced no blocks");
    this.name = "EmptyMarkdownError";
  }
}

export class DocumentGoneError extends Error {
  constructor() {
    super("Document not found");
    this.name = "DocumentGoneError";
  }
}

export type AppendResult = {
  id: string;
  updatedAt: Date;
  appendedBlocks: number;
};

/**
 * Appends `markdown` to the end of `revision` and stores the result.
 *
 * The write is a compare-and-set against the `updatedAt` the blocks were
 * appended to, so a save that lands between the read and the write is never
 * clobbered. Without a precondition, losing that race is retried once against
 * what the other writer left. With one, the retry would append to a revision
 * the caller has not seen, so a lost race is a conflict straight away.
 */
export async function appendMarkdownToDocument(
  store: DocumentStore,
  revision: DocumentRevision,
  markdown: string,
  ifUnmodifiedSince?: string,
): Promise<AppendResult> {
  let current = revision;
  let state = parseEditorState(current.elements);
  const blocks = markdownToEditorState(markdown).root.children;
  if (blocks.length === 0) {
    throw new EmptyMarkdownError();
  }
  if (
    ifUnmodifiedSince !== undefined &&
    new Date(ifUnmodifiedSince).getTime() !== current.updatedAt.getTime()
  ) {
    throw new StaleDocumentError(current.updatedAt);
  }

  for (let attempt = 0; ; attempt++) {
    const written = await store.write(
      current.id,
      JSON.stringify(appendBlocks(state, blocks)),
      current.updatedAt,
    );
    if (written) {
      return { ...written, appendedBlocks: blocks.length };
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
