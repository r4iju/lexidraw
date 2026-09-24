/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { SerializedEditorState } from "lexical";
import {
  AmbiguousHeadingError,
  appendBlocks,
  BlockIndexOutOfRangeError,
  collectNodeTypes,
  editorStateToMarkdown,
  HeadingNotFoundError,
  insertBlocks,
  InvalidDocumentContentError,
  markdownToEditorState,
  parseEditorState,
  resolveInsertIndex,
  UnsupportedNodeTypesError,
  unsupportedNodeTypes,
  withFrontmatter,
} from "./markdown";

const SAMPLE = `# Heading one

Some **bold** and *italic* text with a [link](https://example.com).

## List

- first
- second

1. one
2. two

\`\`\`ts
const x: number = 1;
\`\`\`

| a | b |
| --- | --- |
| 1 | 2 |

> quote

***`;

const withNode = (type: string): SerializedEditorState =>
  ({
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
          children: [{ type: "text", version: 1, text: "hi" } as never],
        } as never,
        { type, version: 1 } as never,
        { type: "hologram", version: 1 } as never,
      ],
    },
  }) as SerializedEditorState;

describe("editorStateToMarkdown", () => {
  test("rich text round-trips through the headless editor", () => {
    // The importer keeps the spaces around table cells, so trim them before
    // comparing rows; documents edited in the browser have no such padding.
    const markdown = editorStateToMarkdown(markdownToEditorState(SAMPLE))
      .split("\n")
      .map((line) =>
        line.startsWith("|")
          ? `| ${line
              .split("|")
              .slice(1, -1)
              .map((cell) => cell.trim())
              .join(" | ")} |`
          : line,
      )
      .join("\n");
    for (const line of [
      "# Heading one",
      "Some **bold** and *italic* text with a [link](https://example.com).",
      "## List",
      "- first",
      "- second",
      "1. one",
      "2. two",
      "```ts",
      "const x: number = 1;",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "> quote",
      "***",
    ]) {
      expect(markdown).toContain(line);
    }
  });

  test("names every unsupported node type once, in document order", () => {
    // Every type the editor registers has a markdown form or a placeholder,
    // so only types no editor knows about reach this path.
    const state = withNode("phantom");
    expect(collectNodeTypes(state)).toEqual([
      "root",
      "paragraph",
      "text",
      "phantom",
      "hologram",
    ]);
    expect(unsupportedNodeTypes(state)).toEqual(["phantom", "hologram"]);
    expect(() => editorStateToMarkdown(state)).toThrow(
      UnsupportedNodeTypesError,
    );
    expect(() => editorStateToMarkdown(state)).toThrow(
      "Document contains node types without a markdown form yet: phantom, hologram",
    );
  });

  test("rejects content that is not an editor state", () => {
    for (const content of [
      '{"elements":[]}',
      "[]",
      "{}",
      '{"root":{}}',
      "nope",
    ]) {
      expect(() => parseEditorState(content)).toThrow(
        InvalidDocumentContentError,
      );
    }
  });

  test("an empty document is empty markdown", () => {
    const state = withNode("paragraph");
    state.root.children = [];
    expect(editorStateToMarkdown(state)).toBe("");
  });
});

describe("markdownToEditorState", () => {
  test("each block of markdown becomes one top-level node", () => {
    const state = markdownToEditorState("# Title\n\nA line.\n\n- one\n- two");
    expect(state.root.children.map((child) => child.type)).toEqual([
      "heading",
      "paragraph",
      "list",
    ]);
  });
});

describe("appendBlocks", () => {
  test("appends after the existing children without touching the input", () => {
    const state = withNode("phantom");
    const before = JSON.stringify(state);
    const blocks = markdownToEditorState("Added.").root.children;

    const appended = appendBlocks(state, blocks);

    expect(JSON.stringify(state)).toBe(before);
    expect(appended.root.children).toEqual([...state.root.children, ...blocks]);
    // Blocks with no markdown form survive an append untouched: nothing
    // re-parses or re-serializes them.
    expect(JSON.stringify(appended.root.children.slice(0, 3))).toBe(
      JSON.stringify(state.root.children),
    );
  });
});

