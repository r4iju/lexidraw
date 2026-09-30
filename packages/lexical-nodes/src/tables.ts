import {
  $createTableNodeWithDimensions,
  $getNodeTriplet,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableCellNode,
  $getTableRowIndexFromTableCellNode,
  $getTableColumnIndexFromTableCellNode,
  $isTableRowNode,
  $unmergeCell,
  $insertTableRowAtSelection,
  TableCellHeaderStates,
  type TableCellNode,
  type TableRowNode,
  $insertTableColumnAtSelection,
  $isTableNode,
  $isTableSelection,
  INSERT_TABLE_COMMAND,
  type InsertTableCommandPayload,
} from "@lexical/table";
import { $findMatchingParent, $insertNodeToNearestRoot } from "@lexical/utils";
import {
  $getSelection,
  $getRoot,
  $createParagraphNode,
  $isParagraphNode,
  $isTextNode,
  $isElementNode,
  type ElementNode,
  type LexicalNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  type LexicalEditor,
} from "lexical";

/**
 * TablePlugin's props for a document: the web passes them to TablePlugin,
 * and the iOS reference registers what they turn on. Of horizontal
 * scrolling, that is where Down into a table puts the caret.
 */
export const DOCUMENT_TABLE_PLUGIN = {
  hasCellMerge: true,
  hasCellBackgroundColor: true,
  hasHorizontalScroll: true,
  hasTabHandler: true,
  hasNestedTables: false,
} as const;

/**
 * How the web lays out a document's table past what its stylesheet says,
 * which `DocumentTablesPlugin` sets on the table as it renders.
 */
export const DOCUMENT_TABLE_LAYOUT = {
  /** A table more columns wide than this pins its first column on a narrow screen. */
  unpinnedColumns: 3,
  /**
   * About as many Latin letters as a label fits in: a column whose every
   * cell is this short (numbers, dates, names such as "claude-dev") stays on
   * one line while the table fits, so the columns holding sentences give
   * way first.
   */
  shortColumns: 16,
  /**
   * A table this wide scrolls on a phone whatever its cells do, and there a
   * label that stays whole reads better than one broken to fit.
   */
  scrollingColumns: 5,
} as const;

/**
 * What `DocumentTablesPlugin` reads a cell's text by: whether it's a
 * number, which sets its column right, and which characters are wide, a
 * wide one counting as two Latin letters toward a short column.
 */
export const DOCUMENT_TABLE_PATTERNS = {
  number:
    /^(?:[+-]?\s*(?:[$€£¥￥]|[A-Z]{3}\s)?\s*\d[\d,]*(?:\.\d+)?\s*(?:%|円)?|\(\s*[$€£¥￥]?\d[\d,]*(?:\.\d+)?\s*\))$/u,
  wide: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u,
} as const;

export function $createDocumentTable(rows: number, columns: number) {
  return $createTableNodeWithDimensions(rows, columns, {
    rows: true,
    columns: false,
  });
}

/**
 * INSERT_TABLE_COMMAND as a document takes it: a table with a header row
 * after the selection's block, with the caret in its first cell, and nothing
 * inside a table, whether the selection is in one or of its cells.
 */
export function $insertDocumentTable({
  rows,
  columns,
}: InsertTableCommandPayload): true {
  const selection = $getSelection();
  if (
    $isTableSelection(selection) ||
    ($isRangeSelection(selection) &&
      $findMatchingParent(selection.anchor.getNode(), $isTableNode))
  )
    return true;
  const table = $createDocumentTable(Number(rows), Number(columns));
  $insertNodeToNearestRoot(table);
  table.selectStart();
  return true;
}

/** Ahead of @lexical/table's own handler, so every surface inserts alike. */
export function registerDocumentTableInsertion(editor: LexicalEditor) {
  return editor.registerCommand(
    INSERT_TABLE_COMMAND,
    $insertDocumentTable,
    COMMAND_PRIORITY_HIGH,
  );
}

/**
 * The columns and rows the table menu acts on: those a table selection
 * spans, or one of each.
 */
export function $tableMenuCounts(): { columns: number; rows: number } {
  const selection = $getSelection();
  if (!$isTableSelection(selection)) return { columns: 1, rows: 1 };
  const { fromX, toX, fromY, toY } = selection.getShape();
  return { columns: toX - fromX + 1, rows: toY - fromY + 1 };
}

/** The table menu's column insertion, of as many as it counts. */
export function $insertDocumentTableColumns(insertAfter: boolean): void {
  const { columns } = $tableMenuCounts();
  for (let i = 0; i < columns; i++) $insertTableColumnAtSelection(insertAfter);
}

const $cellContainsEmptyParagraph = (cell: TableCellNode): boolean => {
  if (cell.getChildrenSize() !== 1) {
    return false;
  }
  const firstChild = cell.getFirstChildOrThrow();
  if (!$isParagraphNode(firstChild) || !firstChild.isEmpty()) {
    return false;
  }
  return true;
};

