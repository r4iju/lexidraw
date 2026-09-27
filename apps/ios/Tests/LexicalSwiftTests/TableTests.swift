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
        == Selection(
          anchor: Point(path: [1, 0, 0], offset: 0, type: .element),
          focus: Point(path: [1, 1, 1], offset: 0, type: .element), format: [], style: "", table: [1]))
    #expect(fixture.expected.selection?.isCollapsed == false)
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
    #expect(fixture.expected.selection?.table == [1])

    let once = try agreed(grid, [.setSelection(anchor: cell(0, 0, 0), focus: cell(1, 0, 0)), .formatText(.italic)])
    #expect(node(once.expected, [1, 1, 0, 0, 0])?["format"] == 2)
    #expect(node(once.expected, [1, 1, 1, 0, 0])?["format"] == 0)
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
    #expect(alone.expected.selection?.table == [0])

    let among = try agreed(grid, [.caret(cell(0, 0, 0)), .selectAll])
    #expect(among.expected.selection?.table == nil)
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

    #expect(fixture.expected.selection?.table == [1])
    #expect(cellTexts(fixture.expected, table: 1) == [["a", "b"], ["c", "d"]])
  }
}
