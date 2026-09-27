import LexicalFuzz
import LexicalSwift
import Testing

/// A script to run on both models, named for what it checks.
struct Scenario: CustomTestStringConvertible, Sendable {
  let name: String
  let start: JSONValue
  let commands: [EditorCommand]

  init(_ name: String, _ start: JSONValue, _ commands: [EditorCommand]) {
    self.name = name
    self.start = start
    self.commands = commands
  }

  var testDescription: String { name }

  /// What the reference does with the script, recorded.
  func recorded() throws -> Fixture {
    try Fixture.record(start: start, commands: commands, on: try Support.referenceEditor())
  }
}

func caret(_ path: [Int], _ offset: Int) -> EditorCommand { .caret(.text(path, offset)) }

func select(_ anchor: [Int], _ anchorOffset: Int, _ focus: [Int], _ focusOffset: Int) -> EditorCommand {
  .setSelection(anchor: .text(anchor, anchorOffset), focus: .text(focus, focusOffset))
}

func link(_ url: String, _ children: JSONValue...) -> JSONValue { LexicalJSON.link(url, children) }

func autoLink(_ url: String, _ children: JSONValue...) -> JSONValue { LexicalJSON.autoLink(url, children) }

@Suite struct LinkTests {
  static let helloWorld = document(paragraph(text("hello world")))
  static let linked = document(paragraph(text("see "), link("https://a.io", text("the site")), text(" now")))
  static let twoLinks = document(
    paragraph(link("https://a.io", text("one")), text(" and "), link("https://b.io", text("two"))))
  static let autoLinked = document(
    paragraph(text("at "), autoLink("https://www.example.com", text("www.example.com")), text(" today")))

  static let scenarios: [Scenario] = [
    Scenario("linking part of a text", helloWorld, [select([0, 0], 6, [0, 0], 11), .toggleLink(url: "https://")]),
    Scenario("linking backwards", helloWorld, [select([0, 0], 11, [0, 0], 6), .toggleLink(url: "https://x.io")]),
    Scenario("linking a whole text", helloWorld, [select([0, 0], 0, [0, 0], 11), .toggleLink(url: "https://x.io")]),
    Scenario(
      "linking across formats", document(paragraph(text("plain"), text("bold", format: .bold))),
      [select([0, 0], 2, [0, 1], 2), .toggleLink(url: "https://x.io")]),
    Scenario(
      "linking across a line break", document(paragraph(text("one"), LexicalJSON.lineBreak, text("two"))),
      [select([0, 0], 1, [0, 2], 2), .toggleLink(url: "https://x.io")]),
    Scenario(
      "linking across paragraphs", document(paragraph(text("one")), paragraph(text("two"))),
      [select([0, 0], 1, [1, 0], 2), .toggleLink(url: "https://x.io")]),
    Scenario("linking everything", helloWorld, [caret([0, 0], 2), .selectAll, .toggleLink(url: "https://x.io")]),
    Scenario("a URL the web refuses", helloWorld, [select([0, 0], 0, [0, 0], 5), .toggleLink(url: "nope")]),
    Scenario("linking at a caret", helloWorld, [caret([0, 0], 3), .toggleLink(url: "https://x.io")]),
    Scenario("unlinking at a caret", linked, [caret([0, 1, 0], 3), .toggleLink(url: nil)]),
    Scenario("unlinking the middle of a link", linked, [select([0, 1, 0], 2, [0, 1, 0], 5), .toggleLink(url: nil)]),
    Scenario("unlinking the start of a link", linked, [select([0, 1, 0], 0, [0, 1, 0], 3), .toggleLink(url: nil)]),
    Scenario("unlinking the end of a link", linked, [select([0, 1, 0], 4, [0, 1, 0], 8), .toggleLink(url: nil)]),
    Scenario("unlinking across a link", linked, [select([0, 0], 1, [0, 2], 2), .toggleLink(url: nil)]),
    Scenario(
      "unlinking up to a link's start", linked,
      [.setSelection(anchor: .text([0, 0], 1), focus: Point(path: [0, 1], offset: 0, type: .element)), .toggleLink(url: nil)]),
    Scenario(
      "unlinking from a link's end", linked,
      [.setSelection(anchor: Point(path: [0, 1], offset: 1, type: .element), focus: .text([0, 2], 2)), .toggleLink(url: nil)]),
    Scenario("changing a link's URL", linked, [caret([0, 1, 0], 3), .toggleLink(url: "https://b.io")]),
    Scenario("linking over part of a link", linked, [select([0, 0], 1, [0, 1, 0], 3), .toggleLink(url: "https://b.io")]),
    Scenario("linking across two links", twoLinks, [select([0, 0, 0], 1, [0, 2, 0], 2), .toggleLink(url: "https://c.io")]),
    Scenario("linking beside a link of the same URL", linked, [select([0, 2], 0, [0, 2], 4), .toggleLink(url: "https://a.io")]),
    Scenario("typing inside a link", linked, [caret([0, 1, 0], 3), .insertText("x")]),
    Scenario("typing at the start of a link", linked, [caret([0, 1, 0], 0), .insertText("x")]),
    Scenario("typing at the end of a link", linked, [caret([0, 1, 0], 8), .insertText("x")]),
    Scenario("typing at the end of text before a link", linked, [caret([0, 0], 4), .insertText("x")]),
    Scenario("typing where a link starts a paragraph", twoLinks, [caret([0, 0, 0], 0), .insertText("x")]),
    Scenario("typing where a link ends a paragraph", twoLinks, [caret([0, 2, 0], 3), .insertText("x")]),
    Scenario("typing over a link's text", linked, [select([0, 1, 0], 0, [0, 1, 0], 8), .insertText("x")]),
    Scenario("typing over the end of a link", linked, [select([0, 1, 0], 4, [0, 2], 2), .insertText("x")]),
    Scenario("a new paragraph inside a link", linked, [caret([0, 1, 0], 3), .insertParagraph]),
    Scenario("a new paragraph at the end of a link", twoLinks, [caret([0, 2, 0], 3), .insertParagraph]),
    Scenario("a line break inside a link", linked, [caret([0, 1, 0], 3), .insertLineBreak]),
    Scenario("deleting back into a link", linked, [caret([0, 2], 0), .deleteCharacter(backward: true)]),
    Scenario("deleting forward into a link", linked, [caret([0, 0], 4), .deleteCharacter(backward: false)]),
    Scenario(
      "deleting a link's text", document(paragraph(text("a"), link("https://a.io", text("b")), text("c"))),
      [caret([0, 1, 0], 1), .deleteCharacter(backward: true)]),
    Scenario("deleting a word across a link", linked, [caret([0, 2], 4), .deleteWord(backward: true)]),
    Scenario("formatting a link's text", linked, [select([0, 1, 0], 0, [0, 1, 0], 3), .formatText(.bold)]),
    Scenario(
      "undoing a link", helloWorld,
      [select([0, 0], 6, [0, 0], 11), .toggleLink(url: "https://x.io"), .undo, .redo]),
    Scenario("editing a link", linked, [caret([0, 1, 0], 3), .editLink(url: "https://b.io")]),
    Scenario("editing an autolink", autoLinked, [caret([0, 1, 0], 3), .editLink(url: "https://b.io")]),
    Scenario("unlinking an autolink", autoLinked, [caret([0, 1, 0], 3), .toggleLink(url: nil)]),
    Scenario("relinking an autolink", autoLinked, [caret([0, 1, 0], 3), .toggleLink(url: nil), .toggleLink(url: nil)]),
    Scenario("linking over an autolink", autoLinked, [select([0, 0], 0, [0, 2], 3), .toggleLink(url: "https://x.io")]),
  ]