const $selectLastDescendant = (node: ElementNode): void => {
  const lastDescendant = node.getLastDescendant();
  if ($isTextNode(lastDescendant)) {
    lastDescendant.select();
  } else if ($isElementNode(lastDescendant)) {
    lastDescendant.selectEnd();
  } else if (lastDescendant !== null) {
    lastDescendant.selectNext();
  }
};

export function $mergeDocumentTableCells(): void {
  const selection = $getSelection();
  if ($isTableSelection(selection)) {
    const { columns, rows } = $tableMenuCounts();
    const nodes = selection.getNodes();
    let firstCell: null | TableCellNode = null;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if ($isTableCellNode(node)) {
        if (firstCell === null) {
          node.setColSpan(columns).setRowSpan(rows);
          firstCell = node;
          const isEmpty = $cellContainsEmptyParagraph(node);
          let firstChild: LexicalNode | null = null;
          if (isEmpty) {
            firstChild = node.getFirstChild();
          }
          if (isEmpty && $isParagraphNode(firstChild)) {
            firstChild.remove();
          }
        } else if ($isTableCellNode(firstCell)) {
          const isEmpty = $cellContainsEmptyParagraph(node);
          if (!isEmpty) {
            firstCell.append(...node.getChildren());
          }
          node.remove();
        }
      }
    }
    if (firstCell !== null) {
      if (firstCell.getChildrenSize() === 0) {
        firstCell.append($createParagraphNode());
      }
      $selectLastDescendant(firstCell);
    }
  }
}

export function $toggleDocumentTableRowHeader(): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) && !$isTableSelection(selection)) return;
  const [tableCellNode] = $getNodeTriplet(selection.anchor);
  const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode);

  const tableRowIndex = $getTableRowIndexFromTableCellNode(tableCellNode);

  const tableRows = tableNode.getChildren();

  if (tableRowIndex >= tableRows.length || tableRowIndex < 0) {
    throw new Error("Expected table cell to be inside of table row.");
  }

  const tableRow = tableRows[tableRowIndex];

  if (!$isTableRowNode(tableRow)) {
    throw new Error("Expected table row");
  }

  for (const tableCell of tableRow.getChildren()) {
    if (!$isTableCellNode(tableCell)) {
      throw new Error("Expected table cell");
    }

    tableCell.toggleHeaderStyle(TableCellHeaderStates.ROW);
  }

  $getRoot().selectStart();
}

export function $toggleDocumentTableColumnHeader(): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) && !$isTableSelection(selection)) return;
  const [tableCellNode] = $getNodeTriplet(selection.anchor);
  const tableNode = $getTableNodeFromLexicalNodeOrThrow(tableCellNode);

  const tableColumnIndex = $getTableColumnIndexFromTableCellNode(tableCellNode);

  const tableRows = tableNode.getChildren<TableRowNode>();
  const maxRowsLength = Math.max(
    ...tableRows.map((row) => row.getChildren().length),
  );

  if (tableColumnIndex >= maxRowsLength || tableColumnIndex < 0) {
    throw new Error("Expected table cell to be inside of table row.");
  }

  for (let r = 0; r < tableRows.length; r++) {
    const tableRow = tableRows[r];

    if (!$isTableRowNode(tableRow)) {
      throw new Error("Expected table row");
    }

    const tableCells = tableRow.getChildren();
    if (tableColumnIndex >= tableCells.length) {
      // if cell is outside of bounds for the current row (for example various merge cell cases) we shouldn't highlight it
      continue;
    }

    const tableCell = tableCells[tableColumnIndex];

    if (!$isTableCellNode(tableCell)) {
      throw new Error("Expected table cell");
    }

    tableCell.toggleHeaderStyle(TableCellHeaderStates.COLUMN);
  }

  $getRoot().selectStart();
}

export function $setDocumentTableCellBackground(value: string): void {
  const selection = $getSelection();
  if ($isRangeSelection(selection) || $isTableSelection(selection)) {
    const [cell] = $getNodeTriplet(selection.anchor);
    if ($isTableCellNode(cell)) {
      cell.setBackgroundColor(value);
    }

    if ($isTableSelection(selection)) {
      const nodes = selection.getNodes();

      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if ($isTableCellNode(node)) {
          node.setBackgroundColor(value);
        }
      }
    }
  }
}

export function $unmergeDocumentTableCell(): void {
  $unmergeCell();
}

export function $deleteDocumentTable(): void {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) && !$isTableSelection(selection)) return;
  const [cell] = $getNodeTriplet(selection.anchor);
  $getTableNodeFromLexicalNodeOrThrow(cell).remove();
  $getRoot().selectStart();
}

export function $insertDocumentTableRows(after: boolean): void {
  const { rows } = $tableMenuCounts();
  for (let i = 0; i < rows; i++) $insertTableRowAtSelection(after);
}
