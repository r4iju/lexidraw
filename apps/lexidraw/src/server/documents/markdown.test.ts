/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { CORE_NODES, CORE_TRANSFORMERS } from "@packages/lexical-nodes";
import type { SerializedEditorState } from "lexical";
import {
  collectNodeTypes,
  editorStateToMarkdown,
  InvalidDocumentContentError,
  parseEditorState,
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

function stateFromMarkdown(markdown: string): SerializedEditorState {
  const editor = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, CORE_TRANSFORMERS);
    },
    { discrete: true },
  );
  return editor.getEditorState().toJSON();
}

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
    const markdown = editorStateToMarkdown(stateFromMarkdown(SAMPLE))
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
