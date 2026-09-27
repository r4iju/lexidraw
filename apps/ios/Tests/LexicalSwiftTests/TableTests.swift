import LexicalFuzz
import LexicalSwift
import Testing

/// Tables as the web edits them: each script runs on the reference, which
/// says what Lexical does, and LexicalSwift has to agree with it.
@Suite struct TableTests {
  /// The script's fixture as the reference records it, once LexicalSwift
  /// has been checked against it.
  private func agreed(_ start: JSONValue, _ commands: [EditorCommand]) throws -> Fixture {
    let fixture = try Fixture.record(start: start, commands: commands, on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
    return fixture
  }

  private func types(_ snapshot: Snapshot) -> [String] {
    snapshot.state["root"]?["children"]?.arrayValue?.compactMap { $0["type"]?.stringValue } ?? []
  }

  private func cellTexts(_ snapshot: Snapshot, table: Int) -> [[String]] {
    let rows = node(snapshot, [table])?["children"]?.arrayValue ?? []
    return rows.map { row in
      (row["children"]?.arrayValue ?? []).map { cell in
        (cell["children"]?.arrayValue ?? []).flatMap { block in
          (block["children"]?.arrayValue ?? []).compactMap { $0["text"]?.stringValue }
        }.joined()
      }
    }
  }

  private func node(_ snapshot: Snapshot, _ path: [Int]) -> JSONValue? {
    path.reduce(snapshot.state["root"]) { node, index in
      node?["children"]?.arrayValue.flatMap { $0.indices.contains(index) ? $0[index] : nil }
    }
  }

  private let grid = document(paragraph(text("before")), LexicalJSON.table([["a", "b"], ["c", "d"]]), paragraph(text("after")))

  private func cell(_ row: Int, _ column: Int, _ offset: Int) -> Point {
    .text([1, row, column, 0, 0], offset)
  }

  @Test func insertsATableAfterTheCaretsBlockWithTheCaretInItsFirstCell() throws {
    let fixture = try agreed(
      document(paragraph(text("ab"))), [.caret(.text([0, 0], 2)), .insertTable(rows: 2, columns: 3), .insertText("x")])

    #expect(types(fixture.expected) == ["paragraph", "table", "paragraph"])
    #expect(cellTexts(fixture.expected, table: 1) == [["x", "", ""], ["", "", ""]])
    #expect(node(fixture.expected, [1, 0, 0])?["headerState"] == 1)
    #expect(fixture.expected.selection?.anchor == .text([1, 0, 0, 0, 0], 1))
  }

  @Test func tabMovesToTheEndOfTheNextCellAndOutOfTheTable() throws {
    let forward = try agreed(grid, [.caret(cell(0, 0, 0)), .tab(backward: false), .insertText("1")])
    #expect(cellTexts(forward.expected, table: 1) == [["a", "b1"], ["c", "d"]])

    let wrapping = try agreed(grid, [.caret(cell(0, 1, 0)), .tab(backward: false), .insertText("2")])
    #expect(cellTexts(wrapping.expected, table: 1) == [["a", "b"], ["c2", "d"]])

    let out = try agreed(grid, [.caret(cell(1, 1, 1)), .tab(backward: false), .insertText("3")])
    #expect(out.expected.selection?.anchor.path.first == 2)

    let back = try agreed(grid, [.caret(cell(0, 0, 1)), .tab(backward: true), .insertText("4")])
    #expect(back.expected.selection?.anchor.path.first == 0)
  }

  @Test func tabOutsideACellIsRefused() throws {
    let fixture = try agreed(grid, [.caret(.text([0, 0], 1)), .tab(backward: false)])

    #expect(fixture.changes == [.applied(ChangeSet()), .refused(.unsupported)])
  }

  @Test func aRangeFromCellToCellBecomesATableSelection() throws {
    let fixture = try agreed(grid, [.setSelection(anchor: cell(0, 0, 1), focus: cell(1, 1, 0))])

    #expect(
      fixture.expected.selection
        == .table(table: [1], anchor: [1, 0, 0], focus: [1, 1, 1], cells: [[1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]]))
    #expect(fixture.expected.selection?.isCollapsed == false)
  }

