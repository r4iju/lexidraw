/**
 * What @lexical/table does to the selection and to editing in a table that
 * a headless editor can't run from the package. TablePlugin registers these
 * handlers against each table's DOM, in `applyTableHandlers` and the
 * selection observer, so they are copied here, each naming the function it
 * copies. What needs no DOM, such as `TableObserver`'s methods, is the
 * package's own.
 *
 * Their DOM-only parts are left out. Pointer drags aren't modelled, and a
 * table selection is made the way a shift-click or shift-arrow makes one: a
 * range from one cell to another, turned into cells when the selection
 * changes.
 */
import {
  $computeTableMap,
  $createTableSelectionFrom,
  $findCellNode,
  $findTableNode,
  $isTableSelection,
  $isTableNode,
  $isTableRowNode,
  type TableCellNode,
  type TableNode,
  TableObserver,
  type TableSelection,
} from "@lexical/table";
import { $dfs } from "@lexical/utils";
import {
  $findMatchingParent,
  $getEditor,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  type RangeSelection,
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
