import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from "@lexical/markdown";
import {
  $isTableNode,
  type TableCellNode,
  type TableRowNode,
  TableCellHeaderStates,
} from "@lexical/table";
import { $getRoot } from "lexical";
import {
  $createDocumentTable,
  CORE_NODES,
  CORE_TRANSFORMERS,
} from "./index.js";

function editor() {
  return createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (e) => {
      throw e;
    },
  });
}

test("GFM alignment and escaped pipes survive import/export without storing widths", () => {
  const e = editor();
  const md =
    "| Name | Centre | Cost |\n| :--- | :---: | ---: |\n| claude-dev | A\\|B | 20% |";
  e.update(() => $convertFromMarkdownString(md, CORE_TRANSFORMERS), {
    discrete: true,
  });
  e.getEditorState().read(() => {
    const table = $getRoot().getFirstChild();
    expect($isTableNode(table)).toBe(true);
    if (!$isTableNode(table)) throw new Error("Expected table");
    expect(table.getColWidths()).toBeUndefined();
    expect(table.getColumnCount()).toBe(3);
    const rows = table.getChildren<TableRowNode>();
    expect(
      rows.map((row) =>
        row.getChildren<TableCellNode>().map((cell) => cell.getFormatType()),
      ),
    ).toEqual([
      ["left", "center", "right"],
      ["left", "center", "right"],
    ]);
    expect(
      rows[0]
        ?.getChildren<TableCellNode>()
        .map((cell) => cell.getHeaderStyles()),
    ).toEqual([1, 1, 1]);
    expect($convertToMarkdownString(CORE_TRANSFORMERS)).toBe(md);
  });
});

test("a headerless table exports one valid delimiter without dropping its first row", () => {
  const e = editor();
  e.update(
    () => {
      $convertFromMarkdownString(
        "| a | b |\n| --- | --- |\n| 1 | 2 |",
        CORE_TRANSFORMERS,
      );
      const table = $getRoot().getFirstChild();
      if (!$isTableNode(table)) throw new Error("Expected table");
      for (const row of table.getChildren<TableRowNode>()) {
        for (const cell of row.getChildren<TableCellNode>())
          cell.setHeaderStyles(TableCellHeaderStates.NO_STATUS);
      }
    },
    { discrete: true },
  );
  expect(
    e.getEditorState().read(() => $convertToMarkdownString(CORE_TRANSFORMERS)),
  ).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
});

test("the shared table factory creates only a header row and no stored sizes", () => {
  const e = editor();
  e.update(
    () => {
      $getRoot().append($createDocumentTable(3, 2));
    },
    { discrete: true },
  );
  e.getEditorState().read(() => {
    const table = $getRoot().getFirstChild();
    if (!$isTableNode(table)) throw new Error("Expected table");
    expect(table.getColWidths()).toBeUndefined();
    expect(
      table
        .getChildren<TableRowNode>()
        .map((row) =>
          row
            .getChildren<TableCellNode>()
            .map((cell) => cell.getHeaderStyles()),
        ),
    ).toEqual([
      [1, 1],
      [0, 0],
      [0, 0],
    ]);
  });
});
