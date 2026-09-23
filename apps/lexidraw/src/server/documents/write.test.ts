/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { SerializedEditorState } from "lexical";
import {
  appendMarkdownToDocument,
  DocumentGoneError,
  type DocumentRevision,
  type DocumentStore,
  insertMarkdownIntoDocument,
} from "./write";
import { StaleDocumentError } from "./conflict";
import {
  HeadingNotFoundError,
  InvalidDocumentContentError,
  markdownToEditorState,
  parseEditorState,
} from "./markdown";

const HOLOGRAM = { type: "hologram", version: 1, summary: "a slide" };

const DOCUMENT = JSON.stringify({
  root: {
    type: "root",
    version: 1,
    format: "",
    indent: 0,
    direction: null,
    children: [
      {
        type: "paragraph",
        version: 1,
        format: "",
        indent: 0,
        direction: null,
        textFormat: 0,
        textStyle: "",
        children: [{ type: "text", version: 1, text: "kept" }],
      },
      HOLOGRAM,
    ],
  },
});

const AT = (iso: string) => new Date(iso);
const FIRST = AT("2026-09-23T10:00:00.000Z");
const SECOND = AT("2026-09-23T11:00:00.000Z");

/**
 * The store the append talks to, with a hook for the write that another
 * writer wins. `onWrite` runs before the compare-and-set, so it can move the
 * row the way a concurrent save would.
 */
function fakeStore(
  revision: DocumentRevision,
  onWrite?: (attempt: number) => void,
) {
  let row: DocumentRevision | null = revision;
  let attempt = 0;
  const store: DocumentStore = {
    async read(id) {
      return row && row.id === id ? { ...row } : null;
    },
    async write(id, elements, expectedUpdatedAt) {
      onWrite?.(attempt++);
      if (
        !row ||
        row.id !== id ||
        row.updatedAt.getTime() !== expectedUpdatedAt.getTime()
      ) {
        return null;
      }
      row = { id, elements, updatedAt: SECOND };
      return { id, updatedAt: row.updatedAt };
    },
  };
  return {
    store,
    stored: () => row,
    move: (elements: string, updatedAt: Date) => {
      row = { id: revision.id, elements, updatedAt };
    },
    remove: () => {
      row = null;
    },
  };
}

const revision = (): DocumentRevision => ({
  id: "doc_1",
  elements: DOCUMENT,
  updatedAt: FIRST,
});

const storedState = (elements: string): SerializedEditorState =>
  parseEditorState(elements);

describe("appendMarkdownToDocument", () => {
  test("appends at the end and leaves the existing blocks alone", async () => {
    const db = fakeStore(revision());

    const result = await appendMarkdownToDocument(
      db.store,
      revision(),
      "## Added\n\nA line.",
    );

    expect(result).toEqual({
      id: "doc_1",
      updatedAt: SECOND,
      appendedBlocks: 2,
    });
    const children = storedState(db.stored()?.elements ?? "").root.children;
    expect(children.map((child) => child.type)).toEqual([
      "paragraph",
      "hologram",
      "heading",
      "paragraph",
    ]);
    expect(children[1]).toEqual(HOLOGRAM);
    expect(JSON.stringify(children.slice(0, 2))).toBe(
      JSON.stringify(storedState(DOCUMENT).root.children),
    );
  });

  test("a matching precondition writes, a stale one names the current updatedAt", async () => {
    const db = fakeStore(revision());

    await expect(
      appendMarkdownToDocument(
        db.store,
        revision(),
        "Added.",
        "2026-01-01T00:00:00.000Z",
      ),
    ).rejects.toThrow(new StaleDocumentError(FIRST));
    expect(db.stored()?.elements).toBe(DOCUMENT);

    const result = await appendMarkdownToDocument(
      db.store,
      revision(),
      "Added.",
      FIRST.toISOString(),
    );
    expect(result.appendedBlocks).toBe(1);
  });

  test("a save that lands between the read and the write is not clobbered", async () => {
    const moved = JSON.stringify({
      root: { ...storedState(DOCUMENT).root, children: [HOLOGRAM] },
    });
    const db = fakeStore(revision(), (attempt) => {
      if (attempt === 0) db.move(moved, SECOND);
    });

    const result = await appendMarkdownToDocument(
      db.store,
      revision(),
      "Added.",
    );

    // The retry appends to what the other writer left, not to the stale read.
    expect(result.appendedBlocks).toBe(1);
    const children = storedState(db.stored()?.elements ?? "").root.children;
    expect(children.map((child) => child.type)).toEqual([
      "hologram",
      "paragraph",
    ]);
  });

  test("losing the race twice is a conflict carrying the current updatedAt", async () => {
    const third = AT("2026-09-23T12:00:00.000Z");
    const fourth = AT("2026-09-23T13:00:00.000Z");
    const db = fakeStore(revision(), (attempt) =>
      db.move(DOCUMENT, attempt === 0 ? third : fourth),
    );

    await expect(
      appendMarkdownToDocument(db.store, revision(), "Added."),
    ).rejects.toThrow(new StaleDocumentError(fourth));
  });

  test("a precondition is not retried against a revision the caller has not seen", async () => {
    const db = fakeStore(revision(), (attempt) => {
      if (attempt === 0) db.move(DOCUMENT, SECOND);
    });

    await expect(
      appendMarkdownToDocument(
        db.store,
        revision(),
        "Added.",
        FIRST.toISOString(),
      ),
    ).rejects.toThrow(new StaleDocumentError(SECOND));
  });

  test("a document deleted under the append is gone, not stale", async () => {
    const db = fakeStore(revision(), () => db.remove());

    await expect(
      appendMarkdownToDocument(db.store, revision(), "Added."),
    ).rejects.toThrow(DocumentGoneError);
  });

  test("content that is not an editor state is rejected before any write", async () => {
    const db = fakeStore({ ...revision(), elements: "nope" });

    await expect(
      appendMarkdownToDocument(
        db.store,
        { ...revision(), elements: "nope" },
        "Added.",
      ),
    ).rejects.toThrow(InvalidDocumentContentError);
    expect(db.stored()?.elements).toBe("nope");
  });
});

