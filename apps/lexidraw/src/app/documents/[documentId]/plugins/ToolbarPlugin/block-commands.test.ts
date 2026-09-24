/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type LexicalEditor,
} from "lexical";

import { deleteBlock, duplicateBlock, moveBlock } from "./block-commands";

function document(...texts: string[]) {
  const editor = createHeadlessEditor({
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      for (const text of texts)
        $getRoot().append($createParagraphNode().append($createTextNode(text)));
    },
    { discrete: true },
  );
  return editor;
}

const blocks = (editor: LexicalEditor) =>
  editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((block) => block.getTextContent()),
  );

const keyOf = (editor: LexicalEditor, index: number) =>
  editor
    .getEditorState()
    .read(() => $getRoot().getChildAtIndex(index)?.getKey() ?? "");

const settle = (editor: LexicalEditor) =>
  new Promise<void>((resolve) =>
    editor.update(() => {}, { onUpdate: resolve }),
  );

describe("block actions", () => {
  test("move a block up and down among its siblings", async () => {
    const editor = document("one", "two", "three");
    moveBlock(editor, "up", keyOf(editor, 1));
    await settle(editor);
    expect(blocks(editor)).toEqual(["two", "one", "three"]);
    moveBlock(editor, "down", keyOf(editor, 1));
    await settle(editor);
    expect(blocks(editor)).toEqual(["two", "three", "one"]);
    moveBlock(editor, "down", keyOf(editor, 2));
    await settle(editor);
    expect(blocks(editor)).toEqual(["two", "three", "one"]);
  });

  // Lists of one type next to each other join, as they do when typed.
  test("duplicate a block with everything inside it", async () => {
    const editor = document("before");
    editor.update(
      () => {
        $getRoot().append(
          $createListNode("bullet").append(
            $createListItemNode().append($createTextNode("a")),
            $createListItemNode().append($createTextNode("b")),
          ),
        );
      },
      { discrete: true },
    );
    duplicateBlock(editor, keyOf(editor, 1));
    await settle(editor);
    expect(blocks(editor)).toEqual(["before", "a\n\nb\n\na\n\nb"]);
  });

  test("deleting the last block leaves an empty paragraph to type in", async () => {
    const editor = document("only");
    deleteBlock(editor, keyOf(editor, 0));
    await settle(editor);
    expect(blocks(editor)).toEqual([""]);
    expect(
      editor.getEditorState().read(() => $getRoot().getFirstChild()?.getType()),
    ).toBe("paragraph");
  });
});
