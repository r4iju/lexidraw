import LexicalFuzz
import LexicalSwift
import Testing

/// CollapsiblePlugin's toggles: a title that is one paragraph or heading,
/// and content that folds away under it.
@Suite struct ToggleTests {
  private func toggle(_ title: JSONValue, _ content: [JSONValue], open: Bool) -> JSONValue {
    LexicalJSON.element(
      "collapsible-container",
      [LexicalJSON.element("collapsible-title", [title]), LexicalJSON.element("collapsible-content", content)],
      ["open": .bool(open)])
  }
  private func agrees(_ start: JSONValue, _ commands: [EditorCommand]) throws -> Fixture {
    let fixture = try Fixture.record(start: start, commands: commands, on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
    return fixture
  }
  private func node(_ fixture: Fixture, _ path: [Int]) -> JSONValue? {
    path.reduce(fixture.expected.state["root"]) { $0?["children"]?.arrayValue?[safe: $1] }
  }

  @Test func enterAtTheEndOfATitleOpensTheToggleOntoItsFirstLine() throws {
    let fixture = try agrees(
      document(toggle(paragraph(text("Title")), [paragraph()], open: false)),
      [.caret(.text([0, 0, 0, 0], 5)), .insertParagraph, .insertText("x")])
    #expect(node(fixture, [0])?["open"] == true)
    #expect(node(fixture, [0, 1, 0, 0])?["text"] == "x")
  }

  @Test func enterOnAClosedToggleThatHoldsSomethingStartsTheNextOfItsLevel() throws {
    let fixture = try agrees(
      document(toggle(heading("h2", text("Title")), [paragraph(text("body"))], open: false)),
      [.caret(.text([0, 0, 0, 0], 5)), .insertParagraph, .insertText("Next")])
    #expect(node(fixture, [1])?["type"] == "collapsible-container")
    #expect(node(fixture, [1, 0, 0])?["tag"] == "h2")
  }

  @Test func enterAtTheStartOfATitleOpensALineAboveTheToggle() throws {
    let fixture = try agrees(
      document(toggle(paragraph(text("Title")), [paragraph(text("body"))], open: true)),
      [.caret(.text([0, 0, 0, 0], 0)), .insertParagraph])
    #expect(node(fixture, [0])?["type"] == "paragraph")
  }

  @Test func backspaceAtTheStartOfATitleTurnsTheToggleBackIntoItsBlocks() throws {
    let fixture = try agrees(
      document(toggle(heading("h3", text("Title")), [paragraph(text("body"))], open: false)),
      [.caret(.text([0, 0, 0, 0], 0)), .deleteCharacter(backward: true), .undo, .redo])
    #expect(node(fixture, [0])?["tag"] == "h3")
    #expect(node(fixture, [1, 0])?["text"] == "body")
  }

  @Test func deletingIntoFoldedContentOpensTheToggleInstead() throws {
    let fixture = try agrees(
      document(paragraph(text("before")), toggle(paragraph(text("Title")), [paragraph(text("hidden"))], open: false)),
      [.setSelection(anchor: .text([0, 0], 2), focus: .text([1, 1, 0, 0], 3)), .deleteCharacter(backward: true)])
    #expect(node(fixture, [1])?["open"] == true)
    #expect(node(fixture, [1, 1, 0, 0])?["text"] == "hidden")
  }

  @Test func aTitleStoredAsTextBecomesAParagraphOnTheFirstEdit() throws {
    let start = document(
      LexicalJSON.element(
        "collapsible-container",
        [
          LexicalJSON.element("collapsible-title", [text("Title")]),
          LexicalJSON.element("collapsible-content", []),
        ], ["open": false]))
    let fixture = try agrees(start, [.caret(.text([0, 0, 0], 1)), .insertText("x")])
    #expect(node(fixture, [0, 0, 0])?["type"] == "paragraph")
    #expect(node(fixture, [0, 1, 0])?["type"] == "paragraph")
  }

  @Test func arrowDownAtTheEndOfTheLastToggleLeavesALineAfterIt() throws {
    let end = Point.text([0, 1, 0, 0], 4)
    let fixture = try agrees(
      document(toggle(paragraph(text("Title")), [paragraph(text("body"))], open: true)),
      [.caret(end), .arrow(.down, extend: false, native: end, atCellEdge: false)])
    #expect(node(fixture, [1])?["type"] == "paragraph")
  }

  @Test func arrowUpAtTheStartOfTheFirstTogglesTitleLeavesALineBeforeIt() throws {
    let fixture = try agrees(
      document(toggle(paragraph(text("Title")), [paragraph(text("body"))], open: false)),
      [
        .caret(.text([0, 0, 0, 0], 0)),
        .arrow(.up, extend: false, native: Point(path: [0], offset: 0, type: .element), atCellEdge: false),
      ])
    #expect(node(fixture, [0])?["type"] == "paragraph")
  }
}

extension Array {
  fileprivate subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
