/**
 * What @lexical/table does to the selection and to editing in a table that
 * a headless editor can't run from the package. TablePlugin registers these
 * handlers against each table's DOM, in `applyTableHandlers` and the
 * selection observer, so they are copied here, each naming the function it
 * copies. What needs no DOM, such as `TableObserver`'s methods, is the
 * package's own.
 *
 * The package's private helpers they call are copied with them. Their
 * DOM-only parts are left out, and what they measure in the DOM comes in
 * with the command: whether an arrow key's caret is on its cell's first or
 * last line. Pointer drags aren't modelled; a shift-click makes a table
 * selection as a range from one cell to another, turned into cells when the
 * selection changes.
 */
import {
  $computeTableCellRectBoundary,
  $computeTableMap,
  $createTableSelectionFrom,
  $findCellNode,
  $findTableNode,
  $getNodeTriplet,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableSelection,
  type TableCellNode,
  type TableCellRectBoundary,
  type TableMapType,
  type TableMapValueType,
  type TableNode,
  TableObserver,
  type TableSelection,
} from "@lexical/table";
import { $dfs, mergeRegister } from "@lexical/utils";
import { DOCUMENT_TABLE_PLUGIN } from "@packages/lexical-nodes/tables";
import {
  $caretFromPoint,
  $comparePointCaretNext,
  $extendCaretToRange,
  $findMatchingParent,
  $getAdjacentChildCaret,
  $getChildCaret,
  $getCommonAncestor,
  $getEditor,
  $getNodeByKey,
  $getSelection,
  $getSiblingCaret,
  $isChildCaret,
  $isElementNode,
  $isExtendableTextPointCaret,
  $isRangeSelection,
  $isRootOrShadowRoot,
  $isSiblingCaret,
  $isTextNode,
  $normalizeCaret,
  $setPointFromCaret,
  $setSelection,
  type BaseSelection,
  type CaretDirection,
  type ChildCaret,
  COMMAND_PRIORITY_HIGH,
  type ElementNode,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ARROW_UP_COMMAND,
  type LexicalEditor,
  type LexicalNode,
  type PointCaret,
  type RangeSelection,
  type SiblingCaret,
  type TextFormatType,
} from "lexical";

/**
 * The package the copies below come from, which the test pins: the copies
 * need checking again against another version.
 */
export const COPIED_FROM = "@lexical/table@0.51.0";

/**
 * Copies `$fixRangeSelectionForSelectedTable`, from the selection observer's
 * `$handleTableSelectionChangeCommand`: a range reaching into a table from
 * outside takes in the whole table, and one from cell to cell of a table
 * becomes a table selection.
 */
export function $fixRangeSelectionForSelectedTable(
  selection: RangeSelection,
): void {
  const { anchor, focus } = selection;
  const anchorCellNode = $findCellNode(anchor.getNode());
  const focusCellNode = $findCellNode(focus.getNode());
  const anchorCellTable = anchorCellNode
    ? $findTableNode(anchorCellNode)
    : null;
  const focusCellTable = focusCellNode ? $findTableNode(focusCellNode) : null;
  const isBackward = selection.isBackward();
  const shouldMoveFocus =
    focusCellTable &&
    (!anchorCellTable || anchorCellTable.isParentOf(focusCellTable));
  const shouldMoveAnchor =
    anchorCellTable &&
    (!focusCellTable || focusCellTable.isParentOf(anchorCellTable));
  if (shouldMoveFocus && focusCellNode) {
    const newSelection = selection.clone();
    const [firstCell, lastCell] = $cornerCells(focusCellTable, focusCellNode);
    newSelection.focus.set(
      isBackward ? firstCell.getKey() : lastCell.getKey(),
      isBackward ? 0 : lastCell.getChildrenSize(),
      "element",
    );
    $setSelection(newSelection);
  } else if (shouldMoveAnchor && anchorCellNode) {
    const newSelection = selection.clone();
    const [firstCell, lastCell] = $cornerCells(anchorCellTable, anchorCellNode);
    newSelection.anchor.set(
      isBackward ? lastCell.getKey() : firstCell.getKey(),
      isBackward ? lastCell.getChildrenSize() : 0,
      "element",
    );
    $setSelection(newSelection);
  } else if (
    anchorCellNode &&
    focusCellNode &&
    anchorCellTable?.is(focusCellTable) &&
    !anchorCellNode.is(focusCellNode)
  ) {
    // What `$setAnchorCellForSelection` and then
    // `$setFocusCellForSelection(cell, true)` leave selected.
    $setSelection(
      $createTableSelectionFrom(anchorCellTable, anchorCellNode, focusCellNode),
    );
  }
}

