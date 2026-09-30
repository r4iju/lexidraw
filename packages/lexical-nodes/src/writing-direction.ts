import {
  $caretFromPoint,
  $findMatchingParent,
  $getSelection,
  $isElementNode,
  $isExtendableTextPointCaret,
  $isRangeSelection,
  INTERNAL_$isBlock,
  type ElementNode,
  type PointType,
  type PointCaret,
} from "lexical";

export type WritingDirection = "auto" | "ltr" | "rtl";

function atEdge(
  point: PointType,
  block: ElementNode,
  direction: "previous" | "next",
): boolean {
  const node = point.getNode();
  if ($isElementNode(node) && node.isEmpty()) return false;
  let caret: PointCaret<"previous" | "next"> | null = $caretFromPoint(
    point,
    direction,
  );
  if ($isExtendableTextPointCaret(caret)) return false;
  for (; caret; caret = caret.getParentCaret()) {
    const parent = caret.getParentAtCaret();
    if (!parent || caret.getNodeAtCaret()) return false;
    if (block.is(parent)) return true;
  }
  return false;
}

/** Uses the block menu's selection boundaries without replacing the blocks. */
export function $setWritingDirection(direction: WritingDirection): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return;
  const anchor = $findMatchingParent(
    selection.anchor.getNode(),
    INTERNAL_$isBlock,
  );
  const focus = $findMatchingParent(
    selection.focus.getNode(),
    INTERNAL_$isBlock,
  );
  const skipFocus =
    $isElementNode(focus) &&
    !focus.is(anchor) &&
    atEdge(
      selection.focus,
      focus,
      selection.isBackward() ? "next" : "previous",
    );
  const blocks = new Set<ElementNode>();
  if ($isElementNode(anchor)) blocks.add(anchor);
  if ($isElementNode(focus) && !skipFocus) blocks.add(focus);
  for (const node of selection.getNodes()) {
    if (
      $isElementNode(node) &&
      INTERNAL_$isBlock(node) &&
      !(skipFocus && node.is(focus))
    )
      blocks.add(node);
  }
  for (const block of blocks)
    block.setDirection(direction === "auto" ? null : direction);
}