// Blocks 0..3: heading "Title", paragraph, heading "Notes", paragraph.
const OUTLINE = JSON.stringify(
  markdownToEditorState("# Title\n\nIntro.\n\n## Notes\n\nA note."),
);

const outline = (): DocumentRevision => ({
  id: "doc_1",
  elements: OUTLINE,
  updatedAt: FIRST,
});

const AFTER_NOTES = { kind: "afterHeading" as const, text: "notes" };

describe("insertMarkdownIntoDocument", () => {
  test("puts the blocks directly below the matched heading", async () => {
    const db = fakeStore(outline());

    const result = await insertMarkdownIntoDocument(
      db.store,
      outline(),
      "Added.",
      AFTER_NOTES,
      FIRST.toISOString(),
    );

    expect(result).toEqual({
      id: "doc_1",
      updatedAt: SECOND,
      insertedBlocks: 1,
      blockIndex: 3,
    });
    const children = storedState(db.stored()?.elements ?? "").root.children;
    expect(children.map((child) => child.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "paragraph",
    ]);
    expect(JSON.stringify(children[3])).toBe(
      JSON.stringify(markdownToEditorState("Added.").root.children[0]),
    );
  });

  test("a block index counts top-level blocks, and its end appends", async () => {
    const db = fakeStore(outline());

    const result = await insertMarkdownIntoDocument(
      db.store,
      outline(),
      "Added.",
      { kind: "atBlockIndex", index: 4 },
      FIRST.toISOString(),
    );

    expect(result.blockIndex).toBe(4);
    const children = storedState(db.stored()?.elements ?? "").root.children;
    expect(children).toHaveLength(5);
  });

  test("a stale precondition writes nothing", async () => {
    const db = fakeStore(outline());

    await expect(
      insertMarkdownIntoDocument(
        db.store,
        outline(),
        "Added.",
        AFTER_NOTES,
        "2026-01-01T00:00:00.000Z",
      ),
    ).rejects.toThrow(new StaleDocumentError(FIRST));
    expect(db.stored()?.elements).toBe(OUTLINE);
  });

  test("losing the race with a precondition is a conflict, not a retry", async () => {
    const db = fakeStore(outline(), (attempt) => {
      if (attempt === 0) db.move(OUTLINE, SECOND);
    });

    await expect(
      insertMarkdownIntoDocument(
        db.store,
        outline(),
        "Added.",
        AFTER_NOTES,
        FIRST.toISOString(),
      ),
    ).rejects.toThrow(new StaleDocumentError(SECOND));
  });

  test("the retry resolves the placement against what the other writer left", async () => {
    // The same document with a paragraph pushed in front, so the heading the
    // insert was aiming at has moved one block down.
    const moved = JSON.stringify(
      markdownToEditorState(
        "Preface.\n\n# Title\n\nIntro.\n\n## Notes\n\nA note.",
      ),
    );
    const db = fakeStore(outline(), (attempt) => {
      if (attempt === 0) db.move(moved, SECOND);
    });

    const result = await insertMarkdownIntoDocument(
      db.store,
      outline(),
      "Added.",
      AFTER_NOTES,
    );

    expect(result.blockIndex).toBe(4);
    const children = storedState(db.stored()?.elements ?? "").root.children;
    expect(children.map((child) => child.type)).toEqual([
      "paragraph",
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "paragraph",
    ]);
  });

  test("a placement that matches nothing fails before any write", async () => {
    const db = fakeStore(outline());

    await expect(
      insertMarkdownIntoDocument(
        db.store,
        outline(),
        "Added.",
        { kind: "afterHeading", text: "Missing" },
        FIRST.toISOString(),
      ),
    ).rejects.toThrow(HeadingNotFoundError);
    expect(db.stored()?.elements).toBe(OUTLINE);
  });
});
