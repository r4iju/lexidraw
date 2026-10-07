import { expect, test } from "bun:test";
import { createHeadlessEditor } from "@lexical/headless";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  registerMarkdownShortcuts,
} from "@lexical/markdown";
import {
  $createTableSelectionFrom,
  $isTableCellNode,
  $isTableNode,
  INSERT_TABLE_COMMAND,
  type TableCellNode,
  type TableNode,
  type TableRowNode,
  TableCellHeaderStates,
} from "@lexical/table";
import { $findMatchingParent } from "@lexical/utils";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  type ParagraphNode,
} from "lexical";
import {
  $createDocumentTable,
  $insertDocumentTableColumns,
  $tableMenuCounts,
  CORE_NODES,
  CORE_TRANSFORMERS,
  registerDocumentTableInsertion,
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

function $table(): TableNode {
  const table = $getRoot().getChildren().find($isTableNode);
  if (!table) throw new Error("Expected table");
  return table;
}

function $cell(row: number, column: number): TableCellNode {
  const cell = $table()
    .getChildAtIndex<TableRowNode>(row)
    ?.getChildAtIndex(column);
  if (!$isTableCellNode(cell)) throw new Error("Expected cell");
  return cell;
}

/** A paragraph, then a 2 by 2 table, with the table insertion registered. */
function tableEditor() {
  const e = editor();
  registerDocumentTableInsertion(e);
  e.update(
    () => {
      $getRoot().append($createParagraphNode(), $createDocumentTable(2, 2));
    },
    { discrete: true },
  );
  return e;
}

function tableShapes(e: ReturnType<typeof editor>) {
  return e.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((block) =>
        $isTableNode(block)
          ? block
              .getChildren<TableRowNode>()
              .map((row) =>
                row
                  .getChildren<TableCellNode>()
                  .map((cell) =>
                    cell.getChildren().map((child) => child.getType()),
                  ),
              )
          : block.getType(),
      ),
  );
}

function insertTable(e: ReturnType<typeof editor>) {
  e.update(
    () => {
      e.dispatchCommand(INSERT_TABLE_COMMAND, { rows: "1", columns: "1" });
    },
    { discrete: true },
  );
}

test("a table goes after the caret's block, with the caret in its first cell", () => {
  const e = tableEditor();
  e.update(() => $getRoot().getFirstChildOrThrow<ParagraphNode>().select(), {
    discrete: true,
  });
  insertTable(e);
  e.getEditorState().read(() => {
    expect(
      $getRoot()
        .getChildren()
        .map((block) => block.getType()),
    ).toEqual(["paragraph", "table", "table"]);
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) throw new Error("Expected a caret");
    const table = $findMatchingParent(selection.anchor.getNode(), $isTableNode);
    expect(table?.getIndexWithinParent()).toBe(1);
  });
});

test("no table is inserted inside a table, whether the caret is in a cell or cells are selected", () => {
  const e = tableEditor();
  const before = tableShapes(e);
  e.update(() => $cell(0, 0).selectStart(), { discrete: true });
  insertTable(e);
  expect(tableShapes(e)).toEqual(before);

  e.update(
    () =>
      $setSelection(
        $createTableSelectionFrom($table(), $cell(0, 0), $cell(1, 1)),
      ),
    { discrete: true },
  );
  insertTable(e);
  expect(tableShapes(e)).toEqual(before);
});

test("the menu inserts as many columns as the selected cells span, or one", () => {
  const e = tableEditor();
  e.update(
    () => {
      $setSelection(
        $createTableSelectionFrom($table(), $cell(0, 0), $cell(1, 1)),
      );
      $insertDocumentTableColumns(true);
    },
    { discrete: true },
  );
  expect(e.getEditorState().read(() => $table().getColumnCount())).toBe(4);

  e.update(
    () => {
      $cell(0, 0).selectStart();
      $insertDocumentTableColumns(false);
    },
    { discrete: true },
  );
  expect(e.getEditorState().read(() => $table().getColumnCount())).toBe(5);
});

