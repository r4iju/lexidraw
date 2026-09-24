/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { SerializedEditorState, SerializedLexicalNode } from "lexical";
import {
  AmbiguousHeadingError,
  appendBlocks,
  BlockIndexOutOfRangeError,
  collectNodeTypes,
  editorStateToMarkdown,
  HeadingNotFoundError,
  insertBlocks,
  interpretMarkdown,
  InvalidDocumentContentError,
  markdownLosses,
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

type Node = SerializedLexicalNode & {
  children?: Node[];
  [key: string]: unknown;
};

const blocksOf = (markdown: string) =>
  markdownToEditorState(markdown).root.children as Node[];

/** Markdown in, markdown out through the stored form. */
const roundTrip = (markdown: string) =>
  editorStateToMarkdown(markdownToEditorState(markdown));

const textOf = (node: Node): string =>
  typeof node.text === "string"
    ? node.text
    : (node.children ?? []).map(textOf).join("");

describe("callouts", () => {
  test("a GitHub alert imports as a callout of its kind and exports unchanged", () => {
    const markdown = "> [!WARNING]\n> Hot oil spits. Stand back.";
    const [callout] = blocksOf(markdown);
    expect(callout?.type).toBe("callout");
    expect(callout?.kind).toBe("warning");
    expect(callout?.title).toBe("");
    expect(textOf(callout as Node)).toBe("Hot oil spits. Stand back.");
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test("text after the marker is the title", () => {
    const markdown =
      "> [!IMPORTANT] Decision\n> Ship 0.9 on **October 6** if the dry-run passes.";
    const [callout] = blocksOf(markdown);
    expect(callout).toMatchObject({
      type: "callout",
      kind: "important",
      title: "Decision",
    });
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test("markers are case-insensitive and export in the GitHub form", () => {
    const [callout] = blocksOf("> [!tip]\n> Pour off the fat.");
    expect(callout).toMatchObject({ type: "callout", kind: "tip" });
    expect(roundTrip("> [!tip]\n> Pour off the fat.")).toBe(
      "> [!TIP]\n> Pour off the fat.",
    );
  });

  test("a Docusaurus admonition imports as the matching callout", () => {
    const markdown = ":::note[Heads up]\nThe oven runs hot.\n:::";
    const [callout] = blocksOf(markdown);
    expect(callout).toMatchObject({
      type: "callout",
      kind: "note",
      title: "Heads up",
    });
    expect(roundTrip(markdown)).toBe(
      "> [!NOTE] Heads up\n> The oven runs hot.",
    );
    expect(blocksOf(":::danger\nSharp.\n:::")[0]).toMatchObject({
      kind: "caution",
    });
  });

  test("Obsidian aliases import as the nearest kind and keep their word as the title", () => {
    const kinds = [
      ["summary", "note", "Summary"],
      ["info", "note", "Info"],
      ["hint", "tip", "Hint"],
      ["success", "tip", "Success"],
      ["question", "important", "Question"],
      ["attention", "warning", "Attention"],
      ["danger", "caution", "Danger"],
      ["bug", "caution", "Bug"],
    ] as const;
    for (const [alias, kind, title] of kinds) {
      expect(blocksOf(`> [!${alias}]\n> Body`)[0]).toMatchObject({
        type: "callout",
        kind,
        title,
      });
    }
    // A title the author gave wins, and a fold marker is accepted.
    expect(blocksOf("> [!faq]- Why?\n> Because.")[0]).toMatchObject({
      kind: "important",
      title: "Why?",
    });
  });

  test("a callout holds any blocks and survives a round trip", () => {
    const markdown = [
      "> [!NOTE] Before you start",
      "> Gather:",
      ">",
      "> - flour",
      "> - water",
      ">",
      "> ```ts",
      "> const x = 1;",
      "> ```",
      ">",
      "> > [!TIP]",
      "> > Nested.",
    ].join("\n");
    const [callout] = blocksOf(markdown);
    expect(callout?.children?.map((child) => child.type)).toEqual([
      "paragraph",
      "list",
      "code",
      "callout",
    ]);
    expect(roundTrip(markdown)).toBe(markdown);
  });

  test("a plain quote is still a quote", () => {
    expect(blocksOf("> Just a quote")[0]?.type).toBe("quote");
    expect(blocksOf("> [!UNKNOWN-THING] odd")[0]?.type).toBe("callout");
  });
});

describe("collapsibles", () => {
  const DETAILS = [
    "<details open>",
    "<summary>Why **brine**?</summary>",
    "",
    "Salt seasons the meat all the way through.",
    "",
    "- 5% salt",
    "- overnight",
    "",
    "</details>",
  ].join("\n");

  test("a details section imports as a collapsible and exports back", () => {
    const [container] = blocksOf(DETAILS);
    expect(container).toMatchObject({
      type: "collapsible-container",
      open: true,
    });
    const [title, content] = container?.children ?? [];
    expect(title?.type).toBe("collapsible-title");
    expect(textOf(title as Node)).toBe("Why brine?");
    expect(content?.children?.map((child) => child.type)).toEqual([
      "paragraph",
      "list",
    ]);
    expect(roundTrip(DETAILS)).toBe(DETAILS);
  });

  test("a closed section stays closed, and the summary may share the line", () => {
    const [container] = blocksOf(
      "<details><summary>More</summary>\n\nHidden.\n\n</details>",
    );
    expect(container).toMatchObject({
      type: "collapsible-container",
      open: false,
    });
    expect(
      roundTrip("<details><summary>More</summary>\n\nHidden.\n\n</details>"),
    ).toBe("<details>\n<summary>More</summary>\n\nHidden.\n\n</details>");
  });

  test("details nest", () => {
    const markdown = [
      "<details>",
      "<summary>Outer</summary>",
      "",
      "<details>",
      "<summary>Inner</summary>",
      "",
      "Deep.",
      "",
      "</details>",
      "",
      "</details>",
      "",
      "After.",
    ].join("\n");
    const blocks = blocksOf(markdown);
    expect(blocks.map((block) => block.type)).toEqual([
      "collapsible-container",
      "paragraph",
    ]);
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe("columns", () => {
  const COLUMNS = [
    "<columns>",
    "<column>",
    "",
    "### Left",
    "",
    "Left text.",
    "",
    "</column>",
    "<column>",
    "",
    "Right text.",
    "",
    "</column>",
    "</columns>",
  ].join("\n");

  test("a columns layout imports as columns and exports back", () => {
    const [layout] = blocksOf(COLUMNS);
    expect(layout).toMatchObject({
      type: "layout-container",
      templateColumns: "1fr 1fr",
    });
    expect(layout?.children?.map((child) => child.type)).toEqual([
      "layout-item",
      "layout-item",
    ]);
    expect(layout?.children?.[0]?.children?.map((child) => child.type)).toEqual(
      ["heading", "paragraph"],
    );
    expect(roundTrip(COLUMNS)).toBe(COLUMNS);
  });

  test("every column counts, and an empty one is kept", () => {
    const [layout] = blocksOf(
      "<columns>\n<column>\nA\n</column>\n<column>\n</column>\n<column>\nC\n</column>\n</columns>",
    );
    expect(layout).toMatchObject({ templateColumns: "1fr 1fr 1fr" });
    expect(layout?.children).toHaveLength(3);
  });
});

describe("predictable parsing", () => {
  test("dollar amounts in prose stay text", () => {
    for (const prose of [
      "It costs $5 and $10",
      "Between $5 and $10.50, or $20",
      "Price: $5,$10",
    ]) {
      const [paragraph] = blocksOf(prose);
      expect(paragraph?.children?.map((child) => child.type)).toEqual(["text"]);
      expect(roundTrip(prose)).toBe(prose);
    }
  });

  test("text that reads like math is written escaped, so it stays text", () => {
    for (const prose of ["Price \\$x$ here.", "A **bold \\$y$** word"]) {
      const [paragraph] = blocksOf(prose);
      expect(paragraph?.children?.every((child) => child.type === "text")).toBe(
        true,
      );
      expect(roundTrip(prose)).toBe(prose);
      expect(roundTrip(roundTrip(prose))).toBe(prose);
    }
  });

  test("inline math still needs tight delimiters", () => {
    const [paragraph] = blocksOf("Energy $E=mc^2$ and money $5.");
    expect(paragraph?.children?.map((child) => child.type)).toEqual([
      "text",
      "equation",
      "text",
    ]);
    expect(paragraph?.children?.[1]).toMatchObject({
      equation: "E=mc^2",
      inline: true,
    });
  });

  test("$$ is a block equation", () => {
    const [single] = blocksOf("$$x = \\frac{1}{2}$$");
    expect(single?.children).toEqual([
      expect.objectContaining({
        type: "equation",
        equation: "x = \\frac{1}{2}",
        inline: false,
      }),
    ]);
    expect(roundTrip("$$x = \\frac{1}{2}$$")).toBe("$$x = \\frac{1}{2}$$");

    const fenced = "$$\n\\begin{aligned}\na &= b\n\\end{aligned}\n$$";
    const [block] = blocksOf(`Before.\n\n${fenced}\n\nAfter.`).slice(1);
    expect(block?.children?.[0]).toMatchObject({
      type: "equation",
      equation: "\\begin{aligned}\na &= b\n\\end{aligned}",
      inline: false,
    });
    expect(roundTrip(fenced)).toBe(fenced);
  });

  test("an image title does not corrupt the source", () => {
    const [paragraph] = blocksOf(
      '![A torii](https://example.com/torii.jpg "Before 07:00")',
    );
    expect(paragraph?.children?.[0]).toMatchObject({
      type: "image",
      src: "https://example.com/torii.jpg",
      altText: "A torii",
    });
  });

  test("a tweet line keeps the text before it", () => {
    const blocks = blocksOf('Look at this <tweet id="123" />');
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "tweet"]);
    expect(textOf(blocks[0] as Node)).toBe("Look at this");
    expect(blocks[1]).toMatchObject({ id: "123" });
  });

  test("an article line is not turned into the word Article", () => {
    const line = '<article class="post">';
    const [paragraph] = blocksOf(line);
    expect(textOf(paragraph as Node)).toBe(line);
  });
});

describe("interpretMarkdown", () => {
  test("notes how the markdown was read", () => {
    const wide = `| ${"abcdefg".split("").join(" | ")} |\n|${" --- |".repeat(7)}\n| ${"1234567".split("").join(" | ")} |`;
    const { state, notes } = interpretMarkdown(
      [
        "> [!danger]\n> Hot.",
        ":::tip[Faster]\nUse the air fryer.\n:::",
        '![Torii](https://example.com/t.jpg "Before 07:00")',
        wide,
        "Plain text.",
      ].join("\n\n"),
    );
    expect(state.root.children.map((child) => child.type)).toEqual([
      "callout",
      "callout",
      "paragraph",
      "table",
      "paragraph",
    ]);
    expect(notes).toEqual([
      expect.stringContaining("[!danger] became a caution callout"),
      expect.stringContaining(":::tip became a tip callout"),
      expect.stringContaining('title "Before 07:00"'),
      expect.stringContaining("7 columns"),
    ]);
  });

  test("wide tables share one note", () => {
    const table = (columns: number) =>
      `|${" h |".repeat(columns)}\n|${" --- |".repeat(columns)}\n|${" 1 |".repeat(columns)}`;
    const { notes } = interpretMarkdown(
      [table(6), table(5), table(5), table(2)].join("\n\n"),
    );
    expect(notes).toEqual([
      "3 tables of 5 to 6 columns scroll sideways on phones; fewer columns, or a list, read better there",
    ]);
  });

  test("plain markdown needs no notes", () => {
    expect(interpretMarkdown("# Title\n\n> [!NOTE]\n> Fine.").notes).toEqual(
      [],
    );
  });
});

describe("markdownLosses", () => {
  test("names what the markdown form of a document drops", () => {
    const state = markdownToEditorState(
      "<columns>\n<column>\nA\n</column>\n<column>\nB\n</column>\n</columns>\n\n| a | b |\n| --- | --- |\n| 1 | 2 |",
    );
    const [layout, table] = state.root.children as Node[];
    Object.assign(layout as Node, { templateColumns: "1fr 3fr" });
    Object.assign(table as Node, { colWidths: [120, 300] });
    expect(markdownLosses(state)).toEqual([
      expect.stringContaining("column layout"),
      expect.stringContaining("table"),
    ]);
    expect(markdownLosses(markdownToEditorState("# Plain"))).toEqual([]);
  });

  test("an image markdown wrote has no hand-set size to lose", () => {
    const state = markdownToEditorState("![Alt](https://example.com/a.png)");
    expect(markdownLosses(state)).toEqual([]);
    const [paragraph] = state.root.children as Node[];
    const [image] = (paragraph as Node & { children: Node[] }).children;
    Object.assign(image as Node, { width: 320, height: 200 });
    expect(markdownLosses(state)).toEqual([expect.stringContaining("image")]);
  });
});
