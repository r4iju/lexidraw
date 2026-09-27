import LexicalFuzz
import LexicalSwift
import Testing

/// Each character typed on its own, as a keyboard types it.
func typing(_ text: String) -> [EditorCommand] { text.map { .insertText(String($0)) } }

@Suite struct AutoLinkTests {
  static let empty = document(paragraph())
  static let go = document(paragraph(text("go ")))
  static let autoLinked = LinkTests.autoLinked
  static let autoLinkAtEnd = document(paragraph(text("at "), autoLink("https://www.example.com", text("www.example.com"))))

  static let scenarios: [Scenario] = [
    Scenario("typing a URL", go, [caret([0, 0], 3)] + typing("www.a.io now")),
    Scenario("typing an https URL", empty, [.caret(Point(path: [0], offset: 0, type: .element))] + typing("https://a.io/b?c=d ")),
    Scenario("typing an email address", go, [caret([0, 0], 3)] + typing("me@a.io ")),
    Scenario("typing a URL that ends a sentence", go, [caret([0, 0], 3)] + typing("www.a.io. ")),
    Scenario("typing a URL in brackets", go, [caret([0, 0], 3)] + typing("(www.a.io) ")),
    Scenario("typing text that is no URL", go, [caret([0, 0], 3)] + typing("a.io example.com ")),
    Scenario("typing a URL straight after a word", go, [caret([0, 0], 3)] + typing("xwww.a.io ")),
    Scenario("a URL inserted whole", go, [caret([0, 0], 3), .insertText("see www.a.io and me@b.io now")]),
    Scenario("text that loads with URLs", document(paragraph(text("see www.a.io and me@b.io"))), []),
    Scenario(
      "a URL across formats", document(paragraph(text("www.", format: .bold), text("a.io"))),
      [caret([0, 1], 4), .insertText(" ")]),
    Scenario(
      "a URL after a line break", document(paragraph(text("one"), LexicalJSON.lineBreak)),
      [.caret(Point(path: [0], offset: 2, type: .element))] + typing("www.a.io ")),
    Scenario("typing inside an autolink", autoLinked, [caret([0, 1, 0], 7), .insertText("x")]),
    Scenario("a space inside an autolink", autoLinked, [caret([0, 1, 0], 4), .insertText(" ")]),
    Scenario("typing after an autolink", autoLinked, [caret([0, 1, 0], 15), .insertText("x")]),
    Scenario("typing before an autolink", autoLinked, [caret([0, 0], 3), .insertText("x")]),
    Scenario("extending an autolink's domain", autoLinkAtEnd, [caret([0, 1, 0], 15)] + typing(".uk")),
    Scenario("a full stop after an autolink", autoLinkAtEnd, [caret([0, 1, 0], 15)] + typing(". ")),
    Scenario("deleting the space before an autolink", autoLinked, [caret([0, 0], 3), .deleteCharacter(backward: true)]),
    Scenario("deleting the space after an autolink", autoLinked, [caret([0, 2], 1), .deleteCharacter(backward: true)]),
    Scenario("deleting into an autolink", autoLinked, [caret([0, 2], 0), .deleteCharacter(backward: true)]),
    Scenario("deleting an autolink's text", autoLinked, [select([0, 1, 0], 0, [0, 1, 0], 15), .insertText("x")]),
    Scenario("formatting part of an autolink", autoLinked, [select([0, 1, 0], 0, [0, 1, 0], 3), .formatText(.bold)]),
    Scenario(
      "typing in an unlinked autolink", autoLinked,
      [caret([0, 1, 0], 3), .toggleLink(url: nil), caret([0, 1, 0], 7), .insertText("x")]),
    Scenario("a new paragraph inside an autolink", autoLinked, [caret([0, 1, 0], 4), .insertParagraph]),
    Scenario("undoing an autolink", go, [caret([0, 0], 3)] + typing("www.a.io ") + [.undo, .redo]),
  ]

  @Test(arguments: scenarios)
  func lexicalSwiftDoesWhatLexicalDoes(_ scenario: Scenario) throws {
    let fixture = try scenario.recorded()

    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func typingAURLLinksIt() throws {
    let fixture = try Scenario("", Self.go, [caret([0, 0], 3)] + typing("www.a.io ")).recorded()

    #expect(
      fixture.expected.state
        == document(paragraph(text("go "), autoLink("https://www.a.io", text("www.a.io")), text(" "))))
  }
}
