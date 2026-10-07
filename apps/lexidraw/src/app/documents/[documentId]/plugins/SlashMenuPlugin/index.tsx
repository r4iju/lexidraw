import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $findMatchingParent } from "@lexical/utils";
import { $getSelection, $isElementNode, $isRangeSelection } from "lexical";
import { useState } from "react";
import useModal from "~/hooks/useModal";
import { turnIntoEntries, useInsertEntries } from "../block-catalog";
import { $blockTypeOf } from "../ToolbarPlugin/block-actions";
import { type BlockType, useSetBlockType } from "../ToolbarPlugin/block-format";
import { SlashMenu } from "./SlashMenu";

export { OPEN_SLASH_MENU_COMMAND } from "./SlashMenu";

/** The type of the block holding the caret, read in the editor. */
function $caretBlockType(): BlockType {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return "paragraph";
  const block = $findMatchingParent(
    selection.anchor.getNode(),
    (node) => $isElementNode(node) && !node.isInline(),
  );
  return $blockTypeOf(block) ?? "paragraph";
}

/**
 * Typing `/` opens a menu of every block: the block types the line can turn
 * into, then everything the Insert menu inserts.
 */
export default function SlashMenuPlugin() {
  const [editor] = useLexicalComposerContext();
  const [modal, showModal] = useModal();
  const inserts = useInsertEntries(editor, showModal);
  // The type of the block the menu was opened in, for turning it into another.
  const [openedIn, setOpenedIn] = useState<BlockType>("paragraph");
  const setBlockType = useSetBlockType(editor, openedIn);
  const turnInto = turnIntoEntries(setBlockType);
  const ids = new Set(turnInto.map((entry) => entry.id));
  const entries = [
    ...turnInto,
    // A toggle is offered once, as a turn-into that keeps the line's text.
    ...inserts.filter((entry) => !ids.has(entry.id)),
  ];
  return (
    <>
      <SlashMenu
        entries={entries}
        onOpen={() => setOpenedIn($caretBlockType())}
      />
      {modal}
    </>
  );
}
