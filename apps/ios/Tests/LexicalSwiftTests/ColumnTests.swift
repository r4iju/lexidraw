import LexicalFuzz
import LexicalSwift
import Testing

/// LayoutPlugin's columns: a row of two or more columns that the keyboard
/// takes apart and leaves as Notion's do (#252).
@Suite struct ColumnTests {
  private func columns(_ template: String, _ items: [JSONValue]...) -> JSONValue {
    LexicalJSON.element(
      "layout-container", items.map { LexicalJSON.element("layout-item", $0) }, ["templateColumns": .string(template)])
  }
  private func agrees(_ start: JSONValue, _ commands: [EditorCommand]) throws -> Fixture {
    let fixture = try Fixture.record(start: start, commands: commands, on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
    return fixture
  }
  private func node(_ fixture: Fixture, _ path: [Int]) -> JSONValue? {
    path.reduce(fixture.expected.state["root"]) { $0?["children"]?.arrayValue?[safe: $1] }
  }
  private func texts(_ fixture: Fixture) -> [String] {
    (fixture.expected.state["root"]?["children"]?.arrayValue ?? []).map(outline)
  }
  /// A block as `type(children)`, text as itself, to compare whole documents.
  private func outline(_ node: JSONValue) -> String {
    if let text = node["text"]?.stringValue { return text }
    let children = (node["children"]?.arrayValue ?? []).map(outline).joined(separator: " ")
    return "\(node["type"]?.stringValue ?? "?")(\(children))"
  }

  @Test func backspaceInAnEmptyColumnRemovesItAndKeepsTheOthersWidths() throws {
    let fixture = try agrees(
      document(paragraph(text("Before")), columns("1fr 2fr 3fr", [paragraph(text("A"))], [paragraph()], [paragraph(text("C"))])),
      [.caret(Point(path: [1, 1, 0], offset: 0, type: .element)), .deleteCharacter(backward: true), .insertText("x")])
    #expect(texts(fixture) == ["paragraph(Before)", "layout-container(layout-item(paragraph(Ax)) layout-item(paragraph(C)))"])
    #expect(node(fixture, [1])?["templateColumns"] == "1fr 3fr")
  }

  @Test func aRowLeftWithOneColumnBecomesItsBlocks() throws {
    let fixture = try agrees(
      document(paragraph(text("Before")), columns("1fr 1fr", [paragraph(text("A")), paragraph(text("B"))], [paragraph()]), paragraph(text("After"))),
      [.caret(Point(path: [1, 1, 0], offset: 0, type: .element)), .deleteCharacter(backward: true), .insertText("x"), .undo, .redo])
    #expect(texts(fixture) == ["paragraph(Before)", "paragraph(A)", "paragraph(Bx)", "paragraph(After)"])
  }

  @Test func backspaceAtTheStartOfAColumnJoinsItOntoTheColumnBefore() throws {
    let fixture = try agrees(
      document(columns("1fr 2fr 3fr", [paragraph(text("A"))], [heading("h2", text("B1")), paragraph(text("B2"))], [paragraph(text("C"))])),
      [.caret(.text([0, 1, 0, 0], 0)), .deleteCharacter(backward: true), .insertText("x"), .undo, .redo])
    #expect(texts(fixture) == ["layout-container(layout-item(paragraph(A) heading(xB1) paragraph(B2)) layout-item(paragraph(C)))"])
    #expect(node(fixture, [0])?["templateColumns"] == "1fr 3fr")
  }

  @Test func backspaceAtTheStartOfTheFirstColumnTurnsTheColumnsIntoBlocks() throws {
    let fixture = try agrees(
      document(columns("1fr 1fr", [paragraph(text("A1")), paragraph(text("A2"))], [paragraph(text("B"))]), paragraph(text("After"))),
      [.caret(.text([0, 0, 0, 0], 0)), .deleteCharacter(backward: true), .insertText("x")])
    #expect(texts(fixture) == ["paragraph(xA1)", "paragraph(A2)", "paragraph(B)", "paragraph(After)"])
  }

  @Test func deleteAtTheEndOfAColumnPullsTheNextColumnIn() throws {
    let start = document(
      paragraph(text("Before")), columns("1fr 2fr 3fr", [paragraph(text("A"))], [paragraph()], [paragraph(text("C1")), paragraph(text("C2"))]))
    let removed = try agrees(start, [.caret(.text([1, 0, 0, 0], 1)), .deleteCharacter(backward: false), .insertText("x")])
    #expect(texts(removed) == ["paragraph(Before)", "layout-container(layout-item(paragraph(Ax)) layout-item(paragraph(C1) paragraph(C2)))"])
    #expect(node(removed, [1])?["templateColumns"] == "1fr 3fr")
    let pulled = try agrees(
      start, [.caret(.text([1, 0, 0, 0], 1)), .deleteCharacter(backward: false), .deleteCharacter(backward: false), .insertText("x")])
    #expect(texts(pulled) == ["paragraph(Before)", "paragraph(Ax)", "paragraph(C1)", "paragraph(C2)"])
  }

  @Test func backspaceInAnEmptyFirstColumnPutsTheCaretInTheNextColumn() throws {
    let fixture = try agrees(
      document(columns("1fr 2fr 3fr", [paragraph()], [paragraph(text("B"))], [paragraph(text("C"))])),
      [.caret(Point(path: [0, 0, 0], offset: 0, type: .element)), .deleteCharacter(backward: true), .insertText("x")])
    #expect(texts(fixture) == ["layout-container(layout-item(paragraph(xB)) layout-item(paragraph(C)))"])
    #expect(node(fixture, [0])?["templateColumns"] == "2fr 3fr")
  }

  @Test func deleteAtTheEndOfTheLastColumnKeepsTheColumns() throws {
    let fixture = try agrees(
      document(columns("1fr 1fr", [paragraph(text("A"))], [paragraph(text("B"))])),
      [.caret(.text([0, 1, 0, 0], 1)), .deleteCharacter(backward: false), .insertText("x")])
    #expect(texts(fixture) == ["layout-container(layout-item(paragraph(A)) layout-item(paragraph(Bx)))"])
  }

  @Test func aListAtTheStartOfAColumnKeepsItsOwnBackspace() throws {
    let fixture = try agrees(
      document(columns("1fr 1fr", [paragraph(text("A"))], [list(.bullet, [.item([text("L")])])])),
      [.caret(.text([0, 1, 0, 0, 0], 0)), .deleteCharacter(backward: true), .insertText("x")])
    #expect(texts(fixture) == ["layout-container(layout-item(paragraph(A)) layout-item(paragraph(xL)))"])
  }

  @Test func aLineMoveThatWouldLandInAnotherColumnLeavesTheColumns() throws {
    let start = document(paragraph(text("Before")), columns("1fr 1fr", [paragraph(text("A1")), paragraph(text("A2"))], [paragraph(text("B"))]), paragraph(text("After")))
    let down = try agrees(start, [.caret(.text([1, 0, 1, 0], 2)), .arrow(.down, extend: false, native: .text([1, 1, 0, 0], 1), atCellEdge: false), .insertText("x")])
    #expect(texts(down).last == "paragraph(xAfter)")
    let up = try agrees(start, [.caret(.text([1, 1, 0, 0], 0)), .arrow(.up, extend: false, native: .text([1, 0, 1, 0], 0), atCellEdge: false), .insertText("x")])
    #expect(texts(up).first == "paragraph(Beforex)")
    let within = try agrees(start, [.caret(.text([1, 0, 0, 0], 2)), .arrow(.down, extend: false, native: .text([1, 0, 1, 0], 2), atCellEdge: false), .insertText("x")])
    #expect(texts(within)[safe: 1] == "layout-container(layout-item(paragraph(A1) paragraph(A2x)) layout-item(paragraph(B)))")
  }

  @Test func aLineMoveOutOfColumnsAtTheDocumentsEdgeMakesALine() throws {
    let start = document(columns("1fr 1fr", [paragraph(text("A"))], [paragraph(text("B")), paragraph()]))
    let down = try agrees(start, [.caret(Point(path: [0, 1, 1], offset: 0, type: .element)), .arrow(.down, extend: false, native: Point(path: [0, 1, 1], offset: 0, type: .element), atCellEdge: false), .insertText("x")])
    #expect(texts(down) == ["layout-container(layout-item(paragraph(A)) layout-item(paragraph(B) paragraph()))", "paragraph(x)"])
    let up = try agrees(start, [.caret(.text([0, 1, 0, 0], 0)), .arrow(.up, extend: false, native: .text([0, 0, 0, 0], 0), atCellEdge: false), .insertText("x")])
    #expect(texts(up) == ["paragraph(x)", "layout-container(layout-item(paragraph(A)) layout-item(paragraph(B) paragraph()))"])
  }

  @Test func aLineMoveOutOfColumnsSelectsABlockDecoratorBesideThem() throws {
    let fixture = try agrees(
      document(LexicalJSON.horizontalRule, columns("1fr 1fr", [paragraph(text("A"))], [paragraph(text("B"))])),
      [.caret(.text([1, 1, 0, 0], 1)), .arrow(.up, extend: false, native: .text([1, 0, 0, 0], 1), atCellEdge: false), .deleteCharacter(backward: true)])
    #expect(texts(fixture) == ["layout-container(layout-item(paragraph(A)) layout-item(paragraph(B)))"])
  }

  @Test func leftAndRightAtTheOuterEdgesOfColumnsMakeALineWhereThereIsNone() throws {
    let start = document(columns("1fr 1fr", [paragraph(text("A"))], [paragraph(text("B"))]))
    let right = try agrees(start, [.caret(.text([0, 1, 0, 0], 1)), .arrow(.right, extend: false, native: .text([0, 1, 0, 0], 1), atCellEdge: false), .insertText("x")])
    #expect(texts(right) == ["layout-container(layout-item(paragraph(A)) layout-item(paragraph(B)))", "paragraph(x)"])
    let left = try agrees(start, [.caret(.text([0, 0, 0, 0], 0)), .arrow(.left, extend: false, native: .text([0, 0, 0, 0], 0), atCellEdge: false), .insertText("x")])
    #expect(texts(left) == ["paragraph(x)", "layout-container(layout-item(paragraph(A)) layout-item(paragraph(B)))"])
  }

  @Test func selectAllInAColumnSelectsTheColumnThenTheDocument() throws {
    let start = document(columns("1fr 1fr", [paragraph(text("A1")), paragraph(text("A2"))], [paragraph(text("B"))]), paragraph(text("After")))
    let once = try agrees(start, [.caret(.text([0, 0, 0, 0], 1)), .selectAll, .insertText("x")])
    #expect(texts(once) == ["layout-container(layout-item(paragraph(x)) layout-item(paragraph(B)))", "paragraph(After)"])
    let twice = try agrees(start, [.caret(.text([0, 0, 0, 0], 1)), .selectAll, .selectAll, .deleteCharacter(backward: true)])
    #expect(!texts(twice).contains("paragraph(After)"))
  }

  /// Found by the structural fuzzer: a line break is neither text nor an
  /// element, so the selection has to start beside it.
  @Test func selectAllInAColumnThatStartsWithALineBreakSelectsTheColumn() throws {
    let start = document(
      columns("1fr 1fr", [LexicalJSON.paragraph([LexicalJSON.lineBreak, text("A")])], [paragraph(text("B"))]))
    let fixture = try agrees(start, [.caret(.text([0, 0, 0, 1], 0)), .selectAll, .insertText("x")])
    #expect(texts(fixture) == ["layout-container(layout-item(paragraph(x)) layout-item(paragraph(B)))"])
  }

  @Test func columnsPastedIntoAColumnBecomeItsBlocks() throws {
    let pasted = columns("1fr 1fr", [paragraph(text("P"))], [paragraph(text("Q"))])
    let fixture = try agrees(
      document(columns("1fr 1fr", [paragraph()], [paragraph(text("B"))])),
      [.caret(Point(path: [0, 0, 0], offset: 0, type: .element)), .paste(copied("P Q", pasted)), .insertText("x")])
    #expect(texts(fixture) == ["layout-container(layout-item(paragraph(P) paragraph(Qx)) layout-item(paragraph(B)))"])
  }

  @Test func aStrayBlockInARowOfColumnsJoinsTheColumnBeforeIt() throws {
    let item = { (block: JSONValue) in LexicalJSON.element("layout-item", [block]) }
    let stray = LexicalJSON.element(
      "layout-container", [paragraph(text("S1")), item(paragraph(text("A"))), paragraph(text("S2")), item(paragraph(text("B")))],
      ["templateColumns": "1fr 2fr"])
    let fixture = try agrees(document(stray, paragraph(text("After"))), [.caret(.text([1, 0], 5)), .insertText("x")])
    #expect(texts(fixture) == ["layout-container(layout-item(paragraph(S1) paragraph(A) paragraph(S2)) layout-item(paragraph(B)))", "paragraph(Afterx)"])
    #expect(node(fixture, [0])?["templateColumns"] == "1fr 2fr")
  }

  /// The HTML import runs the nodes' own importDOM, bundled by codegen, so
  /// LexicalSwift's paste is the web's, without the reference editor.
  @Test func pastedHTMLKeepsItsColumns() throws {
    let html =
      "<div data-lexical-layout-container=\"true\" style=\"grid-template-columns: 1fr 2fr;\">"
      + "<div data-lexical-layout-item=\"true\"><p>P</p></div><div data-lexical-layout-item=\"true\"><p>Q</p></div></div>"
    let editor = Editor()
    try editor.load(document(paragraph()))
    try editor.apply(.caret(Point(path: [0], offset: 0, type: .element)))
    try editor.apply(.paste(Clipboard(plainText: "P\nQ", html: html)))
    let root = try editor.serializedState()["root"]
    #expect((root?["children"]?.arrayValue ?? []).map(outline) == ["layout-container(layout-item(paragraph(P)) layout-item(paragraph(Q)))"])
    #expect(root?["children"]?.arrayValue?.first?["templateColumns"] == "1fr 2fr")
  }
}

extension Array {
  fileprivate subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
