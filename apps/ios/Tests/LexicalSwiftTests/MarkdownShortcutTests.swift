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

  static let lists: [Script] = [
    Script(
      name: "- and a space make a bulleted list", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("- "), expected: document(list(.bullet, [.item([])]))),
    Script(
      name: "* makes a bulleted list that keeps its marker", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("* "), expected: document(list(.bullet, [.item([])], marker: .asterisk))),
    Script(
      name: "+ makes a bulleted list that keeps its marker", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("+ "), expected: document(list(.bullet, [.item([])], marker: .plus))),
    Script(
      name: "* after a zero-width no-break space keeps its marker, as JavaScript's trim strips the space",
      start: emptyParagraph, commands: [caretInEmptyParagraph] + typing("\u{FEFF}* "),
      expected: document(list(.bullet, [.item([])], marker: .asterisk))),
    Script(
      name: "1. makes a numbered list", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("1. "), expected: document(list(.number, [.item([])]))),
    Script(
      name: "7. makes a list numbered from 7", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("7. "), expected: document(list(.number, [.item([])], start: 7))),
    Script(
      name: "[ ] makes a checklist", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("[ ] "), expected: document(list(.check, [.item([])]))),
    Script(
      name: "[X] makes a checked item", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("[X] "), expected: document(list(.check, [.item([], checked: true)]))),
    Script(
      name: "a composition of * [x] makes a checked item with the bullet's marker", start: emptyParagraph,
      commands: [caretInEmptyParagraph, .commitComposition("* [x] ")],
      expected: document(list(.check, [.item([], checked: true)], marker: .asterisk))),
    Script(
      name: "- typed before text makes the text an item", start: document(paragraph(text("ab"))),
      commands: [.caret(.text([0, 0], 0))] + typing("- "), expected: document(list(.bullet, [.item([text("ab")])]))),
    Script(
      name: "Enter after 1. and a space makes a numbered list", start: emptyParagraph,
      commands: [caretInEmptyParagraph, .insertText("1. "), .insertParagraph],
      expected: document(list(.number, [.item([])]))),
    Script(
      name: "a list shortcut in a heading stays text", start: document(heading("h2", text("ab"))),
      commands: [.caret(.text([0, 0], 0))] + typing("- "), expected: document(heading("h2", text("- ab")))),
    Script(
      name: "a list shortcut in a list item stays text", start: document(list(.bullet, [.item([text("ab")])])),
      commands: [.caret(.text([0, 0, 0], 0))] + typing("1. "),
      expected: document(list(.bullet, [.item([text("1. ab")])]))),
    Script(
      name: "a bullet after a bulleted list joins it", start: document(list(.bullet, [.item([text("a")])]), paragraph()),
      commands: [.caret(Point(path: [1], offset: 0, type: .element))] + typing("- ") + [.insertText("b")],
      expected: document(list(.bullet, [.item([text("a")]), .item([text("b")])]))),
    Script(
      name: "a number after a numbered list continues its numbering",
      start: document(list(.number, [.item([text("a")])], start: 4), paragraph()),
      commands: [.caret(Point(path: [1], offset: 0, type: .element))] + typing("9. "),
      expected: document(list(.number, [.item([text("a")]), .item([])], start: 4))),
    Script(
      name: "a number before a numbered list joins it and numbers it from there",
      start: document(paragraph(), list(.number, [.item([text("a")])])),
      commands: [caretInEmptyParagraph] + typing("3. "),
      expected: document(list(.number, [.item([]), .item([text("a")])], start: 3))),
    Script(
      name: "a checklist item before a bulleted list makes a list of its own",
      start: document(paragraph(), list(.bullet, [.item([text("a")])])),
      commands: [caretInEmptyParagraph] + typing("[ ] "),
      expected: document(list(.check, [.item([])]), list(.bullet, [.item([text("a")])]))),
    Script(
      name: "four spaces before - nest the item in the list above",
      start: document(list(.bullet, [.item([text("a")])]), paragraph()),
      commands: [.caret(Point(path: [1], offset: 0, type: .element))] + typing("    - "),
      expected: document(list(.bullet, [.item([text("a")]), .nested(.bullet, [.item([])])]))),
    Script(
      name: "an indented number after a bulleted list nests a numbered list",
      start: document(list(.bullet, [.item([text("a")])]), paragraph()),
      commands: [.caret(Point(path: [1], offset: 0, type: .element))] + typing("    5. "),
      expected: document(
        list(.bullet, [.item([text("a")]), .nested(.number, [.item([])], start: 5)]))),
    Script(
      name: "an indented * nests a list that keeps its marker",
      start: document(list(.bullet, [.item([text("a")])]), paragraph()),
      commands: [.caret(Point(path: [1], offset: 0, type: .element))] + typing("    * "),
      expected: document(list(.bullet, [.item([text("a")]), .nested(.bullet, [.item([])], marker: .asterisk)]))),
    Script(
      name: "eight spaces before - nest an item two deep in a list of its own", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("        - ") + [.insertText("a")],
      expected: document(list(.bullet, [.nested(.bullet, [.nested(.bullet, [.item([text("a")])])])]))),
    Script(
      name: "a list nested by indenting doesn't keep the marker of the list it copies", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("* ") + [.insertText("a"), .insertParagraph, .insertText("b"), .indent],
      expected: document(list(.bullet, [.item([text("a")]), .nested(.bullet, [.item([text("b")])])], marker: .asterisk))),
    Script(
      name: "- after a list kept as * joins it and marks it -",
      start: document(list(.bullet, [.item([text("a")])], marker: .asterisk), paragraph()),
      commands: [.caret(Point(path: [1], offset: 0, type: .element))] + typing("- "),
      expected: document(list(.bullet, [.item([text("a")]), .item([])]))),
    Script(
      name: "a list nested in a list loaded as * is one too, as no shortcut has told Lexical what the marker is",
      start: document(list(.bullet, [.item([text("a")]), .item([text("b")])], marker: .asterisk)),
      commands: [.caret(.text([0, 1, 0], 0)), .indent],
      expected: document(
        list(.bullet, [.item([text("a")]), .nested(.bullet, [.item([text("b")])], marker: .asterisk)], marker: .asterisk))),
    Script(
      name: "a list nested in a list loaded as * after a shortcut has marked a list is back to -",
      start: document(list(.bullet, [.item([text("a")]), .item([text("b")])], marker: .asterisk), paragraph(), paragraph()),
      commands: [.caret(Point(path: [2], offset: 0, type: .element))] + typing("- ") + [
        .caret(.text([0, 1, 0], 0)), .indent,
      ],
      expected: document(
        list(.bullet, [.item([text("a")]), .nested(.bullet, [.item([text("b")])])], marker: .asterisk), paragraph(),
        list(.bullet, [.item([])]))),
    Script(
      name: "undo after a list shortcut gives back what was typed", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("- ") + [.undo], expected: document(paragraph(text("- ")))),
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

  /// A link as the LINK shortcut makes one, with no `rel`.
  static func shortcutLink(_ url: String, _ children: JSONValue..., title: String? = nil) -> JSONValue {
    LexicalJSON.link(url, children, rel: nil, title: title)
  }

  static let links: [Script] = [
    Script(
      name: "[a](b) makes a link", start: emptyParagraph, commands: [caretInEmptyParagraph] + typing("[a](b)"),
      expected: document(paragraph(shortcutLink("b", text("a"))))),
    Script(
      name: "text typed after a link goes after it", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("x [a](b)c"),
      expected: document(paragraph(text("x "), shortcutLink("b", text("a")), text("c")))),
    Script(
      name: "a link typed before text leaves the caret before that text", start: document(paragraph(text("yz"))),
      commands: [.caret(.text([0, 0], 0))] + typing("[a](b)c"),
      expected: document(paragraph(shortcutLink("b", text("a")), text("cyz")))),
    Script(
      name: "a link takes a title", start: emptyParagraph, commands: [caretInEmptyParagraph] + typing("[a](b \"t\")"),
      expected: document(paragraph(shortcutLink("b", text("a"), title: "t")))),
    Script(
      name: "a link's URL between angle brackets can hold a space", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("[a](<b c>)"), expected: document(paragraph(shortcutLink("b c", text("a"))))),
    Script(
      name: "a link's URL loses its escapes", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("[a](b\\)&#33;)"),
      expected: document(paragraph(shortcutLink("b)!", text("a"))))),
    Script(
      name: "a backslash before a letter in a link's URL stays", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("[a](b\\c)"), expected: document(paragraph(shortcutLink("b\\c", text("a"))))),
    Script(
      name: "a doubled backslash in a link's URL is one", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("[a](b\\\\)"), expected: document(paragraph(shortcutLink("b\\", text("a"))))),
    Script(
      name: "a character reference in a link's URL needs its semicolon", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("[a](&#33)"), expected: document(paragraph(shortcutLink("&#33", text("a"))))),
    Script(
      name: "an escaped ampersand in a link's URL still starts a character reference", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("[a](\\&#128077;)"),
      expected: document(paragraph(shortcutLink("👍", text("a"))))),
    Script(
      name: "a link to a character past Unicode fails and leaves what was typed", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("[a](&#1114112;)"), expected: document(paragraph(text("[a](&#1114112;)")))),
    Script(
      name: "[a]() makes a link to nothing", start: emptyParagraph, commands: [caretInEmptyParagraph] + typing("[a]()"),
      expected: document(paragraph(shortcutLink("", text("a"))))),
    Script(
      name: "a link's text takes the format of what was typed", start: document(paragraph(text("[a](b", format: .bold))),
      commands: [.caret(.text([0, 0], 5)), .insertText(")")],
      expected: document(LexicalJSON.paragraph([shortcutLink("b", text("a", format: .bold))], textFormat: .bold))),
    Script(
      name: "a bracket before a link stays text", start: emptyParagraph, commands: [caretInEmptyParagraph] + typing("[[a](b)"),
      expected: document(paragraph(text("["), shortcutLink("b", text("a"))))),
    Script(
      name: "a link typed in a link's text stays text", start: document(paragraph(link("https://a.io", text("xy")))),
      commands: [.caret(.text([0, 0, 0], 1))] + typing("[a](b)c"),
      expected: document(paragraph(link("https://a.io", text("x[a](b)cy"))))),
    Script(
      name: "a URL typed in a link's parentheses", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("[a](https://a.io)"),
      expected: document(paragraph(shortcutLink("https://a.io", text("a"))))),
    Script(
      name: "a composition that ends in ) finishes a link", start: emptyParagraph,
      commands: [caretInEmptyParagraph, .commitComposition("[日本](b)")],
      expected: document(paragraph(shortcutLink("b", text("日本"))))),
    Script(
      name: "undo after a link gives back what was typed", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("[a](b)") + [.undo], expected: document(paragraph(text("[a](b)")))),
  ]

  @Test(arguments: blocks + lists + formats + links + legacyMarkers)
  func lexicalSwiftDoesWhatLexicalDoes(_ script: Script) throws {
    let fixture = try Fixture.record(
      start: script.start, commands: script.commands, on: try Support.referenceEditor())

    #expect(fixture.expected.state == script.expected)
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  /// `list` with the `[` an older @lexical/markdown kept as the marker of a
  /// checklist made with `[ ] `.
  static func withLegacyMarker(_ list: JSONValue) -> JSONValue {
    guard case .object(var fields) = list else { return list }
    fields["$"] = ["mdListMarker": "["]
    return .object(fields)
  }

  static let legacyMarkers: [Script] = [
    Script(
      name: "an item of a checklist with a legacy marker takes typing and a tap on its box",
      start: document(heading("h3", text("Dairy")), withLegacyMarker(list(.check, [.item([])]))),
      commands: [.caret(Point(path: [1, 0], offset: 0, type: .element)), .insertText("milk"), .toggleChecked(path: [1, 0])],
      expected: document(
        heading("h3", text("Dairy")), withLegacyMarker(list(.check, [.item([text("milk")], checked: true)])))),
    Script(
      name: "a legacy marker stays on its list when a shortcut has set a marker since",
      start: document(withLegacyMarker(list(.check, [.item([text("a")])])), paragraph()),
      commands: [.caret(Point(path: [1], offset: 0, type: .element))] + typing("* ")
        + [.caret(.text([0, 0, 0], 1)), .insertParagraph],
      expected: document(
        withLegacyMarker(list(.check, [.item([text("a")]), .item([])])),
        list(.bullet, [.item([])], marker: .asterisk))),
    Script(
      name: "a checklist with a legacy marker split by a quote keeps the marker in both parts",
      start: document(withLegacyMarker(list(.check, [.item([text("a")]), .item([text("b")]), .item([text("c")])]))),
      commands: [.caret(.text([0, 1, 0], 1)), .setBlockType(.quote)],
      expected: document(
        withLegacyMarker(list(.check, [.item([text("a")])])), quote(text("b")),
        withLegacyMarker(list(.check, [.item([text("c")])])))),
  ]

  /// Typing that a transformer LexicalSwift doesn't port yet turns into
  /// something else in Lexical, and what LexicalSwift leaves instead.
  static let notPortedYet: [Script] = [
    "``` ", "$x$", "![a](b)",
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