function $cornerCells(
  table: TableNode,
  cell: TableCellNode,
): [TableCellNode, TableCellNode] {
  const [tableMap] = $computeTableMap(table, cell, cell);
  const lastRow = tableMap[tableMap.length - 1];
  const last = lastRow?.[lastRow.length - 1];
  const first = tableMap[0]?.[0];
  if (!first || !last) throw new Error("A table without cells");
  return [first.cell, last.cell];
}

/** The tables in the order TablePlugin gives each its handlers. */
function $tables(): TableNode[] {
  return $dfs()
    .map(({ node }) => node)
    .filter($isTableNode);
}

/** Copies `$isSelectionInTable`. */
function $isSelectionInTable(
  selection: BaseSelection | null,
  tableNode: TableNode,
): boolean {
  return (
    ($isRangeSelection(selection) || $isTableSelection(selection)) &&
    tableNode.isParentOf(selection.anchor.getNode()) &&
    tableNode.isParentOf(selection.focus.getNode())
  );
}

/**
 * Copies `applyTableHandlers`'s `$deleteCellHandler`, each table's
 * KEY_BACKSPACE_COMMAND and KEY_DELETE_COMMAND handler: a range
 * with one end in a table grows around it, so the delete takes the table
 * whole; a table selection's cells are cleared. True where that handled it.
 */
export function $deleteCellHandler(): boolean {
  for (const tableNode of $tables()) {
    const selection = $getSelection();
    if (!($isRangeSelection(selection) || $isTableSelection(selection))) {
      return false;
    }
    const isAnchorInside = tableNode.isParentOf(selection.anchor.getNode());
    const isFocusInside = tableNode.isParentOf(selection.focus.getNode());
    if (isAnchorInside !== isFocusInside) {
      const tablePoint = isAnchorInside ? "anchor" : "focus";
      const outerPoint = isAnchorInside ? "focus" : "anchor";
      const { key, offset, type } = selection[outerPoint];
      const newSelection =
        tableNode[
          selection[tablePoint].isBefore(selection[outerPoint])
            ? "selectPrevious"
            : "selectNext"
        ]();
      newSelection[outerPoint].set(key, offset, type);
      continue;
    }
    if (!$isSelectionInTable(selection, tableNode)) continue;
    if ($isTableSelection(selection)) {
      $observer(tableNode.getKey()).$clearText();
      return true;
    }
  }
  return false;
}

/**
 * Copies `applyTableHandlers`'s `$deleteTextHandler`, each table's
 * DELETE_CHARACTER_COMMAND, DELETE_WORD_COMMAND and DELETE_LINE_COMMAND
 * handler: a table selection's cells are cleared.
 */
export function $deleteTextHandler(): boolean {
  const selection = $getSelection();
  if (!$isTableSelection(selection)) return false;
  $observer(selection.tableKey).$clearText();
  return true;
}

/**
 * Copies what `TableObserver.$clearHighlight` leaves of the selection, for
 * each table's CONTROLLED_TEXT_INSERTION_COMMAND handler over a table
 * selection. The method itself looks up the table's DOM.
 */
export function $clearHighlight(): void {
  if ($getSelection() !== null) $setSelection(null);
}

/** Each table's FORMAT_TEXT_COMMAND handler over a table selection. */
export function $formatCells(
  selection: TableSelection,
  type: TextFormatType,
): void {
  $observer(selection.tableKey).$formatCells(type);
}

/**
 * A table's `TableObserver`, for the methods that touch no DOM: its
 * constructor tracks the table's element, which a headless editor has none
 * of, so this one has no element and no cells of it.
 */
function $observer(tableNodeKey: string): TableObserver {
  const observer: TableObserver = Object.create(TableObserver.prototype);
  return Object.assign(observer, {
    editor: $getEditor(),
    table: { columns: 0, domRows: [], rows: 0 },
    tableNodeKey,
  });
}

/**
 * Copies `applyTableHandlers`'s KEY_TAB_COMMAND handler, which TablePlugin
 * registers with `hasTabHandler`: a caret in a cell moves to the end of the
 * next cell or the previous, and out of the table past its last or first.
 * False where the table doesn't take the Tab.
 */
export function $tabHandler(backward: boolean): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  const tableCellNode = $findCellNode(selection.anchor.getNode());
  if (tableCellNode === null || $findTableNode(tableCellNode) === null) {
    return false;
  }
  $selectAdjacentCell(tableCellNode, backward ? "previous" : "next");
  return true;
}

