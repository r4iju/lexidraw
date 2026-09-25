/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $createTableNodeWithDimensions,
  TableCellNode,
  TableNode,
  TableRowNode,
} from "@lexical/table";
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  $setSelection,
  type LexicalEditor,
} from "lexical";

import { $barMode } from "./bar-mode";

function documentWithTable() {
  const editor = createHeadlessEditor({
    nodes: [TableNode, TableRowNode, TableCellNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $getRoot().append(
        $createParagraphNode().append($createTextNode("Hello world")),
        $createTableNodeWithDimensions(2, 2, false),
      );
    },
    { discrete: true },
  );
  return editor;
}

const modeAfter = (editor: LexicalEditor, select: () => void) => {
  editor.update(select, { discrete: true });
  return editor.getEditorState().read($barMode);
};

describe("the phone's editing bar", () => {
  test("offers writing tools while the caret sits in text", () => {
    const editor = documentWithTable();
    expect(
      modeAfter(editor, () => {
        $getRoot().getFirstDescendant()?.selectStart();
      }),
    ).toBe("default");
  });

  test("switches to formatting once text is selected", () => {
    const editor = documentWithTable();
    expect(
      modeAfter(editor, () => {
        const text = $getRoot().getFirstDescendant();
        if ($isTextNode(text)) text.select(0, 5);
      }),
    ).toBe("selection");
  });

  test("offers row and column actions with the caret in a table cell", () => {
    const editor = documentWithTable();
    expect(
      modeAfter(editor, () => {
        $getRoot().getLastChild()?.selectStart();
      }),
    ).toBe("table");
  });

  test("offers block actions for a selected block", () => {
    const editor = documentWithTable();
    expect(
      modeAfter(editor, () => {
        const selection = $createNodeSelection();
        selection.add($getRoot().getLastChildOrThrow().getKey());
        $setSelection(selection);
      }),
    ).toBe("block");
  });

  // A menu the bar opens takes focus, and the selection, from the editor.
  test("leaves the bar as it was with nothing selected", () => {
    const editor = documentWithTable();
    expect(modeAfter(editor, () => $setSelection(null))).toBeNull();
  });
});
