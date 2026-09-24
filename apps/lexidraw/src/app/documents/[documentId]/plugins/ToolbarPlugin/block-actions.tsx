import { $isCodeNode } from "@lexical/code";
import { $isListItemNode, $isListNode } from "@lexical/list";
import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import type { LexicalEditor, LexicalNode, NodeKey } from "lexical";
import { ArrowDown, ArrowUp, CopyPlus, Repeat2, Trash2 } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "~/components/ui/dropdown-menu";
import { BLOCK_TYPES, type BlockType, BlockTypeItems } from "./block-format";
import {
  deleteBlock,
  duplicateBlock,
  moveBlock,
  selectBlock,
} from "./block-commands";

export function $blockTypeOf(node: LexicalNode | null): BlockType | null {
  if (!node) return null;
  if ($isListNode(node)) return node.getListType();
  if ($isListItemNode(node)) {
    const list = node.getParent();
    return $isListNode(list) ? list.getListType() : null;
  }
  const type = $isHeadingNode(node)
    ? node.getTag()
    : $isQuoteNode(node)
      ? "quote"
      : $isCodeNode(node)
        ? "code"
        : node.getType();
  return BLOCK_TYPES.some((option) => option.type === type)
    ? (type as BlockType)
    : null;
}

/**
 * What can be done to a whole block: shared by the toolbar's Block menu, the
 * drag handle and the context menu. Without `nodeKey` it acts on the block
 * holding the selection.
 */
export function BlockActionItems({
  editor,
  blockType,
  nodeKey,
  canTurnInto = true,
}: {
  editor: LexicalEditor;
  blockType: BlockType | null;
  nodeKey?: NodeKey | null;
  canTurnInto?: boolean;
}) {
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="gap-2" disabled={!canTurnInto}>
          <Repeat2 className="size-4" />
          Turn into
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-52">
          <BlockTypeItems
            editor={editor}
            blockType={blockType}
            before={nodeKey ? () => selectBlock(editor, nodeKey) : undefined}
          />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem
        className="gap-2"
        onSelect={() => duplicateBlock(editor, nodeKey)}
      >
        <CopyPlus className="size-4" />
        Duplicate
      </DropdownMenuItem>
      <DropdownMenuItem
        className="gap-2"
        onSelect={() => moveBlock(editor, "up", nodeKey)}
      >
        <ArrowUp className="size-4" />
        Move up
      </DropdownMenuItem>
      <DropdownMenuItem
        className="gap-2"
        onSelect={() => moveBlock(editor, "down", nodeKey)}
      >
        <ArrowDown className="size-4" />
        Move down
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        className="gap-2 text-destructive focus:text-destructive"
        onSelect={() => deleteBlock(editor, nodeKey)}
      >
        <Trash2 className="size-4" />
        Delete block
      </DropdownMenuItem>
    </>
  );
}