/** Copies `$selectAdjacentCell`. */
function $selectAdjacentCell(
  tableCellNode: TableCellNode,
  direction: "next" | "previous",
): void {
  const siblingMethod =
    direction === "next" ? "getNextSibling" : "getPreviousSibling";
  const childMethod = direction === "next" ? "getFirstChild" : "getLastChild";
  const sibling = tableCellNode[siblingMethod]();
  if ($isElementNode(sibling)) {
    sibling.selectEnd();
    return;
  }
  const parentRow = $findMatchingParent(tableCellNode, $isTableRowNode);
  if (parentRow === null) {
    throw new Error("selectAdjacentCell: Cell not in table row");
  }
  for (
    let nextRow = parentRow[siblingMethod]();
    $isTableRowNode(nextRow);
    nextRow = nextRow[siblingMethod]()
  ) {
    const child = nextRow[childMethod]();
    if ($isElementNode(child)) {
      child.selectEnd();
      return;
    }
  }
  const parentTable = $findMatchingParent(parentRow, $isTableNode);
  if (parentTable === null) {
    throw new Error("selectAdjacentCell: Row not in table");
  }
  if (direction === "next") parentTable.selectNext();
  else parentTable.selectPrevious();
}

/**
 * The key event the copied arrow handlers read. `atCellEdge` stands in for
 * the rectangles `$handleArrowKey` measures: whether the caret's line is the
 * first of its cell going up, or the last going down.
 */
