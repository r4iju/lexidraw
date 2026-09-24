/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { SerializedEditorState } from "lexical";
import {
  appendMarkdownToDocument,
  type DocumentChange,
  DocumentGoneError,
  type DocumentRevision,
  type DocumentStore,
  insertMarkdownIntoDocument,
  replaceMarkdownInDocument,
} from "./write";
import { StaleDocumentError } from "./conflict";
import {
  HeadingNotFoundError,
  InvalidDocumentContentError,
  markdownToEditorState,
  parseEditorState,
  UnsupportedNodeTypesError,
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
    async write(id, change, expectedUpdatedAt) {
      onWrite?.(attempt++);
      if (
        !row ||
        row.id !== id ||
        row.updatedAt.getTime() !== expectedUpdatedAt.getTime()
      ) {
        return null;
      }
      changes.push(change);
      row = { ...row, ...change, updatedAt: SECOND };
      return { id, updatedAt: row.updatedAt };
    },
  };
  const changes: DocumentChange[] = [];
  return {
    store,
    stored: () => row,
    changes,
    move: (elements: string, updatedAt: Date) => {
      row = { ...revision, elements, updatedAt };
    },
    remove: () => {
      row = null;
    },
  };
}

const revision = (): DocumentRevision => ({
  id: "doc_1",
  title: "Notes",
  elements: DOCUMENT,
  updatedAt: FIRST,
  appState: null,
  tags: [],
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
      title: "Notes",
      updatedAt: SECOND,
      appendedBlocks: 2,
      notes: [],
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
    ).rejects.toThrow(new StaleDocumentError(FIRST, "Document"));
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
    ).rejects.toThrow(new StaleDocumentError(fourth, "Document"));
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
    ).rejects.toThrow(new StaleDocumentError(SECOND, "Document"));
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
  title: "Notes",
  elements: OUTLINE,
  updatedAt: FIRST,
  appState: null,
  tags: [],
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
      title: "Notes",
      updatedAt: SECOND,
      insertedBlocks: 1,
      blockIndex: 3,
      notes: [],
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
    ).rejects.toThrow(new StaleDocumentError(FIRST, "Document"));
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
    ).rejects.toThrow(new StaleDocumentError(SECOND, "Document"));
  });

  test("without a precondition the retry re-resolves the placement", async () => {
    // Only reachable from here: insertMarkdown makes the precondition
    // mandatory, so the router's inserts never retry.
    //
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

// A node with no markdown form, so the only way it survives a replace is the
// placeholder the read wrote for it.
const VIDEO = {
  type: "video",
  version: 1,
  src: "https://example.com/clip.mp4",
};
const KEEP_VIDEO = "<!-- lexidraw:video#1 a summary -->";

const filmed = (): DocumentRevision => ({
  id: "doc_1",
  title: "Notes",
  elements: JSON.stringify({
    root: { ...storedState(DOCUMENT).root, children: [VIDEO] },
  }),
  updatedAt: FIRST,
  appState: null,
  tags: [],
});

describe("replaceMarkdownInDocument", () => {
  test("rewrites the document and reports what the placeholders did", async () => {
    const db = fakeStore(filmed());

    const result = await replaceMarkdownInDocument(
      db.store,
      filmed(),
      `# New\n\n${KEEP_VIDEO}`,
      FIRST.toISOString(),
    );

    expect(result).toEqual({
      id: "doc_1",
      title: "Notes",
      updatedAt: SECOND,
      blocks: 2,
      restoredPlaceholders: 1,
      removedPlaceholders: 0,
      notes: [],
    });
    const children = storedState(db.stored()?.elements ?? "").root.children;
    expect(children.map((child) => child.type)).toEqual(["heading", "video"]);
    expect(children[1]).toEqual(VIDEO);
  });

  test("a placeholder the markdown drops deletes its node", async () => {
    const db = fakeStore(filmed());

    const result = await replaceMarkdownInDocument(
      db.store,
      filmed(),
      "# New",
      FIRST.toISOString(),
    );

    expect(result.blocks).toBe(1);
    expect(result.removedPlaceholders).toBe(1);
    expect(
      storedState(db.stored()?.elements ?? "").root.children.map(
        (child) => child.type,
      ),
    ).toEqual(["heading"]);
  });

  test("a stale precondition writes nothing", async () => {
    const db = fakeStore(filmed());

    await expect(
      replaceMarkdownInDocument(
        db.store,
        filmed(),
        "# New",
        "2026-01-01T00:00:00.000Z",
      ),
    ).rejects.toThrow(new StaleDocumentError(FIRST, "Document"));
    expect(db.stored()?.elements).toBe(filmed().elements);
  });

  test("losing the race is a conflict, never a retry", async () => {
    let writes = 0;
    const db = fakeStore(filmed(), (attempt) => {
      writes = attempt + 1;
      if (attempt === 0) db.move(filmed().elements, SECOND);
    });

    await expect(
      replaceMarkdownInDocument(
        db.store,
        filmed(),
        "# New",
        FIRST.toISOString(),
      ),
    ).rejects.toThrow(new StaleDocumentError(SECOND, "Document"));
    expect(writes).toBe(1);
  });

  test("a stored node type the editor cannot build blocks the write", async () => {
    // DOCUMENT holds a hologram, which has neither a markdown form nor a
    // placeholder, so a replace could only drop it unannounced.
    const db = fakeStore(revision());

    await expect(
      replaceMarkdownInDocument(
        db.store,
        revision(),
        "# New",
        FIRST.toISOString(),
      ),
    ).rejects.toThrow(UnsupportedNodeTypesError);
    expect(db.stored()?.elements).toBe(DOCUMENT);
  });

  test("a stale precondition is answered before the content is read", async () => {
    const broken = { ...revision(), elements: "nope" };
    const db = fakeStore(broken);

    await expect(
      replaceMarkdownInDocument(
        db.store,
        broken,
        "# New",
        "2020-01-01T00:00:00.000Z",
      ),
    ).rejects.toThrow(new StaleDocumentError(FIRST, "Document"));
  });

  test("a document deleted under the replace is gone, not stale", async () => {
    const db = fakeStore(filmed(), () => db.remove());

    await expect(
      replaceMarkdownInDocument(
        db.store,
        filmed(),
        "# New",
        FIRST.toISOString(),
      ),
    ).rejects.toThrow(DocumentGoneError);
  });
});

describe("interpretation notes", () => {
  const WIDE = `| ${"abcdefg".split("").join(" | ")} |\n|${" --- |".repeat(7)}\n| ${"1234567".split("").join(" | ")} |`;

  test("every write answers with how its markdown was read", async () => {
    const appended = await appendMarkdownToDocument(
      fakeStore(revision()).store,
      revision(),
      WIDE,
    );
    expect(appended.notes).toEqual([expect.stringContaining("7 columns")]);

    const inserted = await insertMarkdownIntoDocument(
      fakeStore(revision()).store,
      revision(),
      "> [!danger]\n> Hot.",
      { kind: "atBlockIndex", index: 0 },
    );
    expect(inserted.notes).toEqual([
      expect.stringContaining("[!danger] became a caution callout"),
    ]);

    const replaced = await replaceMarkdownInDocument(
      fakeStore(filmed()).store,
      filmed(),
      `${WIDE}\n\n${KEEP_VIDEO}`,
      FIRST.toISOString(),
    );
    expect(replaced.notes).toEqual([expect.stringContaining("7 columns")]);
  });
});

describe("front matter and the leading heading on a write", () => {
  const FRONT_MATTER = [
    "---",
    "title: Kyoto in Autumn",
    "tags: [travel, japan]",
    "subtitle: Two days of maples",
    "lang: ja",
    "---",
    "",
    "Body.",
  ].join("\n");

  test("a replace stores the title, the tags and the language on the document", async () => {
    const stored = {
      ...filmed(),
      appState: JSON.stringify({ defaultFontFamily: "Noto Serif" }),
    };
    const db = fakeStore(stored);

    await replaceMarkdownInDocument(
      db.store,
      stored,
      FRONT_MATTER,
      FIRST.toISOString(),
    );

    const [change] = db.changes;
    expect(change?.title).toBe("Kyoto in Autumn");
    expect(change?.tags).toEqual(["travel", "japan"]);
    expect(JSON.parse(change?.appState ?? "null")).toEqual({
      defaultFontFamily: "Noto Serif",
      lang: "ja",
    });
    const root = storedState(change?.elements ?? "").root as unknown as {
      $?: unknown;
    };
    expect(root.$).toEqual({ header: { subtitle: "Two days of maples" } });
  });

  test("fields the front matter repeats unchanged are not written", async () => {
    const stored = {
      ...filmed(),
      title: "Kyoto in Autumn",
      tags: ["japan", "travel"],
      appState: JSON.stringify({ lang: "ja" }),
    };
    const db = fakeStore(stored);

    await replaceMarkdownInDocument(
      db.store,
      stored,
      FRONT_MATTER,
      FIRST.toISOString(),
    );

    expect(Object.keys(db.changes[0] ?? {})).toEqual(["elements"]);
  });

  test("a leading heading names an empty untitled document it is appended to", async () => {
    const empty = {
      ...revision(),
      title: "Untitled",
      elements: JSON.stringify({
        root: { ...storedState(DOCUMENT).root, children: [] },
      }),
    };
    const db = fakeStore(empty);

    const result = await appendMarkdownToDocument(
      db.store,
      empty,
      "# Kyoto in Autumn\n\nBody.",
    );

    expect(db.changes[0]?.title).toBe("Kyoto in Autumn");
    expect(result.appendedBlocks).toBe(1);
    expect(result.notes).toEqual([
      'The leading heading "Kyoto in Autumn" became the document title',
    ]);
  });

  test("a leading heading appended below content stays a heading", async () => {
    const db = fakeStore({ ...revision(), title: "Untitled" });

    await appendMarkdownToDocument(
      db.store,
      { ...revision(), title: "Untitled" },
      "# Kyoto in Autumn\n\nBody.",
    );

    expect(db.changes[0]?.title).toBeUndefined();
    const children = storedState(db.stored()?.elements ?? "").root.children;
    expect(children.map((child) => child.type)).toContain("heading");
  });
});
