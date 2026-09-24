import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $parseSerializedNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type SerializedLexicalNode,
} from "lexical";

/** The block `key` names, or else the one holding the selection. */
function $block(key?: NodeKey | null): LexicalNode | null {
  if (key) return $getNodeByKey(key);
  const node = $getSelection()?.getNodes()[0];
  return node?.getTopLevelElement() ?? null;
}

function $serialize(node: LexicalNode): SerializedLexicalNode {
  const json = node.exportJSON();
  if ($isElementNode(node))
    (json as SerializedElementNode).children = node
      .getChildren()
      .map($serialize);
  return json;
}

export function duplicateBlock(editor: LexicalEditor, key?: NodeKey | null) {
  editor.update(() => {
    const block = $block(key);
    if (block) block.insertAfter($parseSerializedNode($serialize(block)));
  });
}

export function moveBlock(
  editor: LexicalEditor,
  direction: "up" | "down",
  key?: NodeKey | null,
) {
  editor.update(() => {
    const block = $block(key);
    if (!block) return;
    if (direction === "up") block.getPreviousSibling()?.insertBefore(block);
    else block.getNextSibling()?.insertAfter(block);
  });
}

export function deleteBlock(editor: LexicalEditor, key?: NodeKey | null) {
  editor.update(() => {
    const block = $block(key);
    if (!block) return;
    const neighbour = block.getNextSibling() ?? block.getPreviousSibling();
    block.remove();
    if (neighbour) neighbour.selectStart();
    else $getRoot().append($createParagraphNode()).selectStart();
  });
}

export function insertBlockBelow(editor: LexicalEditor, key: NodeKey) {
  editor.update(() => {
    const block = $getNodeByKey(key);
    if (!block) return;
    const paragraph = $createParagraphNode();
    block.insertAfter(paragraph);
    paragraph.select();
  });
  editor.focus();
}

/** Puts the caret in the block, so that selection-based commands apply to it. */
export function selectBlock(editor: LexicalEditor, key: NodeKey) {
  editor.update(() => {
    const block = $getNodeByKey(key);
    if ($isElementNode(block)) block.selectStart();
  });
}
