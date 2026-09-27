import {
  $createHeadingNode,
  $createQuoteNode,
  type HeadingTagType,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $createParagraphNode, type BaseSelection } from "lexical";

/** What the block menu makes a block: a paragraph, a heading or a quote. */
export type BlockType = "paragraph" | HeadingTagType | "quote";

/**
 * Makes every block the selection touches a block of `type`, keeping what
 * it holds. The toolbar and the iOS editor both set block types through it.
 */
export function $setBlockType(
  selection: BaseSelection | null,
  type: BlockType,
): void {
  $setBlocksType(selection, () =>
    type === "paragraph"
      ? $createParagraphNode()
      : type === "quote"
        ? $createQuoteNode()
        : $createHeadingNode(type),
  );
}
