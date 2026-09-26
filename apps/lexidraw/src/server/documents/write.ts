import { documentHeaderOf, withDocumentHeader } from "@packages/lexical-nodes";
import type { SerializedEditorState } from "lexical";
import { StaleDocumentError } from "./conflict";
import {
  type DocumentFields,
  type InsertPlacement,
  insertBlocks,
  interpretDocumentMarkdown,
  parseEditorState,
  resolveInsertIndex,
} from "./markdown";
import { replaceStateFromMarkdown } from "./replace";

/** A document as a write needs to see it, already checked for write access. */
export type DocumentRevision = {
  id: string;
  title: string;
  elements: string;
  updatedAt: Date;
  /** The document settings, JSON, such as the chosen language. */
  appState: string | null;
  tags: string[];
};

/** What a write stores: always the content, the rest only when it changes. */
export type DocumentChange = {
  elements: string;
  title?: string;
  appState?: string;
  /** The writer's tags on the document, replacing theirs. */
  tags?: string[];
};

/**
 * The storage a write talks to. `write` is compare-and-set: it stores the
 * change only while the row still carries `expectedUpdatedAt`, and answers
 * null when another write got there first.
 */
export type DocumentStore = {
  read(id: string): Promise<DocumentRevision | null>;
  write(
    id: string,
    change: DocumentChange,
    expectedUpdatedAt: Date,
  ): Promise<{ id: string; updatedAt: Date } | null>;
};

function settingsOf(appState: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(appState ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** The language the document settings chose, or null to detect it. */
export const languageOf = (appState: string | null) => {
  const { lang } = settingsOf(appState);
  return typeof lang === "string" ? lang : null;
};

/** The entity as a markdown write reads its front matter against. */
export const writeTarget = (revision: DocumentRevision) => ({
  id: revision.id,
  title: revision.title,
  tags: revision.tags,
  lang: languageOf(revision.appState),
});

const sameTags = (a: string[], b: string[]) =>
  a.length === b.length && a.every((tag) => b.includes(tag));

/** `state` stored together with whichever of `fields` differ from `revision`. */
function documentChange(
  revision: DocumentRevision,
  state: SerializedEditorState,
  fields: DocumentFields,
): DocumentChange {
  const change: DocumentChange = { elements: JSON.stringify(state) };
  if (fields.title !== undefined && fields.title !== revision.title)
    change.title = fields.title;
  if (fields.tags !== undefined && !sameTags(fields.tags, revision.tags))
    change.tags = fields.tags;
  if (
    fields.lang !== undefined &&
    fields.lang !== languageOf(revision.appState)
  ) {
    change.appState = JSON.stringify({
      ...settingsOf(revision.appState),
      lang: fields.lang,
    });
  }
  return change;
}

/**
 * What `blank`, a document being created, holds once written from
 * `markdown`, read as a replace of it reads it.
 */
export function createdFromMarkdown(
  blank: DocumentRevision,
  markdown: string,
): DocumentChange {
  const { state, fields } = replaceStateFromMarkdown(
    parseEditorState(blank.elements),
    markdown,
    writeTarget(blank),
  );
  return documentChange(blank, state, fields);
}

/** A document nothing has been written into yet. */
const isEmpty = (state: SerializedEditorState) =>
  state.root.children.every(
    (child) =>
      child.type === "paragraph" &&
      (!("children" in child) ||
        (Array.isArray(child.children) && child.children.length === 0)),
  );

export class DocumentGoneError extends Error {
  constructor() {
    super("Document not found");
    this.name = "DocumentGoneError";
  }
}

export type InsertResult = {
  id: string;
  /** The title after the write, which front matter or a heading may set. */
  title: string;
  updatedAt: Date;
  insertedBlocks: number;
  /** Where the first inserted block ended up among the root's children. */
  blockIndex: number;
  /** How the markdown was read, for the writer to check against its intent. */
  notes: string[];
};

export type AppendResult = {
  id: string;
  /** The title after the write, which front matter or a heading may set. */
  title: string;
  updatedAt: Date;
  appendedBlocks: number;
  notes: string[];
};

export type ReplaceResult = {
  id: string;
  /** The title after the write, which front matter or a heading may set. */
  title: string;
  updatedAt: Date;
  /** Top-level blocks the document now holds. */
  blocks: number;
  restoredPlaceholders: number;
  removedPlaceholders: number;
  notes: string[];
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
  const {
    state: parsed,
    notes,
    fields,
    header,
  } = interpretDocumentMarkdown(markdown, {
    ...writeTarget(current),
    header: documentHeaderOf(state),
    titleFromHeading: isEmpty(state),
  });
  const blocks = parsed.root.children;
  if (
    ifUnmodifiedSince !== undefined &&
    new Date(ifUnmodifiedSince).getTime() !== current.updatedAt.getTime()
  ) {
    throw new StaleDocumentError(current.updatedAt, "Document");
  }

  for (let attempt = 0; ; attempt++) {
    // Resolved against the state this attempt writes into, never against the
    // stale read. Only a call without a precondition retries today, and the
    // only placement such a call carries is the append's `end`.
    const blockIndex = resolveInsertIndex(state, placement);
    const inserted = insertBlocks(state, blockIndex, blocks);
    const change = documentChange(
      current,
      header ? withDocumentHeader(inserted, header) : inserted,
      fields,
    );
    const written = await store.write(current.id, change, current.updatedAt);
    if (written) {
      return {
        ...written,
        title: change.title ?? current.title,
        insertedBlocks: blocks.length,
        blockIndex,
        notes,
      };
    }
    const reread = await store.read(current.id);
    if (!reread) {
      throw new DocumentGoneError();
    }
    if (attempt > 0 || ifUnmodifiedSince !== undefined) {
      throw new StaleDocumentError(reread.updatedAt, "Document");
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
    throw new StaleDocumentError(revision.updatedAt, "Document");
  }
  const stored = parseEditorState(revision.elements);
  const { state, restoredPlaceholders, removedPlaceholders, notes, fields } =
    replaceStateFromMarkdown(stored, markdown, writeTarget(revision));

  const change = documentChange(revision, state, fields);
  const written = await store.write(revision.id, change, revision.updatedAt);
  if (written) {
    return {
      ...written,
      title: change.title ?? revision.title,
      blocks: state.root.children.length,
      restoredPlaceholders,
      removedPlaceholders,
      notes,
    };
  }
  const reread = await store.read(revision.id);
  if (!reread) {
    throw new DocumentGoneError();
  }
  throw new StaleDocumentError(reread.updatedAt, "Document");
}

/** {@link insertMarkdownIntoDocument} at the end of the document. */
export async function appendMarkdownToDocument(
  store: DocumentStore,
  revision: DocumentRevision,
  markdown: string,
  ifUnmodifiedSince?: string,
): Promise<AppendResult> {
  const { id, title, updatedAt, insertedBlocks, notes } =
    await insertMarkdownIntoDocument(
      store,
      revision,
      markdown,
      { kind: "end" },
      ifUnmodifiedSince,
    );
  return { id, title, updatedAt, appendedBlocks: insertedBlocks, notes };
}
