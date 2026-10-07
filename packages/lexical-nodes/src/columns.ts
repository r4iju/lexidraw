import {
  $createNodeSelection,
  $createParagraphNode,
  $getSelection,
  $hasAncestor,
  $isDecoratorNode,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  type LexicalNode,
} from "lexical";
import { LayoutContainerNode } from "./nodes/LayoutContainerNode.js";
import { LayoutItemNode } from "./nodes/LayoutItemNode.js";

const { $isLayoutContainerNode } = LayoutContainerNode;
const { $isLayoutItemNode } = LayoutItemNode;

/** The innermost column holding `node`, if any. */
export function $columnOf(node: LexicalNode): LayoutItemNode | null {
  for (let at: LexicalNode | null = node; at; at = at.getParent())
    if ($isLayoutItemNode(at) && $isLayoutContainerNode(at.getParent()))
      return at;
  return null;
}

/** The columns block a column sits in. */
export function $columnsOf(column: LayoutItemNode): LayoutContainerNode {
  const container = column.getParentOrThrow();
  if (!$isLayoutContainerNode(container))
    throw new Error("A column outside a columns block");
  return container;
}

/** A column holding nothing, or just the empty line a new column starts with. */
export function $isEmptyColumn(column: LayoutItemNode) {
  const children = column.getChildren();
  const [only] = children;
  return (
    children.length === 0 ||
    (children.length === 1 && $isParagraphNode(only) && only.isEmpty())
  );
}

/** The columns of a row, without anything stray beside them. */
function $columnsIn(container: LayoutContainerNode): LayoutItemNode[] {
  return container.getChildren().filter($isLayoutItemNode);
}

/**
 * The template's tracks when it is a plain list of one per column, as the
 * insert dialog and the resize handle write it; null for function syntax.
 */
function $plainTracks(container: LayoutContainerNode): string[] | null {
  const tracks = container.getTemplateColumns().trim().split(/\s+/);
  return tracks.length === $columnsIn(container).length &&
    tracks.every((track) => track && !track.includes("("))
    ? tracks
    : null;
}

/**
 * Takes `column` out of its row with its track, so the columns left keep
 * their widths; a template of another shape becomes equal shares.
 */
function $dropColumn(column: LayoutItemNode) {
  const container = $columnsOf(column);
  const tracks = $plainTracks(container);
  const index = $columnsIn(container).findIndex((at) => at.is(column));
  column.remove();
  const count = $columnsIn(container).length;
  container.setTemplateColumns(
    tracks
      ? tracks.filter((_, at) => at !== index).join(" ")
      : Array.from({ length: count }, () => "1fr").join(" "),
  );
}

/**
 * Removes an empty column, putting the caret at the end of the column
 * before it, or at the start of the one after it for the first.
 */
export function $removeColumn(column: LayoutItemNode) {
  const previous = column.getPreviousSibling();
  const next = column.getNextSibling();
  $dropColumn(column);
  if ($isLayoutItemNode(previous)) previous.selectEnd();
  else if ($isLayoutItemNode(next)) next.selectStart();
}

/** Puts every column's blocks, in reading order, where the columns were. */
export function $unwrapColumns(container: LayoutContainerNode) {
  for (const column of container.getChildren())
    for (const block of $isLayoutItemNode(column)
      ? column.getChildren()
      : [column])
      container.insertBefore(block);
  container.remove();
}

/**
 * A row of columns has two or more, and holds only columns: with fewer it
 * is just its blocks, as it is inside a column, where columns do not nest.
 * A block beside the columns joins the end of the column before it, or the
 * start of the first.
 */
export function $repairColumns(container: LayoutContainerNode) {
  const columns = $columnsIn(container);
  if (columns.length < 2 || $isLayoutItemNode(container.getParent())) {
    $unwrapColumns(container);
    return;
  }
  let column: LayoutItemNode | null = null;
  const leading: LexicalNode[] = [];
  for (const child of container.getChildren()) {
    if ($isLayoutItemNode(child)) column = child;
    else if (column) column.append(child);
    else leading.push(child);
  }
  const [first] = columns;
  const head = first?.getFirstChild();
  for (const block of leading)
    if (head) head.insertBefore(block);
    else first?.append(block);
}

/**
 * Moves a column's blocks onto the end of the column before it, taking the
 * column out of the row; the caret stays where it was.
 */
export function $joinColumn(column: LayoutItemNode) {
  const previous = column.getPreviousSibling();
  if (!$isLayoutItemNode(previous)) return;
  previous.append(...column.getChildren());
  $dropColumn(column);
}

/**
 * Takes the column after `column` into it: an empty one is removed, another
 * has its blocks moved onto the end of `column`. The caret stays.
 */