test("the menu counts the columns and rows of the selected cells, or one of each", () => {
  const e = tableEditor();
  const counts = (select: () => void) => {
    e.update(select, { discrete: true });
    return e.getEditorState().read($tableMenuCounts);
  };

  expect(
    counts(() =>
      $setSelection(
        $createTableSelectionFrom($table(), $cell(0, 0), $cell(1, 1)),
      ),
    ),
  ).toEqual({ columns: 2, rows: 2 });
  expect(counts(() => $cell(0, 0).selectStart())).toEqual({
    columns: 1,
    rows: 1,
  });
});

/** The text of each cell's blocks, or the types inside it that aren't text. */
function cellContents(e: ReturnType<typeof editor>) {
  return e.getEditorState().read(() =>
    $table()
      .getChildren<TableRowNode>()
      .map((row) =>
        row
          .getChildren<TableCellNode>()
          .map((cell) =>
            cell
              .getChildren()
              .map((block) =>
                $isParagraphNode(block)
                  ? block.getTextContent()
                  : block.getType(),
              ),
          ),
      ),
  );
}

test("a row imported inside a cell stays its text, as no table goes inside a table", () => {
  const e = editor();
  e.update(
    () => $convertFromMarkdownString("| a | \\|b\\| |", CORE_TRANSFORMERS),
    { discrete: true },
  );
  expect(cellContents(e)).toEqual([[["a"], ["|b|"]]]);
});

test("a row typed inside a cell stays as typed, as no table goes inside a table", async () => {
  const e = tableEditor();
  registerMarkdownShortcuts(e, CORE_TRANSFORMERS);
  e.update(
    () => {
      const paragraph = $cell(0, 0).getFirstChildOrThrow<ParagraphNode>();
      paragraph.append($createTextNode("|b|"));
      paragraph.selectEnd();
    },
    { discrete: true },
  );
  e.update(
    () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Expected a caret");
      selection.insertText(" ");
    },
    { discrete: true },
  );
  // The shortcut runs in an update the update listener queues.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cellContents(e)).toEqual([
    [["|b| "], [""]],
    [[""], [""]],
  ]);
});

test("a row typed under a table with as many columns joins it, with the caret at its end", async () => {
  const errors: unknown[] = [];
  const e = createHeadlessEditor({
    nodes: CORE_NODES,
    onError: (error) => errors.push(error),
  });
  registerMarkdownShortcuts(e, CORE_TRANSFORMERS);
  e.update(
    () => {
      const paragraph = $createParagraphNode();
      $getRoot().append($createDocumentTable(1, 2), paragraph);
      paragraph.append($createTextNode("|c|d|"));
      paragraph.selectEnd();
    },
    { discrete: true },
  );
  e.update(
    () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Expected a caret");
      selection.insertText(" ");
    },
    { discrete: true },
  );
  // The shortcut runs in an update the update listener queues.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(errors).toEqual([]);
  expect(cellContents(e)).toEqual([
    [[""], [""]],
    [["c"], ["d"]],
  ]);
  e.getEditorState().read(() => {
    expect($getRoot().getChildrenSize()).toBe(1);
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) throw new Error("Expected a caret");
    expect(selection.anchor.getNode().getTextContent()).toBe("d");
    expect(selection.anchor.offset).toBe(1);
  });
});

