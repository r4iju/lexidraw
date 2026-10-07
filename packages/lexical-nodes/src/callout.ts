import { $isHeadingNode, $isQuoteNode } from "@lexical/rich-text";
import { $findMatchingParent } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  type ElementNode,
  type LexicalNode,
} from "lexical";
import { type CalloutKind, CalloutNode } from "./nodes/CalloutNode.js";
import { $topBlockOf } from "./toggle.js";

/** The innermost callout holding `node`, if any. */
export function $calloutOf(node: LexicalNode): CalloutNode | null {
  return $findMatchingParent(node, CalloutNode.$isCalloutNode);
}

/**
 * A block of text that another can be joined onto, as Backspace joins two
 * paragraphs: a paragraph, heading or quote.
 */
export function $isTextBlock(
  node: LexicalNode | null | undefined,
): node is ElementNode {
  return $isParagraphNode(node) || $isHeadingNode(node) || $isQuoteNode(node);
}

/**
 * Moves what `from` says onto the end of `onto`, removes `from`, and puts
 * the caret where they meet.
 */
export function $joinBlocks(onto: ElementNode, from: ElementNode) {
  onto.selectEnd();
  onto.append(...from.getChildren());
  from.remove();
}

/**
 * Replaces a callout with the blocks it held, and returns the first of them.
 */
export function $unwrapCallout(callout: CalloutNode): LexicalNode | null {
  const children = callout.getChildren();
  for (const child of children) callout.insertBefore(child);
  callout.remove();
  return children[0] ?? null;
}

/**
 * Replaces `block` with a callout whose first line holds `children`, as a
 * typed shortcut makes one, and puts the caret at the start of that line.
 */
export function $replaceWithCallout(
  block: ElementNode,
  children: LexicalNode[],
  kind: CalloutKind,
  title: string,
): CalloutNode {
  const line = $createParagraphNode().append(...children);
  const callout = CalloutNode.$createCalloutNode(kind, title).append(line);
  block.replace(callout);
  line.selectStart();
  return callout;
}

/**
 * Removing a selection that starts on one side of a callout's edge and ends
 * on the other joins the two lines left over, as it would two paragraphs;
 * Lexical leaves them apart at a callout's edge. A callout left empty goes.
 */
export function $removeAcrossCallouts(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || selection.isCollapsed()) return false;
  // Asked first, as asking the selection its direction caches it.
  if (
    $calloutOf(selection.anchor.getNode())?.getKey() ===
    $calloutOf(selection.focus.getNode())?.getKey()
  )
    return false;
  const [start, end] = selection.isBackward()
    ? [selection.focus, selection.anchor]
    : [selection.anchor, selection.focus];
  const startBlock = $topBlockOf(start.getNode());
  const endBlock = $topBlockOf(end.getNode());
  selection.removeText();
  if (
    $isTextBlock(startBlock) &&
    $isTextBlock(endBlock) &&
    startBlock.isAttached() &&
    endBlock.isAttached() &&
    !startBlock.is(endBlock)
  ) {
    const parent = endBlock.getParent();
    startBlock.append(...endBlock.getChildren());
    endBlock.remove();
    if (CalloutNode.$isCalloutNode(parent) && parent.isEmpty()) parent.remove();
  }
  return true;
}
