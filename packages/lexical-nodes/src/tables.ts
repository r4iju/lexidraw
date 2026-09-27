import {
  $createTableNodeWithDimensions,
  $insertTableColumnAtSelection,
  $isTableNode,
  $isTableSelection,
  INSERT_TABLE_COMMAND,
  type InsertTableCommandPayload,
} from "@lexical/table";
import { $findMatchingParent, $insertNodeToNearestRoot } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  type LexicalEditor,
} from "lexical";

/**
 * TablePlugin's props for a document: the web passes them to TablePlugin,
 * and the iOS reference registers what they turn on, short of horizontal
 * scrolling, which only changes the DOM.
 */
export const DOCUMENT_TABLE_PLUGIN = {
  hasCellMerge: true,
  hasCellBackgroundColor: true,
  hasHorizontalScroll: true,
  hasTabHandler: true,
  hasNestedTables: false,
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
 * The table menu's column insertion: as many columns as a table selection
 * spans, or one.
 */
export function $insertDocumentTableColumns(insertAfter: boolean): void {
  const selection = $getSelection();
  let count = 1;
  if ($isTableSelection(selection)) {
    const { fromX, toX } = selection.getShape();
    count = toX - fromX + 1;
  }
  for (let i = 0; i < count; i++) $insertTableColumnAtSelection(insertAfter);
}
