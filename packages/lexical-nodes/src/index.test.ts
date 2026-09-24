/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  type Transformer,
} from "@lexical/markdown";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import {
  CalloutNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
  CORE_NODES,
  CORE_TRANSFORMERS,
  createTransformers,
  HR,
  LayoutContainerNode,
} from "./index.js";

describe("@packages/lexical-nodes", () => {
  test("registers each node type once", () => {
    const types = CORE_NODES.map((node) => node.getType());
    expect(new Set(types).size).toBe(types.length);
    expect(types).toContain("collapsible-container");
    expect(types).toContain("layout-item");
  });

  test("extra transformers slot in before the table transformer", () => {
    const extra: Transformer = { ...HR, regExp: /^never$/ };
    const list = createTransformers([extra]);
    const extraIndex = list.indexOf(extra);
    const tableIndex = list.findIndex(
      (t) =>
        "dependencies" in t &&
        t.dependencies.some((d) => d.getType() === "table"),
    );
    expect(extraIndex).toBeGreaterThan(-1);
    expect(extraIndex).toBeLessThan(tableIndex);
    // The block containers come first, so a line opening one is never read
    // as the paragraph, quote or table it would otherwise start.
    expect(
      CORE_TRANSFORMERS.slice(0, 4).map((t) =>
        "dependencies" in t ? t.dependencies[0] : undefined,
      ),
    ).toEqual([
      CalloutNode,
      CalloutNode,
      CollapsibleContainerNode,
      LayoutContainerNode,
    ]);
  });

  test("markdown round-trips through a headless editor without a DOM", () => {
    expect(typeof globalThis.document).toBe("undefined");
    const editor = createHeadlessEditor({
      nodes: CORE_NODES,
      onError: (error) => {
        throw error;
      },
    });
    const input =
      "# Title\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |";
    editor.update(
      () => {
        $convertFromMarkdownString(input, CORE_TRANSFORMERS);
      },
      { discrete: true },
    );
    const output = editor
      .getEditorState()
      .read(() => $convertToMarkdownString(CORE_TRANSFORMERS, $getRoot()));
    // Table cells keep the surrounding spaces the importer split them with,
    // so compare rows cell by cell rather than byte for byte.
    const rows = (s: string) =>
      s.split("\n").map((line) =>
        line.startsWith("|")
          ? line
              .split("|")
              .map((cell) => cell.trim())
              .join("|")
          : line,
      );
    expect(rows(output)).toEqual(rows(input));
  });

  test("exports a collapsible as details and summary", () => {
    const editor = createHeadlessEditor({
      nodes: CORE_NODES,
      onError: (error) => {
        throw error;
      },
    });
    let markdown = "";
    editor.update(
      () => {
        const container =
          CollapsibleContainerNode.$createCollapsibleContainerNode(true);
        const title = CollapsibleTitleNode.$createCollapsibleTitleNode();
        title.append($createTextNode("Details"));
        const content = CollapsibleContentNode.$createCollapsibleContentNode();
        content.append(
          $createParagraphNode().append($createTextNode("Hidden body")),
        );
        container.append(title, content);
        $getRoot().clear().append(container);
        markdown = $convertToMarkdownString(CORE_TRANSFORMERS, $getRoot());
      },
      { discrete: true },
    );
    expect(markdown).toBe(
      "<details open>\n<summary>Details</summary>\n\nHidden body\n\n</details>",
    );
  });
});