export interface ArrowKeyEvent {
  shiftKey: boolean;
  atCellEdge: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

type Direction = "backward" | "forward" | "up" | "down";

/**
 * Copies `applyTableHandlers`'s arrow key handlers, each table's
 * `$handleArrowKey` at COMMAND_PRIORITY_HIGH, as TablePlugin registers them.
 */
export function registerTableArrowKeys(editor: LexicalEditor): () => void {
  const commands = [
    [KEY_ARROW_DOWN_COMMAND, "down"],
    [KEY_ARROW_UP_COMMAND, "up"],
    [KEY_ARROW_LEFT_COMMAND, "backward"],
    [KEY_ARROW_RIGHT_COMMAND, "forward"],
  ] as const;
  return mergeRegister(
    ...commands.map(([command, direction]) =>
      editor.registerCommand(
        command,
        (event) =>
          $tables().some((table) =>
            $handleArrowKey(
              event as unknown as ArrowKeyEvent,
              direction,
              table,
              $grid(table),
            ),
          ),
        COMMAND_PRIORITY_HIGH,
      ),
    ),
  );
}

/**
 * `TableObservers`' flag for scrolling tables: Down from before a table
 * names it, for the selection change after the key to check.
 */
let tableToCheck: string | null = null;

/** The table Down named, which only the next selection change checks. */
export function takeTableToCheck(): string | null {
  const key = tableToCheck;
  tableToCheck = null;
  return key;
}

/**
 * Copies `$handleArrowKey`, with `grid` for the observer's `table`. The
 * typeahead menu check, which reads the root element's attributes, is left
 * out.
 */
function $handleArrowKey(
  event: ArrowKeyEvent,
  direction: Direction,
  tableNode: TableNode,
  grid: Grid,
): boolean {
  const selection = $getSelection();
  if (!$isSelectionInTable(selection, tableNode)) {
    if ($isRangeSelection(selection)) {
      if (direction === "backward") {
        if (selection.focus.offset > 0) return false;
        const parentNode = $getBlockParentIfFirstNode(
          selection.focus.getNode(),
        );
        if (!parentNode) return false;
        const siblingNode = parentNode.getPreviousSibling();
        if (!$isTableNode(siblingNode)) return false;
        stopEvent(event);
        if (event.shiftKey) {
          selection.focus.set(
            siblingNode.getParentOrThrow().getKey(),
            siblingNode.getIndexWithinParent(),
            "element",
          );
        } else {
          siblingNode.selectEnd();
        }
        return true;
      } else if (
        event.shiftKey &&
        (direction === "up" || direction === "down")
      ) {
        const focusNode = selection.focus.getNode();
        const isTableUnselect =
          !selection.isCollapsed() &&
          ((direction === "up" && !selection.isBackward()) ||
            (direction === "down" && selection.isBackward()));
        if (isTableUnselect) {
          const focusParentNode = $findMatchingParent(focusNode, $isTableNode);
          // Upstream compares the node the table's handlers were given when
          // its DOM was attached, which is this one until the table itself
          // is written.
          if (!focusParentNode?.is(tableNode)) return false;
          const sibling =
            direction === "down"
              ? focusParentNode.getNextSibling()
              : focusParentNode.getPreviousSibling();
          if (!sibling) return false;
          let newOffset = 0;
          if (direction === "up" && $isElementNode(sibling)) {
            newOffset = sibling.getChildrenSize();
          }
          let newFocusNode: LexicalNode = sibling;
          if (direction === "up" && $isElementNode(sibling)) {
            const lastCell = sibling.getLastChild();
            newFocusNode = lastCell ? lastCell : sibling;
            newOffset = $isTextNode(newFocusNode)
              ? newFocusNode.getTextContentSize()
              : 0;
          }
          const newSelection = selection.clone();
          newSelection.focus.set(
            newFocusNode.getKey(),
            newOffset,
            $isTextNode(newFocusNode) ? "text" : "element",
          );
          $setSelection(newSelection);
          stopEvent(event);
          return true;
        } else if ($isRootOrShadowRoot(focusNode)) {
          const nodes = selection.getNodes();
          const selectedNode =
            direction === "up" ? nodes[nodes.length - 1] : nodes[0];
          if (selectedNode) {
            const tableCellNode = $findParentTableCellNodeInTable(
              tableNode,
              selectedNode,
            );
            if (tableCellNode !== null) {
              const firstDescendant = tableNode.getFirstDescendant();
              const lastDescendant = tableNode.getLastDescendant();
              if (!firstDescendant || !lastDescendant) return false;
              const [firstCellNode] = $getNodeTriplet(firstDescendant);
              const [lastCellNode] = $getNodeTriplet(lastDescendant);
              const firstCellCoords = cords(firstCellNode, grid);
              const lastCellCoords = cords(lastCellNode, grid);
              $selectCells(
                tableNode,
                cellFromCordsOrThrow(
                  firstCellCoords.x,
                  firstCellCoords.y,
                  grid,
                ),
                cellFromCordsOrThrow(lastCellCoords.x, lastCellCoords.y, grid),
              );
              return true;
            }
          }
          return false;
        } else {
          let focusParentNode = $findMatchingParent(
            focusNode,
            (n) => $isElementNode(n) && !n.isInline(),
          );
          if ($isTableCellNode(focusParentNode)) {
            focusParentNode = $findMatchingParent(
              focusParentNode,
              $isTableNode,
            );
          }
          if (!focusParentNode) return false;
          const sibling =
            direction === "down"
              ? focusParentNode.getNextSibling()
              : focusParentNode.getPreviousSibling();
          if ($isTableNode(sibling) && sibling.is(tableNode)) {
            const firstDescendant = sibling.getFirstDescendant();
            const lastDescendant = sibling.getLastDescendant();
            if (!firstDescendant || !lastDescendant) return false;
            const [firstCellNode] = $getNodeTriplet(firstDescendant);
            const [lastCellNode] = $getNodeTriplet(lastDescendant);
            const newSelection = selection.clone();
            newSelection.focus.set(
              (direction === "up" ? firstCellNode : lastCellNode).getKey(),
              direction === "up" ? 0 : lastCellNode.getChildrenSize(),
              "element",
            );
            stopEvent(event);
            $setSelection(newSelection);
            return true;
          }
        }
      }
    }
    if (
      direction === "down" &&
      DOCUMENT_TABLE_PLUGIN.hasHorizontalScroll &&
      $isSelectionBeforeTable(selection, tableNode)
    ) {
      tableToCheck = tableNode.getKey();
    }
    return false;
  }

  if ($isRangeSelection(selection)) {
    if (direction === "backward" || direction === "forward") {
      return $handleHorizontalArrowKeyRangeSelection(
        event,
        selection,
        event.shiftKey ? "extend" : "move",
        direction === "backward",
        tableNode,
      );
    }
    if (selection.isCollapsed()) {
      const { anchor, focus } = selection;
      const anchorCellNode = $findMatchingParent(
        anchor.getNode(),
        $isTableCellNode,
      );
      const focusCellNode = $findMatchingParent(
        focus.getNode(),
        $isTableCellNode,
      );
      if (
        !$isTableCellNode(anchorCellNode) ||
        !anchorCellNode.is(focusCellNode)
      ) {
        return false;
      }
      const anchorCellTable = $findTableNode(anchorCellNode);
      if (anchorCellTable !== null && !anchorCellTable.is(tableNode)) {
        return $handleArrowKey(
          event,
          direction,
          anchorCellTable,
          $grid(anchorCellTable),
        );
      }
      const edgeChild =
        direction === "up"
          ? anchorCellNode.getFirstChild()
          : anchorCellNode.getLastChild();
      if (edgeChild == null) return false;
      if (event.atCellEdge) {
        stopEvent(event);
        const { x, y } = cords(anchorCellNode, grid);
        if (event.shiftKey) {
          const cell = cellFromCordsOrThrow(x, y, grid);
          $selectCells(tableNode, cell, cell);
        } else {
          return selectTableNodeInDirection(tableNode, grid, x, y, direction);
        }
        return true;
      }
    }
  } else if ($isTableSelection(selection)) {
    const { anchor, focus, tableKey } = selection;
    if (tableKey !== tableNode.getKey()) return false;
    const anchorCellNode = $findMatchingParent(
      anchor.getNode(),
      $isTableCellNode,
    );
    const focusCellNode = $findMatchingParent(
      focus.getNode(),
      $isTableCellNode,
    );
    const [tableNodeFromSelection] = selection.getNodes();
    if (!$isTableNode(tableNodeFromSelection)) {
      throw new Error(
        "$handleArrowKey: TableSelection.getNodes()[0] expected to be TableNode",
      );
    }
    if (!$isTableCellNode(anchorCellNode) || !$isTableCellNode(focusCellNode)) {
      return false;
    }
    const selectionGrid = $grid(tableNodeFromSelection);
    const cordsAnchor = cords(anchorCellNode, selectionGrid);
    cellFromCordsOrThrow(cordsAnchor.x, cordsAnchor.y, selectionGrid);
    stopEvent(event);
    if (event.shiftKey) {
      const [tableMap, anchorValue, focusValue] = $computeTableMap(
        tableNode,
        anchorCellNode,
        focusCellNode,
      );
      return $adjustFocusInDirection(
        tableNode,
        grid,
        tableMap,
        anchorValue,
        focusValue,
        direction,
      );
    }
    focusCellNode.selectEnd();
    return true;
  }
  return false;
}

/** Copies `$isSelectionBeforeTable`. */
function $isSelectionBeforeTable(
  selection: BaseSelection | null,
  tableNode: TableNode,
): boolean {
  if (!$isRangeSelection(selection)) return false;
  const focusCaret = $caretFromPoint(selection.focus, "next");
  const tableCaret = $getChildCaret(tableNode, "next");
  return (
    $getCommonAncestor(focusCaret.origin, tableCaret.origin) !== null &&
    $comparePointCaretNext(focusCaret, tableCaret) < 0
  );
}

/**
 * Copies the check in `$handleTableSelectionChangeCommand`: a caret Down
 * put in the table, other than in its first cell, goes to the start of the
 * first cell. True where it moved the caret.
 */
export function $checkSelectionForTable(
  tableKey: string,
  prevSelection: BaseSelection | null,
): boolean {
  const selection = $getSelection();
  if (
    !$isRangeSelection(prevSelection) ||
    !$isRangeSelection(selection) ||
    !selection.isCollapsed()
  ) {
    return false;
  }
  const tableNode = $getNodeByKey(tableKey);
  if (!$isTableNode(tableNode)) return false;
  const anchorCell = $findCellNode(selection.anchor.getNode());
  const firstRow = tableNode.getFirstChild();
  if (anchorCell === null || !$isTableRowNode(firstRow)) return false;
  const firstCell = firstRow.getFirstChild();
  if (
    $isTableCellNode(firstCell) &&
    tableNode.is(
      $findMatchingParent(
        anchorCell,
        (node) => node.is(tableNode) || node.is(firstCell),
      ),
    )
  ) {
    firstCell.selectStart();
    return true;
  }
  return false;
}

/** Copies `$findParentTableCellNodeInTable`. */
function $findParentTableCellNodeInTable(
  tableNode: LexicalNode,
  node: LexicalNode | null,
): TableCellNode | null {
  let lastTableCellNode: TableCellNode | null = null;
  for (let current = node; current !== null; current = current.getParent()) {
    if (tableNode.is(current)) return lastTableCellNode;
    if ($isTableCellNode(current)) lastTableCellNode = current;
  }
  return null;
}

/** Copies `$getBlockParentIfFirstNode`. */
function $getBlockParentIfFirstNode(node: LexicalNode): ElementNode | null {
  for (
    let prevNode = node, currentNode: LexicalNode | null = node;
    currentNode !== null;
    prevNode = currentNode, currentNode = currentNode.getParent()
  ) {
    if ($isElementNode(currentNode)) {
      if (
        currentNode !== prevNode &&
        currentNode.getFirstChild() !== prevNode
      ) {
        return null;
      } else if (!currentNode.isInline()) {
        return currentNode;
      }
    }
  }
  return null;
}

/** Copies `$handleHorizontalArrowKeyRangeSelection`. */
function $handleHorizontalArrowKeyRangeSelection(
  event: ArrowKeyEvent,
  selection: RangeSelection,
  alter: "extend" | "move",
  isBackward: boolean,
  tableNode: TableNode,
): boolean {
  const initialFocus = $caretFromPoint(
    selection.focus,
    isBackward ? "previous" : "next",
  );
  if ($isExtendableTextPointCaret(initialFocus)) return false;
  let lastCaret: PointCaret<CaretDirection> = initialFocus;
  for (const nextCaret of $extendCaretToRange(initialFocus).iterNodeCarets(
    "shadowRoot",
  )) {
    if (!($isSiblingCaret(nextCaret) && $isElementNode(nextCaret.origin))) {
      return false;
    }
    lastCaret = nextCaret;
  }
  const lastCaretParent = lastCaret.getParentAtCaret();
  if (!$isTableCellNode(lastCaretParent)) return false;
  const anchorCell = lastCaretParent;
  const focusCaret = $findNextTableCell(
    $getSiblingCaret(anchorCell, lastCaret.direction),
  );
  const anchorCellTable = $findMatchingParent(anchorCell, $isTableNode);
  if (!anchorCellTable?.is(tableNode)) return false;
  if (!focusCaret) {
    if (alter === "extend") {
      $selectCells(tableNode, anchorCell, anchorCell);
    } else {
      const outerFocusCaret = $getTableExitCaret(
        $getSiblingCaret(anchorCellTable, initialFocus.direction),
      );
      $setPointFromCaret(selection.anchor, outerFocusCaret);
      $setPointFromCaret(selection.focus, outerFocusCaret);
    }
  } else if (alter === "extend") {
    $selectCells(tableNode, anchorCell, focusCaret.origin);
  } else {
    const innerFocusCaret = $normalizeCaret(focusCaret);
    $setPointFromCaret(selection.anchor, innerFocusCaret);
    $setPointFromCaret(selection.focus, innerFocusCaret);
  }
  stopEvent(event);
  return true;
}

/** Copies `$getTableExitCaret`. */
function $getTableExitCaret<D extends CaretDirection>(
  initialCaret: SiblingCaret<TableNode, D>,
): PointCaret<D> {
  const adjacent = $getAdjacentChildCaret(initialCaret);
  return $isChildCaret(adjacent) ? $normalizeCaret(adjacent) : initialCaret;
}

/** Copies `$findNextTableCell`. */
function $findNextTableCell<D extends CaretDirection>(
  initialCaret: SiblingCaret<TableCellNode, D>,
): null | ChildCaret<TableCellNode, D> {
  for (const nextCaret of $extendCaretToRange(initialCaret).iterNodeCarets(
    "root",
  )) {
    const { origin } = nextCaret;
    if ($isTableCellNode(origin)) {
      if ($isChildCaret(nextCaret)) {
        return $getChildCaret(origin, initialCaret.direction);
      }
    } else if (!$isTableRowNode(origin)) {
      break;
    }
  }
  return null;
}

/** Copies `selectTableNodeInDirection`. */
function selectTableNodeInDirection(
  tableNode: TableNode,
  grid: Grid,
  x: number,
  y: number,
  direction: Direction,
): boolean {
  const isForward = direction === "forward";
  const select = (cell: TableCellNode, fromStart: boolean) =>
    fromStart ? cell.selectStart() : cell.selectEnd();
  switch (direction) {
    case "backward":
    case "forward":
      if (x !== (isForward ? grid.columns - 1 : 0)) {
        select(
          cellNodeFromCordsOrThrow(x + (isForward ? 1 : -1), y, grid),
          isForward,
        );
      } else if (y !== (isForward ? grid.rows - 1 : 0)) {
        select(
          cellNodeFromCordsOrThrow(
            isForward ? 0 : grid.columns - 1,
            y + (isForward ? 1 : -1),
            grid,
          ),
          isForward,
        );
      } else if (!isForward) {
        tableNode.selectPrevious();
      } else {
        tableNode.selectNext();
      }
      return true;
    case "up":
      if (y !== 0) {
        select(cellNodeFromCordsOrThrow(x, y - 1, grid), false);
      } else {
        tableNode.selectPrevious();
      }
      return true;
    case "down":
      if (y !== grid.rows - 1) {
        select(cellNodeFromCordsOrThrow(x, y + 1, grid), true);
      } else {
        tableNode.selectNext();
      }
      return true;
  }
}

type Corner = ["minColumn" | "maxColumn", "minRow" | "maxRow"];

/** Copies `getCorner`. */
function getCorner(
  rect: TableCellRectBoundary,
  cellValue: TableMapValueType,
): Corner | null {
  let colName: "minColumn" | "maxColumn";
  let rowName: "minRow" | "maxRow";
  if (cellValue.startColumn === rect.minColumn) {
    colName = "minColumn";
  } else if (
    cellValue.startColumn + cellValue.cell.__colSpan - 1 ===
    rect.maxColumn
  ) {
    colName = "maxColumn";
  } else {
    return null;
  }
  if (cellValue.startRow === rect.minRow) {
    rowName = "minRow";
  } else if (
    cellValue.startRow + cellValue.cell.__rowSpan - 1 ===
    rect.maxRow
  ) {
    rowName = "maxRow";
  } else {
    return null;
  }
  return [colName, rowName];
}

/** Copies `getAnchorCorner`. */
function getAnchorCorner(
  rect: TableCellRectBoundary,
  anchorCellValue: TableMapValueType,
  focusCellValue: TableMapValueType,
): Corner {
  const anchorCorner = getCorner(rect, anchorCellValue);
  if (anchorCorner) return anchorCorner;
  const focusCorner = getCorner(rect, focusCellValue);
  if (focusCorner) return oppositeCorner(focusCorner);
  return ["minColumn", "minRow"];
}

/** Copies `oppositeCorner`. */
function oppositeCorner([colName, rowName]: Corner): Corner {
  return [
    colName === "minColumn" ? "maxColumn" : "minColumn",
    rowName === "minRow" ? "maxRow" : "minRow",
  ];
}

/** Copies `cellAtCornerOrThrow`. */
function cellAtCornerOrThrow(
  tableMap: TableMapType,
  rect: TableCellRectBoundary,
  [colName, rowName]: Corner,
): TableMapValueType {
  const rowMap = tableMap[rect[rowName]];
  if (rowMap === undefined) {
    throw new Error(`cellAtCornerOrThrow: ${rowName} missing in tableMap`);
  }
  const cell = rowMap[rect[colName]];
  if (cell === undefined) {
    throw new Error(`cellAtCornerOrThrow: ${colName} missing in tableMap`);
  }
  return cell;
}

/** Copies `$extractRectCorners`. */
function $extractRectCorners(
  tableMap: TableMapType,
  anchorCellValue: TableMapValueType,
  newFocusCellValue: TableMapValueType,
): [TableMapValueType, TableMapValueType] {
  const rect = $computeTableCellRectBoundary(
    tableMap,
    anchorCellValue,
    newFocusCellValue,
  );
  const anchorCorner = getAnchorCorner(
    rect,
    anchorCellValue,
    newFocusCellValue,
  );
  return [
    cellAtCornerOrThrow(tableMap, rect, anchorCorner),
    cellAtCornerOrThrow(tableMap, rect, oppositeCorner(anchorCorner)),
  ];
}

/** Copies `$computeTableCellRectSpans`, which the package doesn't export. */
function $computeTableCellRectSpans(
  map: TableMapType,
  boundary: TableCellRectBoundary,
): {
  topSpan: number;
  leftSpan: number;
  rightSpan: number;
  bottomSpan: number;
} {
  const { minColumn, maxColumn, minRow, maxRow } = boundary;
  let topSpan = 1;
  let leftSpan = 1;
  let rightSpan = 1;
  let bottomSpan = 1;
  const topRow = map[minRow] as TableMapValueType[];
  const bottomRow = map[maxRow] as TableMapValueType[];
  for (let col = minColumn; col <= maxColumn; col++) {
    topSpan = Math.max(
      topSpan,
      (topRow[col] as TableMapValueType).cell.__rowSpan,
    );
    bottomSpan = Math.max(
      bottomSpan,
      (bottomRow[col] as TableMapValueType).cell.__rowSpan,
    );
  }
  for (let row = minRow; row <= maxRow; row++) {
    const cells = map[row] as TableMapValueType[];
    leftSpan = Math.max(
      leftSpan,
      (cells[minColumn] as TableMapValueType).cell.__colSpan,
    );
    rightSpan = Math.max(
      rightSpan,
      (cells[maxColumn] as TableMapValueType).cell.__colSpan,
    );
  }
  return { bottomSpan, leftSpan, rightSpan, topSpan };
}

/** Copies `$adjustFocusInDirection`. */
function $adjustFocusInDirection(
  tableNode: TableNode,
  grid: Grid,
  tableMap: TableMapType,
  anchorCellValue: TableMapValueType,
  focusCellValue: TableMapValueType,
  direction: Direction,
): boolean {
  const rect = $computeTableCellRectBoundary(
    tableMap,
    anchorCellValue,
    focusCellValue,
  );
  const { topSpan, leftSpan, bottomSpan, rightSpan } =
    $computeTableCellRectSpans(tableMap, rect);
  const anchorCorner = getAnchorCorner(rect, anchorCellValue, focusCellValue);
  const [focusColumn, focusRow] = oppositeCorner(anchorCorner);
  let fCol = rect[focusColumn];
  let fRow = rect[focusRow];
  if (direction === "forward") {
    fCol += focusColumn === "maxColumn" ? 1 : leftSpan;
  } else if (direction === "backward") {
    fCol -= focusColumn === "minColumn" ? 1 : rightSpan;
  } else if (direction === "down") {
    fRow += focusRow === "maxRow" ? 1 : topSpan;
  } else if (direction === "up") {
    fRow -= focusRow === "minRow" ? 1 : bottomSpan;
  }
  const targetRowMap = tableMap[fRow];
  if (targetRowMap === undefined) return false;
  const newFocusCellValue = targetRowMap[fCol];
  if (newFocusCellValue === undefined) return false;
  const [finalAnchorCell, finalFocusCell] = $extractRectCorners(
    tableMap,
    anchorCellValue,
    newFocusCellValue,
  );
  $selectCells(
    tableNode,
    observerCell(finalAnchorCell.cell, grid),
    observerCell(finalFocusCell.cell, grid),
  );
  return true;
}

/**
 * What `TableObserver.$setAnchorCellForSelection` and then
 * `$setFocusCellForSelection(cell, true)` leave selected.
 */
function $selectCells(
  tableNode: TableNode,
  anchor: TableCellNode,
  focus: TableCellNode,
): void {
  $setSelection($createTableSelectionFrom(tableNode, anchor, focus));
}

/** Copies `stopEvent`. */
function stopEvent(event: ArrowKeyEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
  event.stopPropagation();
}

/** A cell as `getTable` records it: its place in the walk of the table's DOM. */
type GridCell = { cell: TableCellNode; x: number; y: number };

/** `TableDOMTable`, with holes where the walk records no cell. */
type Grid = { columns: number; rows: number; domRows: GridCell[][] };

/**
 * Copies `getTable`'s walk of a table's `tr`s and their cells, which counts
 * a cell's place in its `tr` rather than its column, and moves past an
 * empty `tr` as past a cell.
 */
function $grid(tableNode: TableNode): Grid {
  const domRows: GridCell[][] = [];
  const rows = tableNode.getChildren();
  let x = 0;
  let y = 0;
  for (const [index, row] of rows.entries()) {
    const cells = $isElementNode(row) ? row.getChildren() : [];
    const isLast = index === rows.length - 1;
    if (cells.length === 0) {
      if (isLast) break;
      x++;
      continue;
    }
    for (const [i, cell] of cells.entries()) {
      if (i > 0) x++;
      if (!$isTableCellNode(cell)) continue;
      domRows[y] ??= [];
      (domRows[y] as GridCell[])[x] = { cell, x, y };
    }
    if (isLast) break;
    y++;
    x = 0;
  }
  return { columns: x + 1, domRows, rows: y + 1 };
}

/** Copies `TableNode.getCordsFromCellNode`. */
function cords(cellNode: TableCellNode, grid: Grid): { x: number; y: number } {
  for (let y = 0; y < grid.rows; y++) {
    const row = grid.domRows[y];
    if (row == null) continue;
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      if (cell != null && cellNode.is(cell.cell)) return { x, y };
    }
  }
  throw new Error("Cell not found in table.");
}

/** Copies `TableNode.getDOMCellFromCords`, for the cell it names. */
function cellFromCords(x: number, y: number, grid: Grid): TableCellNode | null {
  const row = grid.domRows[y];
  if (row == null) return null;
  const cell = row[x < row.length ? x : row.length - 1];
  return cell == null ? null : cell.cell;
}

/** Copies `TableNode.getDOMCellFromCordsOrThrow`. */
function cellFromCordsOrThrow(x: number, y: number, grid: Grid): TableCellNode {
  const cell = cellFromCords(x, y, grid);
  if (!cell) throw new Error("Cell not found at cords.");
  return cell;
}

/** Copies `TableNode.getCellNodeFromCordsOrThrow`. */
function cellNodeFromCordsOrThrow(
  x: number,
  y: number,
  grid: Grid,
): TableCellNode {
  const cell = cellFromCords(x, y, grid);
  if (!cell) throw new Error("Node at cords not TableCellNode.");
  return cell;
}

/** Copies `$getObserverCellFromCellNodeOrThrow`, for the cell it names. */
function observerCell(cellNode: TableCellNode, grid: Grid): TableCellNode {
  const { x, y } = cords(cellNode, grid);
  return cellFromCordsOrThrow(x, y, grid);
}