  @Test(arguments: scenarios)
  func lexicalSwiftDoesWhatLexicalDoes(_ scenario: Scenario) throws {
    let fixture = try scenario.recorded()

    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  /// `SANITIZED_URLS` in packages/lexical-nodes/src/links.test.ts, which
  /// holds them to the browser's own `URL`, as a link saves them: the ones
  /// `validateUrl` then takes.
  static let sanitizedURLs: [(typed: String, saved: String)] = [
    ("HTTPS://Example.COM", "https://example.com/"),
    ("https://example.com/a b?c=d e#f", "https://example.com/a%20b?c=d%20e#f"),
    ("https://münchen.de/straße", "https://xn--mnchen-3ya.de/stra%C3%9Fe"),
    ("http://a.io:80/./b/../c", "http://a.io/c"),
    ("mailto:Me@B.io", "mailto:Me@B.io"),
    ("ftp://x", "about:blank"),
    ("javascript:alert(1)", "about:blank"),
    ("www.a.io", "www.a.io"),
  ]

  @Test(arguments: sanitizedURLs)
  func editingALinkSavesTheURLAsTheBrowserWritesIt(_ typed: String, _ saved: String) throws {
    let fixture = try Scenario("", Self.linked, [caret([0, 1, 0], 3), .editLink(url: typed)]).recorded()

    let editor = Editor()

    #expect(try fixture.replay(on: editor) == fixture.recorded)
    #expect(try editor.node(at: [0, 1])["url"] == .string(saved))
  }

  @Test func toggleLinkLinksTheSelection() throws {
    let fixture = try Scenario("", Self.helloWorld, [select([0, 0], 6, [0, 0], 11), .toggleLink(url: "https://")])
      .recorded()

    #expect(
      fixture.expected.state
        == document(paragraph(text("hello "), LexicalJSON.link("https://", [text("world")]))))
  }
}