describe("insertBlocks", () => {
  test("splices at the index without touching the input", () => {
    const state = withNode("phantom");
    const before = JSON.stringify(state);
    const blocks = markdownToEditorState("Added.").root.children;

    const inserted = insertBlocks(state, 1, blocks);

    expect(JSON.stringify(state)).toBe(before);
    expect(inserted.root.children).toEqual([
      ...state.root.children.slice(0, 1),
      ...blocks,
      ...state.root.children.slice(1),
    ]);
    // Blocks with no markdown form survive an insert untouched: nothing
    // re-parses or re-serializes them.
    expect(JSON.stringify(inserted.root.children.slice(2))).toBe(
      JSON.stringify(state.root.children.slice(1)),
    );
  });
});

describe("resolveInsertIndex", () => {
  // Blocks 0..5: heading, paragraph, heading, paragraph, heading, paragraph.
  const OUTLINE = markdownToEditorState(
    `# Title

Intro.

## Notes

First note.

## notes

Second note.`,
  );

  test("end is after the last block", () => {
    expect(resolveInsertIndex(OUTLINE, { kind: "end" })).toBe(6);
  });

  test("a unique heading resolves to the block directly below it", () => {
    expect(
      resolveInsertIndex(OUTLINE, { kind: "afterHeading", text: "Title" }),
    ).toBe(1);
  });

  const caught = (run: () => unknown): unknown => {
    try {
      run();
    } catch (error) {
      return error;
    }
    throw new Error("expected a throw");
  };

  test("heading text is trimmed, collapsed, case-folded, and unformatted", () => {
    const state = markdownToEditorState("## Plan **B**\n\nBody.");
    expect(
      resolveInsertIndex(state, {
        kind: "afterHeading",
        text: "  plan\n  b ",
      }),
    ).toBe(1);
  });

  test("a line break inside a heading reads as whitespace", () => {
    const state = {
      root: {
        ...OUTLINE.root,
        children: [
          {
            type: "heading",
            tag: "h2",
            version: 1,
            children: [
              { type: "text", version: 1, text: "Line one" },
              { type: "linebreak", version: 1 },
              { type: "text", version: 1, text: "Line two" },
            ],
          } as never,
        ],
      },
    } as SerializedEditorState;

    expect(
      resolveInsertIndex(state, {
        kind: "afterHeading",
        text: "line one line two",
      }),
    ).toBe(1);
  });

  test("duplicate headings name every candidate, and nth picks one", () => {
    const placement = { kind: "afterHeading" as const, text: " NOTES " };

    const thrown = caught(() => resolveInsertIndex(OUTLINE, placement));
    expect(thrown).toBeInstanceOf(AmbiguousHeadingError);
    expect((thrown as AmbiguousHeadingError).candidates).toEqual([
      { nth: 1, blockIndex: 2, tag: "h2", text: "Notes" },
      { nth: 2, blockIndex: 4, tag: "h2", text: "notes" },
    ]);
    expect((thrown as AmbiguousHeadingError).message).toBe(
      [
        '2 top-level headings match " NOTES "; pass nth to choose one:',
        '#1 h2 "Notes" at block 2',
        '#2 h2 "notes" at block 4',
      ].join("\n"),
    );

    expect(resolveInsertIndex(OUTLINE, { ...placement, nth: 1 })).toBe(3);
    expect(resolveInsertIndex(OUTLINE, { ...placement, nth: 2 })).toBe(5);
  });

  test("an nth past the last candidate says so, candidates and all", () => {
    const past = caught(() =>
      resolveInsertIndex(OUTLINE, {
        kind: "afterHeading",
        text: "Notes",
        nth: 3,
      }),
    );
    expect(past).toBeInstanceOf(AmbiguousHeadingError);
    expect((past as AmbiguousHeadingError).candidates).toHaveLength(2);
    expect((past as AmbiguousHeadingError).message).toBe(
      [
        'nth 3 is past the 2 top-level headings matching "Notes":',
        '#1 h2 "Notes" at block 2',
        '#2 h2 "notes" at block 4',
      ].join("\n"),
    );

    // One match and an nth of 2: not ambiguous to the caller, just too far.
    expect(
      (
        caught(() =>
          resolveInsertIndex(OUTLINE, {
            kind: "afterHeading",
            text: "Title",
            nth: 2,
          }),
        ) as AmbiguousHeadingError
      ).message,
    ).toBe(
      [
        'nth 2 is past the 1 top-level heading matching "Title":',
        '#1 h1 "Title" at block 0',
      ].join("\n"),
    );
  });

  test("a heading nobody has is not found, and the others are named", () => {
    const thrown = caught(() =>
      resolveInsertIndex(OUTLINE, { kind: "afterHeading", text: "Missing" }),
    );
    expect(thrown).toBeInstanceOf(HeadingNotFoundError);
    expect((thrown as HeadingNotFoundError).headings).toEqual([
      "Title",
      "Notes",
      "notes",
    ]);
    expect((thrown as HeadingNotFoundError).message).toBe(
      'No top-level heading matches "Missing"; the document has "Title", "Notes", "notes"',
    );

    // A paragraph with the same text is not a heading.
    expect(() =>
      resolveInsertIndex(OUTLINE, { kind: "afterHeading", text: "Intro." }),
    ).toThrow(HeadingNotFoundError);
    expect(() =>
      resolveInsertIndex(markdownToEditorState("Just text."), {
        kind: "afterHeading",
        text: "Missing",
      }),
    ).toThrow('No top-level heading matches "Missing"; the document has none');
  });

  test("a long outline is named up to twenty headings deep", () => {
    const many = markdownToEditorState(
      Array.from({ length: 25 }, (_, index) => `# H${index + 1}`).join("\n\n"),
    );

    const thrown = caught(() =>
      resolveInsertIndex(many, { kind: "afterHeading", text: "Missing" }),
    );
    expect((thrown as HeadingNotFoundError).headings).toHaveLength(25);
    expect((thrown as HeadingNotFoundError).message).toContain(
      '"H20", and 5 more',
    );
    expect((thrown as HeadingNotFoundError).message).not.toContain('"H21"');
  });

  test("a block index is in range up to the block count, which appends", () => {
    expect(
      resolveInsertIndex(OUTLINE, { kind: "atBlockIndex", index: 0 }),
    ).toBe(0);
    expect(
      resolveInsertIndex(OUTLINE, { kind: "atBlockIndex", index: 6 }),
    ).toBe(6);
    for (const index of [7, -1, 1.5]) {
      expect(() =>
        resolveInsertIndex(OUTLINE, { kind: "atBlockIndex", index }),
      ).toThrow(BlockIndexOutOfRangeError);
    }
    expect(() =>
      resolveInsertIndex(OUTLINE, { kind: "atBlockIndex", index: 7 }),
    ).toThrow(
      "Block index 7 is out of range; the document has 6 top-level blocks, so 0 to 6 are insertable and 6 appends",
    );
  });
});

