/// <reference types="bun" />
import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import { $isHorizontalRuleNode } from "@lexical/extension";
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  type ListItemNode,
} from "@lexical/list";
import { registerMarkdownShortcuts } from "@lexical/markdown";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical";
import { CORE_NODES, CORE_TRANSFORMERS } from "./index.js";

function editor() {
  const e = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => {
      throw error;
    },
  });
  registerMarkdownShortcuts(e, CORE_TRANSFORMERS);
  return e;
}

/** An editor holding one empty paragraph, with the caret in it. */
function emptyEditor() {
  const e = editor();
  e.update(
    () => {
      const paragraph = $createParagraphNode();
      $getRoot().clear().append(paragraph);
      paragraph.select();
    },
    { discrete: true },
  );
  return e;
}

/** Types `text` a character at a time, as the keyboard does. */
async function type(e: LexicalEditor, text: string) {
  for (const character of text) {
    e.update(
      () => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error("Expected a caret");
        selection.insertText(character);
      },
      { discrete: true },
    );
    // The shortcut runs in an update the update listener queues.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/** Each top-level block: a list as its type and items, else its type and text. */
function blocks(e: LexicalEditor) {
  return e.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((block) =>
        $isListNode(block)
          ? {
              list: block.getListType(),
              items: block
                .getChildren()
                .filter($isListItemNode)
                .map((item: ListItemNode) =>
                  block.getListType() === "check"
                    ? [item.getTextContent(), item.getChecked() ?? false]
                    : item.getTextContent(),
                ),
            }
          : $isHorizontalRuleNode(block)
            ? "divider"
            : `${block.getType()}:${block.getTextContent()}`,
      ),
  );
}

test("`- [ ] ` typed on an empty line starts a check list", async () => {
  const e = emptyEditor();
  await type(e, "- [ ] todo");
  expect(blocks(e)).toEqual([{ list: "check", items: [["todo", false]] }]);
});

test("`- [x] ` typed on an empty line starts a checked item", async () => {
  const e = emptyEditor();
  await type(e, "- [x] done");
  expect(blocks(e)).toEqual([{ list: "check", items: [["done", true]] }]);
});

test("`[ ] ` typed at the start of a bullet between others makes just that item a check item", async () => {
  const e = editor();
  e.update(
    () => {
      const list = $createListNode("bullet");
      const empty = $createListItemNode();
      list.append(
        $createListItemNode().append($createTextNode("a")),
        empty,
        $createListItemNode().append($createTextNode("c")),
      );
      $getRoot().clear().append(list);
      empty.select();
    },
    { discrete: true },
  );
  await type(e, "[ ] b");
  expect(blocks(e)).toEqual([
    { list: "bullet", items: ["a"] },
    { list: "check", items: [["b", false]] },
    { list: "bullet", items: ["c"] },
  ]);
});

test("`- [ ] ` typed under a check list adds an item to it", async () => {
  const e = editor();
  e.update(
    () => {
      const list = $createListNode("check");
      const paragraph = $createParagraphNode();
      list.append($createListItemNode(true).append($createTextNode("a")));
      $getRoot().clear().append(list, paragraph);
      paragraph.select();
    },
    { discrete: true },
  );
  await type(e, "- [ ] b");
  expect(blocks(e)).toEqual([
    {
      list: "check",
      items: [
        ["a", true],
        ["b", false],
      ],
    },
  ]);
});

test("`---` typed on an empty line is a divider at once, with the caret on the line after it", async () => {
  const e = emptyEditor();
  await type(e, "---next");
  expect(blocks(e)).toEqual(["divider", "paragraph:next"]);
});
