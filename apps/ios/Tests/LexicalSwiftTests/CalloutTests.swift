import LexicalFuzz
import LexicalSwift
import Testing

/// CalloutPlugin's callouts: blocks of ordinary text under a kind and title,
/// whose edges Backspace and Delete join across as between paragraphs.
@Suite struct CalloutTests {
  private func callout(_ kind: String, _ title: String, _ children: JSONValue...) -> JSONValue {
    LexicalJSON.element("callout", children, ["kind": .string(kind), "title": .string(title)])
  }
  /// A line, a tip of two lines, and a line.
  private var around: JSONValue {
    document(
      paragraph(text("Before")), callout("tip", "Handy", paragraph(text("First")), paragraph(text("Second"))),
      paragraph(text("After")))
  }
  private func agrees(_ start: JSONValue, _ commands: [EditorCommand]) throws -> Fixture {
    let fixture = try Fixture.record(start: start, commands: commands, on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
    return fixture
  }
  private func node(_ fixture: Fixture, _ path: [Int]) -> JSONValue? {
    path.reduce(fixture.expected.state["root"]) { $0?["children"]?.arrayValue?[safe: $1] }
  }
  /// The text of each block under `path`, a callout's lines run together.
  private func lines(_ fixture: Fixture, _ path: [Int] = []) -> [String] {
    func text(_ node: JSONValue) -> String {
      node["text"]?.stringValue ?? node["children"]?.arrayValue?.map(text).joined() ?? ""
    }
    return (path.isEmpty ? fixture.expected.state["root"] : node(fixture, path))?["children"]?.arrayValue?.map(text)
      ?? []
  }

  @Test func backspaceAtTheStartOfACalloutTurnsItBackIntoItsBlocks() throws {
    let fixture = try agrees(
      around, [.caret(.text([1, 0, 0], 0)), .deleteCharacter(backward: true), .insertText("X"), .undo, .redo])
    #expect(lines(fixture) == ["Before", "XFirst", "Second", "After"])
    #expect(node(fixture, [1])?["type"] == "paragraph")
  }

  @Test func backspaceAtTheStartOfALineAfterACalloutJoinsItOntoTheCalloutsLast() throws {
    let fixture = try agrees(around, [.caret(.text([2, 0], 0)), .deleteCharacter(backward: true), .insertText("X")])
    #expect(lines(fixture) == ["Before", "FirstSecondXAfter"])
    #expect(lines(fixture, [1]) == ["First", "SecondXAfter"])
  }

  @Test func deleteAtTheEndOfALineBeforeACalloutPullsItsFirstLineUp() throws {
    let fixture = try agrees(around, [.caret(.text([0, 0], 6)), .deleteCharacter(backward: false), .insertText("X")])
    #expect(lines(fixture) == ["BeforeXFirst", "Second", "After"])
    #expect(lines(fixture, [1]) == ["Second"])
  }

  @Test func deleteBeforeACalloutOfOneLineTakesTheCalloutAway() throws {
    let fixture = try agrees(
      document(paragraph(text("Before")), callout("note", "", paragraph(text("Only"))), paragraph(text("After"))),
      [.caret(.text([0, 0], 6)), .deleteCharacter(backward: false), .insertText("X")])
    #expect(lines(fixture) == ["BeforeXOnly", "After"])
    #expect(node(fixture, [1])?["type"] == "paragraph")
  }

  @Test func deleteAtTheEndOfACalloutPullsTheNextLineIn() throws {
    let fixture = try agrees(around, [.caret(.text([1, 1, 0], 6)), .deleteCharacter(backward: false), .insertText("X")])
    #expect(lines(fixture, [1]) == ["First", "SecondXAfter"])
    #expect(fixture.expected.state["root"]?["children"]?.arrayValue?.count == 2)
  }

  @Test func deletingASelectionIntoACalloutJoinsWhatIsLeft() throws {
    let fixture = try agrees(
      around,
      [.setSelection(anchor: .text([0, 0], 3), focus: .text([1, 0, 0], 2)), .deleteCharacter(backward: true), .insertText("X")])
    #expect(lines(fixture) == ["BefXrst", "Second", "After"])
    #expect(lines(fixture, [1]) == ["Second"])
  }

  @Test func deletingASelectionOutOfACalloutJoinsWhatIsLeft() throws {
    let fixture = try agrees(
      around,
      [.setSelection(anchor: .text([1, 1, 0], 3), focus: .text([2, 0], 2)), .deleteCharacter(backward: true), .insertText("X")])
    #expect(lines(fixture, [1]) == ["First", "SecXter"])
    #expect(fixture.expected.state["root"]?["children"]?.arrayValue?.count == 2)
  }

  @Test func typingOverASelectionOutOfACalloutJoinsWhatIsLeft() throws {
    let fixture = try agrees(
      around, [.setSelection(anchor: .text([1, 0, 0], 2), focus: .text([2, 0], 2)), .insertText("X")])
    #expect(lines(fixture, [1]) == ["FiXter"])
    #expect(fixture.expected.state["root"]?["children"]?.arrayValue?.count == 2)
  }

  @Test func cuttingASelectionThatEmptiesACalloutJoinsWhatIsLeft() throws {
    let fixture = try agrees(
      around, [.setSelection(anchor: .text([0, 0], 3), focus: .text([1, 1, 0], 2)), .cut, .insertText("X")])
    #expect(lines(fixture) == ["BefXcond", "After"])
    #expect(node(fixture, [0])?["type"] == "paragraph")
  }

  @Test func typingAKindAtTheStartOfAQuoteMakesItACallout() throws {
    let fixture = try agrees(
      document(quote(text("Hello"))), [.caret(.text([0, 0], 0))] + MarkdownShortcutTests.typing("[!tip] "))
    #expect(node(fixture, [0])?["type"] == "callout")
    #expect(node(fixture, [0])?["kind"] == "tip")
    #expect(lines(fixture, [0]) == ["Hello"])
  }

  @Test func typingAnAliasAtTheStartOfAQuoteReadsItAsImportDoes() throws {
    let fixture = try agrees(
      document(quote()),
      [.caret(Point(path: [0], offset: 0, type: .element))] + MarkdownShortcutTests.typing("[!danger] Hi"))
    #expect(node(fixture, [0])?["kind"] == "caution")
    #expect(node(fixture, [0])?["title"] == "Danger")
    #expect(lines(fixture, [0]) == ["Hi"])
  }

  @Test func typingAKindInAParagraphLeavesItAsTyped() throws {
    let fixture = try agrees(
      MarkdownShortcutTests.emptyParagraph,
      [MarkdownShortcutTests.caretInEmptyParagraph] + MarkdownShortcutTests.typing("[!tip] "))
    #expect(node(fixture, [0])?["type"] == "paragraph")
    #expect(lines(fixture) == ["[!tip] "])
  }

  @Test func typingAnAdmonitionMakesACallout() throws {
    let fixture = try agrees(
      MarkdownShortcutTests.emptyParagraph,
      [MarkdownShortcutTests.caretInEmptyParagraph] + MarkdownShortcutTests.typing(":::warning Hi"))
    #expect(node(fixture, [0])?["kind"] == "warning")
    #expect(node(fixture, [0])?["title"] == "")
    #expect(lines(fixture, [0]) == ["Hi"])
  }

  @Test func typingAnAdmonitionWithATitleMakesATitledCallout() throws {
    let fixture = try agrees(
      MarkdownShortcutTests.emptyParagraph,
      [MarkdownShortcutTests.caretInEmptyParagraph] + MarkdownShortcutTests.typing(":::tip[Mind] "))
    #expect(node(fixture, [0])?["kind"] == "tip")
    #expect(node(fixture, [0])?["title"] == "Mind")
  }

  @Test func enterFinishesAnAdmonition() throws {
    let fixture = try agrees(
      MarkdownShortcutTests.emptyParagraph,
      [MarkdownShortcutTests.caretInEmptyParagraph, .insertText(":::danger"), .insertParagraph, .insertText("Hi")])
    #expect(node(fixture, [0])?["kind"] == "caution")
    #expect(node(fixture, [0])?["title"] == "Danger")
    #expect(lines(fixture, [0]) == ["Hi"])
  }
}

extension Array {
  fileprivate subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
