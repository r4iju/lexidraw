import LexicalFuzz
import LexicalSwift
import Testing

/// Lexical nodes on the clipboard, as a copy from a Lexidraw document puts them.
func copied(_ plainText: String, _ nodes: JSONValue..., namespace: String = editorNamespace) -> Clipboard {
  Clipboard(plainText: plainText, lexical: ["namespace": .string(namespace), "nodes": .array(nodes)])
}

func plain(_ text: String) -> EditorCommand { .paste(Clipboard(plainText: text)) }

@Suite struct ClipboardTests {
  static let helloWorld = LinkTests.helloWorld
  static let linked = LinkTests.linked
  static let twoParagraphs = document(paragraph(text("one")), paragraph(text("two", format: .bold)))
  static let lineBreaks = document(paragraph(text("one"), LexicalJSON.lineBreak, text("two")))
  static let emptyLine = document(paragraph(text("one"), LexicalJSON.lineBreak, LexicalJSON.lineBreak, text("two")))
  static let empty = document(paragraph())
  static let paragraphs = copied(
    "one\n\ntwo", paragraph(text("one")), paragraph(text("two", format: .italic)))

  static let scenarios: [Scenario] = [
    Scenario("copying part of a text", helloWorld, [select([0, 0], 6, [0, 0], 11), .copy]),
    Scenario("copying backwards", helloWorld, [select([0, 0], 11, [0, 0], 6), .copy]),
    Scenario("copying at a caret", helloWorld, [caret([0, 0], 3), .copy]),
    Scenario("copying across paragraphs", twoParagraphs, [select([0, 0], 1, [1, 0], 2), .copy]),
    Scenario("copying whole paragraphs", twoParagraphs, [select([0, 0], 0, [1, 0], 3), .copy]),
    Scenario("copying everything", twoParagraphs, [caret([0, 0], 1), .selectAll, .copy]),
    Scenario("copying across a line break", lineBreaks, [select([0, 0], 1, [0, 2], 2), .copy]),
    Scenario(
      "copying from a paragraph's end into its last text", lineBreaks,
      [.setSelection(anchor: Point(path: [0], offset: 3, type: .element), focus: .text([0, 2], 1)), .copy]),
    Scenario("copying part of a heading", document(heading("h2", text("hello"))), [select([0, 0], 1, [0, 0], 4), .copy]),
    Scenario("copying part of a quote", document(quote(text("hello"))), [select([0, 0], 1, [0, 0], 4), .copy]),
    Scenario(
      "pasting part of a heading", twoParagraphs, [caret([0, 0], 1), .paste(copied("ell", heading("h2", text("ell"))))]),
    Scenario("copying inside a link", linked, [select([0, 1, 0], 1, [0, 1, 0], 5), .copy]),
    Scenario("copying across a link", linked, [select([0, 0], 1, [0, 1, 0], 3), .copy]),
    Scenario("copying over a whole link", linked, [select([0, 0], 1, [0, 2], 2), .copy]),
    Scenario("cutting part of a text", helloWorld, [select([0, 0], 6, [0, 0], 11), .cut]),
    Scenario("cutting at a caret", helloWorld, [caret([0, 0], 3), .cut]),
    Scenario("cutting across paragraphs", twoParagraphs, [select([0, 0], 1, [1, 0], 2), .cut]),
    Scenario("cutting everything", twoParagraphs, [caret([0, 0], 1), .selectAll, .cut, .undo]),
    Scenario("cutting a whole document by hand", twoParagraphs, [select([0, 0], 0, [1, 0], 3), .cut, .undo]),
    Scenario("cutting after typing", helloWorld, [caret([0, 0], 5), .insertText("x"), select([0, 0], 0, [0, 0], 2), .cut, .undo]),
    Scenario("pasting text", helloWorld, [caret([0, 0], 5), plain(" there,")]),
    Scenario("pasting text over a selection", helloWorld, [select([0, 0], 0, [0, 0], 5), plain("goodbye")]),
    Scenario("pasting lines", helloWorld, [caret([0, 0], 5), plain("one\ntwo\r\nthree\r")]),
    Scenario("pasting a trailing line", helloWorld, [caret([0, 0], 11), plain("one\n")]),
    Scenario("pasting tabs", helloWorld, [caret([0, 0], 5), plain("\ta\t\tb\t")]),
    Scenario("typing beside a pasted tab", helloWorld, [caret([0, 0], 5), plain("\t"), .insertText("x")]),
    Scenario("typing before a pasted tab", helloWorld, [caret([0, 0], 5), plain("\t"), caret([0, 0], 5), .insertText("x")]),
    Scenario("deleting a pasted tab", helloWorld, [caret([0, 0], 5), plain("a\tb"), caret([0, 2], 0), .deleteCharacter(backward: true)]),
    Scenario("deleting forward over a tab", helloWorld, [caret([0, 0], 5), plain("\tb"), caret([0, 0], 5), .deleteCharacter(backward: false)]),
    Scenario("formatting a pasted tab", helloWorld, [caret([0, 0], 5), plain("\t"), .selectAll, .formatText(.bold)]),
    Scenario("pasting into formatted text", document(paragraph(text("bold", format: .bold))), [caret([0, 0], 2), plain("x\ny")]),
    Scenario("pasting into an empty document", empty, [.caret(Point(path: [0], offset: 0, type: .element)), plain("a\nb")]),
    Scenario(
      "pasting a block before a line break that ends its paragraph",
      document(paragraph(text("a"), text("x", format: .bold), LexicalJSON.lineBreak)),
      [caret([0, 0], 1), .paste(copied("b", paragraph(text("b"))))]),
    Scenario(
      "pasting a block over text before a line break that ends its paragraph",
      document(paragraph(text("ab"), text("x", format: .bold), LexicalJSON.lineBreak)),
      [select([0, 0], 1, [0, 0], 2), .paste(copied("c", paragraph(text("c"))))]),
    Scenario(
      "pasting a block over nodes before a line break that ends its paragraph",
      document(paragraph(text("ab"), text("x", format: .bold), text("y"), LexicalJSON.lineBreak)),
      [select([0, 0], 1, [0, 2], 1), .paste(copied("c", paragraph(text("c"))))]),
    Scenario("pasting a URL", helloWorld, [caret([0, 0], 6), plain("https://a.io ")]),
    Scenario("pasting a URL over selected text", helloWorld, [select([0, 0], 6, [0, 0], 11), plain("https://a.io")]),
    Scenario("pasting a URL over a link", linked, [select([0, 1, 0], 0, [0, 1, 0], 3), plain("https://b.io")]),
    Scenario("pasting a URL over paragraphs", twoParagraphs, [select([0, 0], 1, [1, 0], 2), plain("https://a.io")]),
    Scenario("pasting a URL over a tab", helloWorld, [caret([0, 0], 5), plain("\t"), select([0, 0], 3, [0, 2], 2), plain("https://a.io")]),
    Scenario("pasting text that is no URL over selected text", helloWorld, [select([0, 0], 6, [0, 0], 11), plain("a b")]),
    Scenario("pasting HTML", helloWorld, [caret([0, 0], 5), .paste(Clipboard(plainText: "x y", html: "<b>x</b> y"))]),
    Scenario("pasting HTML that is its plain text", helloWorld, [caret([0, 0], 5), .paste(Clipboard(plainText: "x", html: "x"))]),
    Scenario("pasting HTML without plain text", helloWorld, [caret([0, 0], 5), .paste(Clipboard(plainText: "", html: "<b>x</b>"))]),
    Scenario("pasting nothing", helloWorld, [caret([0, 0], 5), plain("")]),
    Scenario("pasting text nodes", helloWorld, [caret([0, 0], 5), .paste(copied("ab", text("a", format: .bold), text("b")))]),
    Scenario("pasting a line break", helloWorld, [caret([0, 0], 5), .paste(copied("\n", LexicalJSON.lineBreak))]),
    Scenario("pasting a link", helloWorld, [caret([0, 0], 5), .paste(copied("x", link("https://x.io", text("x"))))]),
    Scenario("pasting a link into a link", linked, [caret([0, 1, 0], 3), .paste(copied("x", link("https://x.io", text("x"))))]),
    Scenario("pasting paragraphs mid-text", helloWorld, [caret([0, 0], 5), .paste(paragraphs)]),
    Scenario("pasting paragraphs at the start", helloWorld, [caret([0, 0], 0), .paste(paragraphs)]),
    Scenario("pasting paragraphs at the end", helloWorld, [caret([0, 0], 11), .paste(paragraphs)]),
    Scenario("pasting paragraphs into an empty document", empty, [.caret(Point(path: [0], offset: 0, type: .element)), .paste(paragraphs)]),
    Scenario("pasting paragraphs over a selection", twoParagraphs, [select([0, 0], 1, [1, 0], 2), .paste(paragraphs)]),
    Scenario("pasting paragraphs over everything", twoParagraphs, [caret([0, 0], 1), .selectAll, .paste(paragraphs)]),
    Scenario("pasting paragraphs after a line break", lineBreaks, [caret([0, 2], 0), .paste(paragraphs)]),
    Scenario("pasting paragraphs after an empty line", emptyLine, [caret([0, 3], 0), .paste(paragraphs)]),
    Scenario("pasting paragraphs before a line break", lineBreaks, [caret([0, 0], 3), .paste(paragraphs)]),
    Scenario("pasting paragraphs inside a link", linked, [caret([0, 1, 0], 3), .paste(paragraphs)]),
    Scenario("pasting a paragraph", helloWorld, [caret([0, 0], 5), .paste(copied("x", paragraph(text("x", format: .bold))))]),
    Scenario("pasting an empty paragraph", helloWorld, [caret([0, 0], 5), .paste(copied("", paragraph(), paragraph()))]),
    Scenario("pasting a URL in a paragraph", helloWorld, [caret([0, 0], 5), .paste(copied("www.a.io", paragraph(text(" www.a.io "))))]),
    Scenario("pasting nodes from another editor", helloWorld, [caret([0, 0], 5), .paste(copied("x", text("x"), namespace: "Other"))]),
    Scenario("pasting nodes Lexidraw doesn't have", helloWorld, [caret([0, 0], 5), .paste(copied("x", ["type": "nope", "version": 1]))]),
    Scenario("pasting after cutting everything", twoParagraphs, [caret([0, 0], 1), .selectAll, .cut, .paste(paragraphs)]),
    Scenario("undoing a paste after typing", helloWorld, [caret([0, 0], 5), .insertText("a"), plain("b"), .insertText("c"), .undo]),
  ]

  @Test(arguments: scenarios)
  func lexicalSwiftDoesWhatLexicalDoes(_ scenario: Scenario) throws {
    let fixture = try scenario.recorded()

    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func copyingPutsTheSelectionOnTheClipboard() throws {
    let fixture = try Scenario("", Self.helloWorld, [select([0, 0], 6, [0, 0], 11), .copy]).recorded()

    #expect(fixture.changes.last == .applied(ChangeSet(clipboard: copied("world", text("world")))))
  }

  /// Copying from one document and pasting into another, as a user does.
  @Test func pastingKeepsWhatWasCopied() throws {
    let reference = try Support.referenceEditor()
    try reference.load(Self.twoParagraphs)
    try reference.apply(select([0, 0], 1, [1, 0], 3))
    let clipboard = try #require(try reference.apply(.copy).clipboard)
    let fixture = try Scenario("", Self.helloWorld, [caret([0, 0], 5), .paste(clipboard)]).recorded()

    #expect(
      fixture.expected.state
        == document(paragraph(text("hellone")), paragraph(text("two", format: .bold), text(" world"))))
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}
