import LexicalFuzz
import LexicalSwift
import Testing

/// The web editor's markdown shortcuts while typing, recorded from Lexical
/// with the web's transformers and replayed on LexicalSwift.
@Suite struct MarkdownShortcutTests {
  struct Script: CustomTestStringConvertible, Sendable {
    let name: String
    let start: JSONValue
    let commands: [EditorCommand]
    /// The document Lexical leaves.
    let expected: JSONValue

    var testDescription: String { name }
  }

  static let emptyParagraph = document(paragraph())
  static let caretInEmptyParagraph = EditorCommand.caret(Point(path: [0], offset: 0, type: .element))

  /// One key at a time, as the shortcuts want them.
  static func typing(_ keys: String) -> [EditorCommand] {
    keys.map { .insertText(String($0)) }
  }

  static let blocks: [Script] = [
    Script(
      name: "# and a space make a heading", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("# "), expected: document(heading("h1"))),
    Script(
      name: "six #s make a sixth-level heading", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("###### "), expected: document(heading("h6"))),
    Script(
      name: "seven #s stay text", start: emptyParagraph, commands: [caretInEmptyParagraph] + typing("####### "),
      expected: document(paragraph(text("####### ")))),
    Script(
      name: "# typed before text makes the text a heading", start: document(paragraph(text("ab"))),
      commands: [.caret(.text([0, 0], 0))] + typing("# "), expected: document(heading("h1", text("ab")))),
    Script(
      name: "# and a space typed at once stay text", start: emptyParagraph,
      commands: [caretInEmptyParagraph, .insertText("# ")], expected: document(paragraph(text("# ")))),
    Script(
      name: "> and a space make a quote", start: emptyParagraph, commands: [caretInEmptyParagraph] + typing("> "),
      expected: document(quote())),
    Script(
      name: "a heading shortcut in a quote stays text", start: document(quote(text("ab"))),
      commands: [.caret(.text([0, 0], 0))] + typing("# "), expected: document(quote(text("# ab")))),
    Script(
      name: "a quote shortcut in a heading makes it a quote", start: document(heading("h2", text("ab"))),
      commands: [.caret(.text([0, 0], 0))] + typing("> "), expected: document(quote(text("ab")))),
    Script(
      name: "Enter after ## and a space makes a heading, not a new line", start: emptyParagraph,
      commands: [caretInEmptyParagraph, .insertText("## "), .insertParagraph], expected: document(heading("h2"))),
    Script(
      name: "Enter after > and a space makes a quote", start: emptyParagraph,
      commands: [caretInEmptyParagraph, .insertText("> "), .insertParagraph], expected: document(quote())),
    Script(
      name: "Enter after # without a space is a new line", start: emptyParagraph,
      commands: [caretInEmptyParagraph, .insertText("#"), .insertParagraph],
      expected: document(paragraph(text("#")), paragraph())),
    Script(
      name: "a composition that ends in a space finishes # as a heading", start: emptyParagraph,
      commands: [caretInEmptyParagraph, .commitComposition("# ")], expected: document(heading("h1"))),
    Script(
      name: "a composition ends a shortcut typed before it", start: emptyParagraph,
      commands: [caretInEmptyParagraph, .insertText(">"), .commitComposition(" ")], expected: document(quote())),
    Script(
      name: "a composition that ends in no trigger finishes nothing", start: emptyParagraph,
      commands: [caretInEmptyParagraph, .commitComposition("# 日本")], expected: document(paragraph(text("# 日本")))),
    Script(
      name: "undo after a shortcut gives back what was typed", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("# ") + [.undo], expected: document(paragraph(text("# ")))),
    Script(
      name: "--- and a space make a rule before the paragraph", start: emptyParagraph,
      commands: [caretInEmptyParagraph, .insertText("---"), .insertText(" ")],
      expected: document(LexicalJSON.horizontalRule, paragraph())),
    Script(
      name: "*** and a space make a rule in place of a paragraph with one after it",
      start: document(paragraph(), paragraph(text("x"))),
      commands: [caretInEmptyParagraph, .insertText("***"), .insertText(" "), .insertText("y")],
      expected: document(LexicalJSON.horizontalRule, paragraph(text("yx")))),
    Script(
      name: "___ and a space make a rule", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("___ "), expected: document(LexicalJSON.horizontalRule, paragraph())),
    Script(
      name: "a list shortcut in a quote stays text", start: document(quote(text("ab"))),
      commands: [.caret(.text([0, 0], 0))] + typing("- "), expected: document(quote(text("- ab")))),
    Script(
      name: "a code shortcut in a quote stays text", start: document(quote(text("ab"))),
      commands: [.caret(.text([0, 0], 0))] + typing("``` "), expected: document(quote(text("``` ab")))),
    Script(
      name: "an admonition typed stays text", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("::: note "), expected: document(paragraph(text("::: note ")))),
    Script(
      name: "details typed stay text", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("<details> "), expected: document(paragraph(text("<details> ")))),
    Script(
      name: "a block equation typed stays text", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("$$x$$ "), expected: document(paragraph(text("$$x$$ ")))),
    Script(
      name: "Backspace after a rule deletes it", start: document(LexicalJSON.horizontalRule, paragraph(text("ab"))),
      commands: [.caret(.text([1, 0], 0)), .deleteCharacter(backward: true)], expected: document(paragraph(text("ab")))),
    Script(
      name: "Backspace in an empty paragraph after a rule selects the rule",
      start: document(LexicalJSON.horizontalRule, paragraph()),
      commands: [.caret(Point(path: [1], offset: 0, type: .element)), .deleteCharacter(backward: true), .insertText("a")],
      expected: document(LexicalJSON.horizontalRule)),
    Script(
      name: "Delete before a rule deletes it",
      start: document(paragraph(text("ab")), LexicalJSON.horizontalRule, paragraph(text("cd"))),
      commands: [.caret(.text([0, 0], 2)), .deleteCharacter(backward: false), .undo, .redo],
      expected: document(paragraph(text("ab")), paragraph(text("cd")))),
  ]