  /// A merged cell across the rectangle's edge takes in what it spans.
  @Test func aTableSelectionHasTheCellsItsRectangleGrowsTo() throws {
    func cell(_ text: String, colSpan: Int = 1) -> JSONValue {
      LexicalJSON.element(
        "tablecell", [LexicalJSON.paragraph([LexicalJSON.text(text)])],
        ["backgroundColor": nil, "colSpan": .number(Double(colSpan)), "headerState": 0, "rowSpan": 1])
    }
    let merged = document(
      LexicalJSON.element(
        "table",
        [LexicalJSON.element("tablerow", [cell("wide", colSpan: 2)]), LexicalJSON.element("tablerow", [cell("a"), cell("b")])]))

    let fixture = try agreed(merged, [.setSelection(anchor: .text([0, 1, 0, 0, 0], 0), focus: .text([0, 0, 0, 0, 0], 1))])

    #expect(
      fixture.expected.selection
        == .table(table: [0], anchor: [0, 1, 0], focus: [0, 0, 0], cells: [[0, 0, 0], [0, 1, 0], [0, 1, 1]]))
  }

  @Test func aRangeReachingIntoATableTakesInTheWholeTable() throws {
    let forward = try agreed(grid, [.setSelection(anchor: .text([0, 0], 2), focus: cell(0, 0, 1))])
    #expect(forward.expected.selection?.focus == Point(path: [1, 1, 1], offset: 1, type: .element))

    let backward = try agreed(grid, [.setSelection(anchor: .text([2, 0], 2), focus: cell(1, 1, 0))])
    #expect(backward.expected.selection?.focus == Point(path: [1, 0, 0], offset: 0, type: .element))

    let outward = try agreed(grid, [.setSelection(anchor: cell(0, 1, 1), focus: .text([2, 0], 3))])
    #expect(outward.expected.selection?.anchor == Point(path: [1, 0, 0], offset: 0, type: .element))
  }

  @Test func deletingATableSelectionEmptiesItsCells() throws {
    for delete in [EditorCommand.deleteCharacter(backward: true), .deleteWord(backward: false)] {
      let fixture = try agreed(grid, [.setSelection(anchor: cell(0, 1, 0), focus: cell(1, 1, 1)), delete])
      #expect(cellTexts(fixture.expected, table: 1) == [["a", ""], ["c", ""]])
      #expect(fixture.expected.selection == nil)
    }
  }

  @Test func deletingEveryCellDeletesTheTable() throws {
    let fixture = try agreed(
      grid, [.setSelection(anchor: cell(0, 0, 0), focus: cell(1, 1, 1)), .deleteCharacter(backward: true)])

    #expect(types(fixture.expected) == ["paragraph", "paragraph"])

    let alone = try agreed(
      document(LexicalJSON.table([["a", "b"]])),
      [.setSelection(anchor: .text([0, 0, 0, 0, 0], 0), focus: .text([0, 0, 1, 0, 0], 1)), .deleteLine(
        backward: true, lineBoundary: .text([0, 0, 1, 0, 0], 0))])
    #expect(types(alone.expected) == ["paragraph"])
  }

  @Test func backspaceOverARangeIntoATableTakesTheTable() throws {
    let fixture = try agreed(
      grid, [.setSelection(anchor: .text([2, 0], 2), focus: cell(1, 0, 1)), .deleteCharacter(backward: true)])

    #expect(types(fixture.expected) == ["paragraph"])
    #expect(node(fixture.expected, [0, 0])?["text"] == "beforeter")
  }

  @Test func typingOverATableSelectionClearsTheSelection() throws {
    let fixture = try agreed(
      grid, [.setSelection(anchor: cell(0, 0, 0), focus: cell(0, 1, 0)), .insertText("x"), .insertText("y")])

    #expect(fixture.expected.selection == nil)
    #expect(fixture.changes.last == .refused(.noSelection))
    #expect(cellTexts(fixture.expected, table: 1) == [["a", "b"], ["c", "d"]])
  }

  @Test func formattingATableSelectionFormatsEveryCell() throws {
    let fixture = try agreed(
      grid, [.setSelection(anchor: cell(0, 0, 0), focus: cell(1, 0, 0)), .formatText(.bold), .formatText(.bold)])
    #expect(tablePath(fixture.expected.selection) == [1])

    let once = try agreed(grid, [.setSelection(anchor: cell(0, 0, 0), focus: cell(1, 0, 0)), .formatText(.italic)])
    #expect(node(once.expected, [1, 1, 0, 0, 0])?["format"] == 2)
    #expect(node(once.expected, [1, 1, 1, 0, 0])?["format"] == 0)
  }

  @Test func aBlockTypeOverATableSelectionSetsEveryBlockInItsCells() throws {
    let fixture = try agreed(
      grid, [.setSelection(anchor: cell(0, 0, 0), focus: cell(1, 0, 0)), .setBlockType(.h1), .setBlockType(.quote)])

    #expect(node(fixture.expected, [1, 0, 0, 0])?["type"] == "quote")
    #expect(node(fixture.expected, [1, 1, 0, 0])?["type"] == "quote")
    #expect(node(fixture.expected, [1, 1, 1, 0])?["type"] == "paragraph")
  }

  @Test func enterOverATableSelectionDoesNothing() throws {
    let fixture = try agreed(
      grid, [.setSelection(anchor: cell(0, 0, 0), focus: cell(0, 1, 0)), .insertParagraph, .insertLineBreak])

    #expect(fixture.changes.dropFirst() == [.applied(ChangeSet()), .applied(ChangeSet())])
  }

  @Test func insertsAndDeletesRowsAndColumns() throws {
    let rows = try agreed(
      grid, [.caret(cell(0, 1, 1)), .insertTableRow(after: true), .insertTableRow(after: false), .insertText("r")])
    #expect(cellTexts(rows.expected, table: 1) == [["", ""], ["a", "br"], ["", ""], ["c", "d"]])

    let columns = try agreed(
      grid, [.caret(cell(1, 0, 1)), .insertTableColumn(after: true), .insertText("k"), .insertTableColumn(after: false)])
    #expect(cellTexts(columns.expected, table: 1) == [["a", "", "k", "b"], ["c", "", "", "d"]])

    let spanned = try agreed(
      grid, [.setSelection(anchor: cell(0, 0, 0), focus: cell(1, 1, 0)), .insertTableColumn(after: false)])
    #expect(cellTexts(spanned.expected, table: 1) == [["", "", "a", "b"], ["", "", "c", "d"]])

    let deleted = try agreed(
      grid, [.caret(cell(0, 1, 0)), .deleteTableRow, .insertText("x"), .deleteTableColumn, .insertText("y")])
    #expect(cellTexts(deleted.expected, table: 1) == [["yd"]])

    let gone = try agreed(grid, [.caret(cell(0, 1, 0)), .deleteTableColumn, .deleteTableColumn])
    #expect(types(gone.expected) == ["paragraph", "paragraph"])
  }

  /// A table's widths are as many as its columns once loaded, which is
  /// what lets a column insert always copy a width beside it.
  @Test func loadingGivesATableAWidthForEachColumn() throws {
    func widths(_ stored: JSONValue) throws -> JSONValue? {
      guard case .object(var table) = LexicalJSON.table([["a", "b", "c"]]) else { return nil }
      table["colWidths"] = stored
      let fixture = try agreed(document(.object(table)), [.caret(.text([0, 0, 0, 0, 0], 0))])
      return node(fixture.expected, [0])?["colWidths"]
    }

    #expect(try widths([80]) == [80, 80, 80])
    #expect(try widths([80, 90, 100, 110]) == [80, 90, 100])
    #expect(try widths([80, nil, 90]) == [80, 0, 90])
  }

  @Test func tableCommandsOutsideATableAreRefused() throws {
    let fixture = try agreed(
      grid, [.caret(.text([0, 0], 1)), .insertTableRow(after: true), .deleteTableColumn, .insertTable(rows: 1, columns: 1)])

    #expect(fixture.changes.dropFirst().prefix(2) == [.refused(.invalidState), .refused(.invalidState)])
  }

  @Test func noTableGoesInsideATable() throws {
    let fixture = try agreed(grid, [.caret(cell(0, 0, 1)), .insertTable(rows: 1, columns: 1)])

    #expect(types(fixture.expected) == ["paragraph", "table", "paragraph"])

    let overCells = try agreed(
      grid, [.setSelection(anchor: cell(0, 0, 0), focus: cell(1, 1, 0)), .insertTable(rows: 1, columns: 1)])
    #expect(overCells.changes.last == .applied(ChangeSet()))
  }

  @Test func selectAllInADocumentOfOnlyATableSelectsItsCells() throws {
    let alone = try agreed(document(LexicalJSON.table([["a", "b"], ["c", "d"]])), [.caret(.text([0, 0, 0, 0, 0], 0)), .selectAll])
    #expect(tablePath(alone.expected.selection) == [0])

    let among = try agreed(grid, [.caret(cell(0, 0, 0)), .selectAll])
    #expect(tablePath(among.expected.selection) == nil)
  }

  @Test func loadingMendsATable() throws {
    let empty = LexicalJSON.element(
      "tablecell", [], ["backgroundColor": nil, "colSpan": 1, "headerState": 0, "rowSpan": 1])
    let ragged = document(
      LexicalJSON.element(
        "table",
        [
          LexicalJSON.element("tablerow", [empty]),
          LexicalJSON.table([["a", "b"]])["children"]!.arrayValue![0],
        ]))
    let fixture = try agreed(ragged, [.caret(.text([0, 1, 1, 0, 0], 1)), .insertTableRow(after: true)])

    #expect(cellTexts(fixture.expected, table: 0) == [["", ""], ["a", "b"], ["", ""]])
  }

  @Test func undoRestoresATableSelection() throws {
    let fixture = try agreed(
      grid, [.setSelection(anchor: cell(0, 0, 0), focus: cell(0, 1, 0)), .deleteCharacter(backward: true), .undo])

    #expect(tablePath(fixture.expected.selection) == [1])
    #expect(cellTexts(fixture.expected, table: 1) == [["a", "b"], ["c", "d"]])
  }

  // MARK: Arrow keys

  /// A document ending in a table, whose last cell is `d`.
  private let trailing = document(paragraph(text("before")), LexicalJSON.table([["a", "b"], ["c", "d"]]))

  private func arrow(_ key: ArrowKey, extend: Bool = false, native: Point, atCellEdge: Bool = false) -> EditorCommand {
    .arrow(key, extend: extend, native: native, atCellEdge: atCellEdge)
  }

  /// Shift and an arrow over selected cells moves the focus a whole cell,
  /// as far as the table goes.
  @Test func shiftArrowOverATableSelectionMovesItsFocusACell() throws {
    let across = EditorCommand.setSelection(anchor: cell(0, 0, 1), focus: cell(0, 1, 0))
    let down = try agreed(grid, [across, arrow(.down, extend: true, native: cell(1, 1, 0))])
    #expect(
      down.expected.selection
        == .table(table: [1], anchor: [1, 0, 0], focus: [1, 1, 1], cells: [[1, 0, 0], [1, 0, 1], [1, 1, 0], [1, 1, 1]]))

    let back = try agreed(
      grid, [across, arrow(.down, extend: true, native: cell(1, 1, 0)), arrow(.left, extend: true, native: cell(1, 1, 0))])
    #expect(back.expected.selection == .table(table: [1], anchor: [1, 0, 0], focus: [1, 1, 0], cells: [[1, 0, 0], [1, 1, 0]]))

    let shrunk = try agreed(grid, [across, arrow(.left, extend: true, native: cell(0, 1, 0))])
    #expect(shrunk.expected.selection == .table(table: [1], anchor: [1, 0, 0], focus: [1, 0, 0], cells: [[1, 0, 0]]))

    let past = try agreed(grid, [across, arrow(.right, extend: true, native: cell(0, 1, 1))])
    #expect(past.expected.selection == .table(table: [1], anchor: [1, 0, 0], focus: [1, 0, 1], cells: [[1, 0, 0], [1, 0, 1]]))
    #expect(past.changes.last == .applied(ChangeSet()))
  }

  /// An arrow without Shift over selected cells leaves a caret at the end
  /// of the focus cell.
  @Test func anArrowOverATableSelectionLeavesACaretInItsFocus() throws {
    let fixture = try agreed(
      grid, [.setSelection(anchor: cell(0, 0, 1), focus: cell(1, 1, 0)), arrow(.up, native: cell(0, 0, 0))])

    #expect(fixture.expected.selection?.anchor == cell(1, 1, 1))
    #expect(fixture.expected.selection?.isCollapsed == true)
  }

  /// Left and right cross into the cell beside; up and down at the cell's
  /// edge go to the cell above or below.
  @Test func arrowsMoveBetweenCells() throws {
    let right = try agreed(grid, [.caret(cell(0, 0, 1)), arrow(.right, native: cell(0, 0, 1))])
    #expect(right.expected.selection?.anchor == cell(0, 1, 0))

    let left = try agreed(grid, [.caret(cell(0, 1, 0)), arrow(.left, native: cell(0, 1, 0))])
    #expect(left.expected.selection?.anchor == cell(0, 0, 1))

    let up = try agreed(grid, [.caret(cell(1, 0, 0)), arrow(.up, native: cell(1, 0, 0), atCellEdge: true)])
    #expect(up.expected.selection?.anchor == cell(0, 0, 1))

    let down = try agreed(grid, [.caret(cell(0, 1, 1)), arrow(.down, native: cell(0, 1, 1), atCellEdge: true)])
    #expect(down.expected.selection?.anchor == cell(1, 1, 0))

    let shifted = try agreed(grid, [.caret(cell(0, 0, 1)), arrow(.right, extend: true, native: cell(0, 0, 1))])
    #expect(shifted.expected.selection == .table(table: [1], anchor: [1, 0, 0], focus: [1, 0, 1], cells: [[1, 0, 0], [1, 0, 1]]))
  }

  /// Arrows past a table's last cell leave it, beside the table where it
  /// ends the document, and typing there starts a paragraph.
  @Test func arrowsLeaveATableAtTheEndOfTheDocument() throws {
    let beside = Point(path: [], offset: 2, type: .element)
    let down = try agreed(
      trailing, [.caret(cell(1, 0, 1)), arrow(.down, native: cell(1, 0, 1), atCellEdge: true), .insertText("x")])
    #expect(types(down.expected) == ["paragraph", "table", "paragraph"])
    #expect(node(down.expected, [2, 0])?["text"] == "x")

    let right = try agreed(trailing, [.caret(cell(1, 1, 1)), arrow(.right, native: cell(1, 1, 1))])
    #expect(right.expected.selection?.anchor == beside)

    let into = try agreed(trailing, [.caret(beside), arrow(.left, native: beside)])
    #expect(into.expected.selection?.anchor == cell(1, 1, 1))

    let stays = try agreed(trailing, [.caret(beside), arrow(.down, native: beside)])
    #expect(stays.expected.selection?.anchor == beside)
  }

  /// Shift and an arrow from beside a table, a step Lexical leaves the
  /// platform to measure, reads back where the platform moved.
  @Test func aStepLexicalLeavesToThePlatformIsReadBack() throws {
    let beside = Point(path: [], offset: 2, type: .element)
    let fixture = try agreed(trailing, [.caret(beside), arrow(.left, extend: true, native: cell(1, 1, 1))])

    #expect(!fixture.changes.contains { if case .refused = $0 { true } else { false } })
    #expect(fixture.expected.selection?.focus == cell(1, 1, 1))
  }

  /// Left from the start of the block after a table goes to the end of its
  /// last cell, and with Shift takes in the table.
  @Test func leftFromAfterATableEntersIt() throws {
    let into = try agreed(grid, [.caret(.text([2, 0], 0)), arrow(.left, native: .text([1, 1, 1, 0, 0], 1))])
    #expect(into.expected.selection?.anchor == cell(1, 1, 1))

    let over = try agreed(grid, [.caret(.text([2, 0], 0)), arrow(.left, extend: true, native: .text([1, 1, 1, 0, 0], 1))])
    #expect(over.expected.selection?.focus == Point(path: [], offset: 1, type: .element))
  }

  /// Shift-Down from the block above a table takes in the whole table.
  @Test func shiftDownIntoATableTakesItIn() throws {
    let fixture = try agreed(grid, [.caret(.text([0, 0], 3)), arrow(.down, extend: true, native: cell(0, 0, 1))])

    #expect(fixture.expected.selection?.focus == Point(path: [1, 1, 1], offset: 1, type: .element))
  }

  /// Down into a table from above lands in its first cell, wherever the
  /// platform put the caret, as a table that scrolls sideways has it.
  @Test func downIntoATableLandsInItsFirstCell() throws {
    let fixture = try agreed(grid, [.caret(.text([0, 0], 6)), arrow(.down, native: cell(0, 1, 1))])

    #expect(fixture.expected.selection?.anchor == cell(0, 0, 0))
  }

  /// What no handler takes goes where the platform moves it.
  @Test func anArrowNothingTakesMovesAsThePlatformDoes() throws {
    let caret = try agreed(grid, [.caret(.text([0, 0], 2)), arrow(.right, native: .text([0, 0], 3))])
    #expect(caret.expected.selection?.anchor == .text([0, 0], 3))

    let range = try agreed(grid, [.caret(.text([0, 0], 2)), arrow(.right, extend: true, native: .text([0, 0], 3))])
    #expect(range.expected.selection?.anchor == .text([0, 0], 2))
    #expect(range.expected.selection?.focus == .text([0, 0], 3))

    let inCell = try agreed(grid, [.caret(cell(0, 0, 0)), arrow(.down, native: cell(0, 0, 1))])
    #expect(inCell.expected.selection?.anchor == cell(0, 0, 1))
  }

  private func tablePath(_ selection: Selection?) -> [Int]? {
    if case .table(let table, _, _, _) = selection { table } else { nil }
  }
}
