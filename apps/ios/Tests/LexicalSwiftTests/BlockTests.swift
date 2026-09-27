import LexicalFuzz
import LexicalSwift
import Testing

/// Headings and quotes: making blocks them, and typing, Enter and Backspace
/// in them, recorded from Lexical and replayed on LexicalSwift.
@Suite struct BlockTests {
  struct Script: CustomTestStringConvertible, Sendable {
    let name: String
    let start: JSONValue
    let commands: [EditorCommand]
    /// The blocks Lexical leaves, a heading by its tag.
    let blocks: [String]

    var testDescription: String { name }
  }

  static let setBlockType: [Script] = [
    Script(
      name: "a caret's paragraph becomes a heading", start: document(paragraph(text("ab")), paragraph(text("cd"))),
      commands: [.caret(.text([0, 0], 1)), .setBlockType(.h1)], blocks: ["h1", "paragraph"]),
    Script(
      name: "every block a range touches becomes a quote",
      start: document(paragraph(text("ab")), paragraph(text("cd")), paragraph(text("ef"))),
      commands: [.setSelection(anchor: .text([0, 0], 1), focus: .text([1, 0], 1)), .setBlockType(.quote)],
      blocks: ["quote", "quote", "paragraph"]),
    Script(
      name: "a range that ends at the start of a block leaves that block",
      start: document(paragraph(text("ab")), paragraph(text("cd"))),
      commands: [.setSelection(anchor: .text([0, 0], 0), focus: .text([1, 0], 0)), .setBlockType(.h2)],
      blocks: ["h2", "paragraph"]),
    Script(
      name: "a backward range that ends at the end of a block leaves that block",
      start: document(paragraph(text("ab")), paragraph(text("cd"))),
      commands: [.setSelection(anchor: .text([1, 0], 1), focus: .text([0, 0], 2)), .setBlockType(.h3)],
      blocks: ["paragraph", "h3"]),
    Script(
      name: "a heading becomes a paragraph", start: document(heading("h1", text("ab"))),
      commands: [.caret(.text([0, 0], 2)), .setBlockType(.paragraph)], blocks: ["paragraph"]),
    Script(
      name: "a heading becomes another heading", start: document(heading("h1", text("ab"))),
      commands: [.caret(.text([0, 0], 0)), .setBlockType(.h6)], blocks: ["h6"]),
    Script(
      name: "a quote becomes a heading of the same tag twice", start: document(quote(text("ab"))),
      commands: [.caret(.text([0, 0], 1)), .setBlockType(.h4), .setBlockType(.h4)], blocks: ["h4"]),
    Script(
      name: "an empty paragraph becomes a heading that takes what is typed", start: document(paragraph()),
      commands: [.caret(Point(path: [0], offset: 0, type: .element)), .setBlockType(.h5), .insertText("x")],
      blocks: ["h5"]),
    Script(
      name: "every block becomes a quote after selecting all",
      start: document(heading("h2", text("ab")), paragraph(text("cd"))),
      commands: [.selectAll, .setBlockType(.quote)], blocks: ["quote", "quote"]),
    Script(
      name: "undo takes a block back to what it was", start: document(paragraph(text("ab"))),
      commands: [.caret(.text([0, 0], 1)), .setBlockType(.h1), .undo], blocks: ["paragraph"]),
    Script(
      name: "a block type without a selection is refused", start: document(paragraph(text("ab"))),
      commands: [.setBlockType(.h1)], blocks: ["paragraph"]),
  ]

  static let editing: [Script] = [
    Script(
      name: "Enter at the end of a heading starts a paragraph", start: document(heading("h1", text("ab"))),
      commands: [.caret(.text([0, 0], 2)), .insertParagraph, .insertText("c")], blocks: ["h1", "paragraph"]),
    Script(
      name: "Enter inside a heading splits it into two", start: document(heading("h2", text("ab"))),
      commands: [.caret(.text([0, 0], 1)), .insertParagraph], blocks: ["h2", "h2"]),
    Script(
      name: "Enter at the start of a heading puts a paragraph before it",
      start: document(heading("h3", text("ab"))), commands: [.caret(.text([0, 0], 0)), .insertParagraph],
      blocks: ["paragraph", "h3"]),
    Script(
      name: "Enter in an empty heading starts a paragraph", start: document(heading("h1")),
      commands: [.caret(Point(path: [0], offset: 0, type: .element)), .insertParagraph], blocks: ["h1", "paragraph"]),
    Script(
      name: "Enter inside a quote starts a paragraph with the rest", start: document(quote(text("ab"))),
      commands: [.caret(.text([0, 0], 1)), .insertParagraph], blocks: ["quote", "paragraph"]),
    Script(
      name: "Backspace at the start of a heading with text does nothing", start: document(heading("h1", text("ab"))),
      commands: [.caret(.text([0, 0], 0)), .deleteCharacter(backward: true)], blocks: ["h1"]),
    Script(
      name: "Backspace in an empty heading makes it a paragraph", start: document(heading("h1")),
      commands: [.caret(Point(path: [0], offset: 0, type: .element)), .deleteCharacter(backward: true)],
      blocks: ["paragraph"]),
    Script(
      name: "Backspace at the start of a quote makes it a paragraph", start: document(quote(text("ab"))),
      commands: [.caret(.text([0, 0], 0)), .deleteCharacter(backward: true)], blocks: ["paragraph"]),
    Script(
      name: "Backspace at the start of a heading after a paragraph joins them",
      start: document(paragraph(text("ab")), heading("h1", text("cd"))),
      commands: [.caret(.text([1, 0], 0)), .deleteCharacter(backward: true)], blocks: ["paragraph"]),
    Script(
      name: "deleting from a heading into a quote keeps the heading",
      start: document(heading("h2", text("ab")), quote(text("cd"))),
      commands: [.setSelection(anchor: .text([0, 0], 1), focus: .text([1, 0], 1)), .deleteCharacter(backward: true)],
      blocks: ["h2"]),
    Script(
      name: "typing and formatting in a heading and a quote",
      start: document(heading("h1", text("ab")), quote(text("cd"))),
      commands: [
        .caret(.text([0, 0], 1)), .insertText("x"), .insertLineBreak,
        .setSelection(anchor: .text([0, 0], 0), focus: .text([1, 0], 1)), .formatText(.bold),
        .caret(.text([1, 0], 1)), .deleteWord(backward: true),
      ],
      blocks: ["h1", "quote"]),
  ]

  @Test(arguments: setBlockType + editing)
  func lexicalSwiftDoesWhatLexicalDoes(_ script: Script) throws {
    let fixture = try Fixture.record(
      start: script.start, commands: script.commands, on: try Support.referenceEditor())

    #expect(blocks(in: fixture.expected.state) == script.blocks)
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  private func blocks(in state: JSONValue) -> [String] {
    (state["root"]?["children"]?.arrayValue ?? []).map { block in
      (block["type"] == "heading" ? block["tag"] : block["type"])?.stringValue ?? "?"
    }
  }
}