  static let formats: [Script] =
    [
      ("**", TextFormat.bold, "bold"), ("__", .bold, "bold"), ("*", .italic, "italic"), ("_", .italic, "italic"),
      ("***", [.bold, .italic], "bold and italic"), ("___", [.bold, .italic], "bold and italic"),
      ("~~", .strikethrough, "struck through"), ("==", .highlight, "highlighted"), ("`", .code, "code"),
    ].map { tag, format, name in
      Script(
        name: "\(tag)ab\(tag) makes ab \(name)", start: emptyParagraph,
        commands: [caretInEmptyParagraph] + typing("\(tag)ab\(tag)"), expected: document(paragraph(text("ab", format: format))))
    } + [
      Script(
        name: "a composition that ends in a closing tag formats", start: emptyParagraph,
        commands: [caretInEmptyParagraph, .commitComposition("**日本**")],
        expected: document(paragraph(text("日本", format: .bold)))),
      Script(
        name: "a format goes on with what is typed next", start: emptyParagraph,
        commands: [caretInEmptyParagraph] + typing("x **ab**c"),
        expected: document(paragraph(text("x "), text("ab", format: .bold), text("c")))),
      Script(
        name: "an underscore inside a word formats nothing", start: emptyParagraph,
        commands: [caretInEmptyParagraph] + typing("a_b_"), expected: document(paragraph(text("a_b_")))),
      Script(
        name: "a space before the closing tag formats nothing", start: emptyParagraph,
        commands: [caretInEmptyParagraph] + typing("*ab *"), expected: document(paragraph(text("*ab *")))),
      Script(
        name: "nothing is bold inside an unclosed code span", start: emptyParagraph,
        commands: [caretInEmptyParagraph] + typing("`**a**"), expected: document(paragraph(text("`**a**")))),
      Script(
        name: "code text takes no shortcuts", start: document(paragraph(text("*a", format: .code))),
        commands: [.caret(.text([0, 0], 2)), .insertText("*")], expected: document(paragraph(text("*a*", format: .code)))),
      Script(
        name: "the opening tag can be in text before", start: document(paragraph(text("**a"), text("b", format: .italic))),
        commands: [.caret(.text([0, 1], 1))] + typing("**"),
        expected: document(paragraph(text("a", format: .bold), text("b", format: [.bold, .italic])))),
      Script(
        name: "a line break ends the search for an opening tag",
        start: document(paragraph(text("*a"), LexicalJSON.lineBreak, text("b"))),
        commands: [.caret(.text([0, 2], 1)), .insertText("*")],
        expected: document(paragraph(text("*a"), LexicalJSON.lineBreak, text("b*")))),
      Script(
        name: "deleting up to a closing tag formats", start: document(paragraph(text("*ab*x"))),
        commands: [.caret(.text([0, 0], 5)), .deleteCharacter(backward: true)],
        expected: document(paragraph(text("ab", format: .italic)))),
    ]

  @Test(arguments: blocks + formats)
  func lexicalSwiftDoesWhatLexicalDoes(_ script: Script) throws {
    let fixture = try Fixture.record(
      start: script.start, commands: script.commands, on: try Support.referenceEditor())

    #expect(fixture.expected.state == script.expected)
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  /// Typing that a transformer LexicalSwift doesn't port yet turns into
  /// something else in Lexical, and what LexicalSwift leaves instead.
  static let notPortedYet: [Script] = [
    "- ", "7. ", "[ ] ", "``` ", ":smile:", "$x$", "|a| ", "[a](b)", "![a](b)",
  ].map { keys in
    Script(
      name: keys, start: emptyParagraph, commands: [caretInEmptyParagraph] + typing(keys),
      expected: document(paragraph(text(keys))))
  } + [
    Script(
      name: "``` and Enter", start: emptyParagraph, commands: [caretInEmptyParagraph, .insertText("```"), .insertParagraph],
      expected: document(paragraph(text("```")), paragraph()))
  ]

  @Test(arguments: notPortedYet)
  func typingAShortcutNotPortedYetKeepsWhatWasTyped(_ script: Script) throws {
    let fixture = try Fixture.record(start: script.start, commands: script.commands, on: try Support.referenceEditor())
    let outcome = try fixture.replay(on: Editor())

    #expect(fixture.expected.state != script.expected)
    #expect(outcome.changes.allSatisfy { if case .applied = $0 { true } else { false } })
    #expect(outcome.snapshot.state == script.expected)
  }
}