export function $pullNextColumn(column: LayoutItemNode) {
  const next = column.getNextSibling();
  if (!$isLayoutItemNode(next)) return;
  if ($isEmptyColumn(next)) $dropColumn(next);
  else $joinColumn(next);
}

/**
 * Where a line move from the caret lands: a node, `"stayed"` where the
 * caret does not move, or null where that is unknown.
 */
export type LineLanding = LexicalNode | "stayed" | null;

/**
 * Up or Down from the first or last line of a column. Where the move would
 * land outside the column, as in the column beside it, the caret leaves the
 * columns instead: Down to the start of what follows them, Up to the end of
 * what precedes them, a block decorator selected, and a new line where
 * there is nothing. An empty first or last block leaves without asking
 * `landing`, as rich text's line move onto decorators does.
 */
export function $leaveColumnsByLine(
  isBackward: boolean,
  landing: () => LineLanding,
): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const focus = selection.focus.getNode();
  const column = $columnOf(focus);
  if (!column || column.is(focus)) return false;
  const edge = isBackward ? column.getFirstChild() : column.getLastChild();
  if (!edge || !(edge.is(focus) || $hasAncestor(focus, edge))) return false;
  if (edge.getTextContentSize() > 0) {
    const landed = landing();
    if (landed === null) return false;
    if (
      landed !== "stayed" &&
      (landed.is(column) || $hasAncestor(landed, column))
    )
      return false;
  }
  const container = $columnsOf(column);
  const sibling = isBackward
    ? container.getPreviousSibling()
    : container.getNextSibling();
  if (
    $isDecoratorNode(sibling) &&
    !sibling.isInline() &&
    !sibling.isIsolated() &&
    sibling.isKeyboardSelectable()
  ) {
    const nodes = $createNodeSelection();
    nodes.add(sibling.getKey());
    $setSelection(nodes);
  } else if (sibling) {
    if (isBackward) sibling.selectEnd();
    else sibling.selectStart();
  } else {
    const line = $createParagraphNode();
    if (isBackward) container.insertBefore(line);
    else container.insertAfter(line);
    line.select();
  }
  return true;
}

/**
 * Left at the very start or Right at the very end of a columns block with
 * nothing before or after it: a new line there, with the caret on it.
 */
export function $leaveColumnsSideways(isBackward: boolean): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const { focus } = selection;
  const node = focus.getNode();
  const column = $columnOf(node);
  if (!column) return false;
  const container = $columnsOf(column);
  const edge = isBackward
    ? container.getFirstDescendant()
    : container.getLastDescendant();
  const size = $isElementNode(node)
    ? node.getChildrenSize()
    : node.getTextContentSize();
  if (!node.is(edge) || focus.offset !== (isBackward ? 0 : size)) return false;
  if (isBackward ? container.getPreviousSibling() : container.getNextSibling())
    return false;
  const line = $createParagraphNode();
  if (isBackward) container.insertBefore(line);
  else container.insertAfter(line);
  line.select();
  return true;
}

/** A point at the start or end of `node`, as a caret there would be. */
function $edgePoint(node: LexicalNode, atEnd: boolean) {
  // A line break or inline decorator holds no point; one beside it does.
  const parent = node.getParent();
  if (!$isTextNode(node) && !$isElementNode(node) && parent)
    return {
      key: parent.getKey(),
      offset: node.getIndexWithinParent() + (atEnd ? 1 : 0),
      type: "element",
    } as const;
  const offset = !atEnd
    ? 0
    : $isElementNode(node)
      ? node.getChildrenSize()
      : node.getTextContentSize();
  return {
    key: node.getKey(),
    offset,
    type: $isTextNode(node) ? "text" : "element",
  } as const;
}

/**
 * Select all inside a column selects what the column holds; where that is
 * already selected, it is left to select the whole document.
 */
export function $selectColumn(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const column = $columnOf(selection.anchor.getNode());
  if (!column?.is($columnOf(selection.focus.getNode()))) return false;
  const first = column.getFirstDescendant();
  const last = column.getLastDescendant();
  if (!first || !last) return false;
  const start = $edgePoint(first, false);
  const end = $edgePoint(last, true);
  const [from, to] = selection.isBackward()
    ? [selection.focus, selection.anchor]
    : [selection.anchor, selection.focus];
  const covered =
    from.key === start.key &&
    from.offset === start.offset &&
    to.key === end.key &&
    to.offset === end.offset;
  if (covered) return false;
  selection.anchor.set(start.key, start.offset, start.type);
  selection.focus.set(end.key, end.offset, end.type);
  return true;
}