test("a divider typed under a table makes its last row the header, with the caret at the table's end", async () => {
  const e = editor();
  registerMarkdownShortcuts(e, CORE_TRANSFORMERS);
  e.update(
    () => {
      const paragraph = $createParagraphNode();
      const table = $createDocumentTable(2, 2);
      $getRoot().append(
        table,
        paragraph,
        $createParagraphNode().append($createTextNode("after")),
      );
      table
        .getLastChildOrThrow<TableRowNode>()
        .getLastChildOrThrow<TableCellNode>()
        .getFirstChildOrThrow<ParagraphNode>()
        .append($createTextNode("d"));
      paragraph.append($createTextNode("|:---|---:|"));
      paragraph.selectEnd();
    },
    { discrete: true },
  );
  e.update(
    () => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) throw new Error("Expected a caret");
      selection.insertText(" ");
    },
    { discrete: true },
  );
  // The shortcut runs in an update the update listener queues.
  await new Promise((resolve) => setTimeout(resolve, 0));

  e.getEditorState().read(() => {
    expect(
      $table()
        .getChildren<TableRowNode>()
        .map((row) =>
          row
            .getChildren<TableCellNode>()
            .map((cell) => [cell.getHeaderStyles(), cell.getFormatType()]),
        ),
    ).toEqual([
      [
        [1, ""],
        [1, ""],
      ],
      [
        [1, "left"],
        [1, "right"],
      ],
    ]);
    expect($getRoot().getChildrenSize()).toBe(2);
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) throw new Error("Expected a caret");
    expect(selection.anchor.getNode().getTextContent()).toBe("d");
    expect(selection.anchor.offset).toBe(1);
  });
});

/** `md` imported, then exported again. */
function roundTrip(md: string) {
  const e = editor();
  e.update(() => $convertFromMarkdownString(md, CORE_TRANSFORMERS), {
    discrete: true,
  });
  return e
    .getEditorState()
    .read(() => $convertToMarkdownString(CORE_TRANSFORMERS));
}

test("a cell of several blocks writes GFM line breaks and reads them back", () => {
  const e = editor();
  e.update(
    () => {
      const table = $createDocumentTable(2, 2);
      $getRoot().append(table);
      const [header, body] = table.getChildren<TableRowNode>();
      header?.getChildren<TableCellNode>().forEach((cell, index) => {
        cell
          .getFirstChildOrThrow<ParagraphNode>()
          .append($createTextNode(["Notes", "Steps"][index] ?? ""));
      });
      const [notes, steps] = body?.getChildren<TableCellNode>() ?? [];
      notes
        ?.clear()
        .append(
          $createParagraphNode().append($createTextNode("First.")),
          $createParagraphNode().append($createTextNode("Second.")),
        );
      steps?.clear();
      if (steps)
        $convertFromMarkdownString(
          "- [x] one\n- [ ] two",
          CORE_TRANSFORMERS,
          steps,
        );
    },
    { discrete: true },
  );
  const md =
    "| Notes | Steps |\n| --- | --- |\n| First.<br><br>Second. | - [x] one<br>- [ ] two |";
  expect(
    e.getEditorState().read(() => $convertToMarkdownString(CORE_TRANSFORMERS)),
  ).toBe(md);
  expect(roundTrip(md)).toBe(md);
});

test("a backslash and n in a cell stay text through a round trip", () => {
  const md = '| Call | Path |\n| --- | --- |\n| `printf("a\\n")` | C:\\\\new |';
  expect(roundTrip(md)).toBe(md);
});

test("merged cells write a rectangular grid, the content in the first place each covers", () => {
  const e = editor();
  e.update(
    () => {
      const table = $createDocumentTable(3, 3);
      $getRoot().append(table);
      const text = [
        ["Merged across two", "", "C"],
        ["Tall", "Red", "Blue"],
        ["", "Green", "Long"],
      ];
      table.getChildren<TableRowNode>().forEach((row, r) => {
        row.getChildren<TableCellNode>().forEach((cell, c) => {
          cell
            .getFirstChildOrThrow<ParagraphNode>()
            .append($createTextNode(text[r]?.[c] || "x"));
        });
      });
      $cell(0, 0).setColSpan(2);
      $cell(0, 1).remove();
      $cell(1, 0).setRowSpan(2);
      $cell(2, 0).remove();
    },
    { discrete: true },
  );
  const md =
    "| Merged across two |  | C |\n| --- | --- | --- |\n| Tall | Red | Blue |\n|  | Green | Long |";
  expect(
    e.getEditorState().read(() => $convertToMarkdownString(CORE_TRANSFORMERS)),
  ).toBe(md);
  expect(roundTrip(md)).toBe(md);
});