describe("withFrontmatter", () => {
  test("quotes values so YAML-significant characters survive", () => {
    const out = withFrontmatter(
      {
        id: "doc_1",
        title: 'Plan: "Q4" #1\nline two',
        path: 'Work/Plan: "Q4" #1\nline two',
        updatedAt: new Date("2026-09-23T10:00:00.000Z"),
        tags: ["a: b", "c"],
      },
      "# Body\n",
    );
    expect(out).toBe(
      [
        "---",
        'id: "doc_1"',
        'title: "Plan: \\"Q4\\" #1\\nline two"',
        'path: "Work/Plan: \\"Q4\\" #1\\nline two"',
        'updatedAt: "2026-09-23T10:00:00.000Z"',
        'tags: ["a: b", "c"]',
        "---",
        "",
        "# Body",
        "",
      ].join("\n"),
    );
  });
});

test("code numbers are opt-in and survive markdown round trips without a stored theme", () => {
  const markdown = "```js showLineNumbers\nconst a = 1;\nconsole.log(a);\n```";
  const state = markdownToEditorState(markdown);
  expect(state.root.children[0]).toMatchObject({ showLineNumbers: true });
  expect(editorStateToMarkdown(state)).toBe(markdown);
  expect(
    markdownToEditorState("```text\none line\n```").root.children[0],
  ).toMatchObject({ showLineNumbers: false });
  expect(state.root.children[0]).not.toHaveProperty("theme");
});

test("line numbers work without a language and can be turned back off", () => {
  const numbered = markdownToEditorState("```showLineNumbers\nhello\n```");
  expect(editorStateToMarkdown(numbered)).toBe(
    "```showLineNumbers\nhello\n```",
  );
  const node = numbered.root.children[0];
  if (node && "showLineNumbers" in node) node.showLineNumbers = false;
  expect(editorStateToMarkdown(numbered)).toBe("```\nhello\n```");
});
