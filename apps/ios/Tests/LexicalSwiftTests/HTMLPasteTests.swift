import Foundation
@testable import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct HTMLPasteTests {
  @Test func htmlFormattingSurvivesPaste() throws {
    let editor = Editor()
    try editor.load(document(paragraph()))
    try editor.apply(.caret(Point(path: [0], offset: 0, type: .element)))
    try editor.apply(.paste(Clipboard(plainText: "hello", html: "<p><strong>hello</strong></p>")))
    #expect(try editor.serializedState() == document(paragraph(text("hello", format: .bold))))
  }
  @Test func invalidCSSDoesNotApplyFormatting() throws {
    let editor = Editor()
    try editor.load(document(paragraph()))
    try editor.apply(.caret(Point(path: [0], offset: 0, type: .element)))
    try editor.apply(.paste(Clipboard(plainText: "hello", html: "<span style='font-weight: nonsense; font-weight: bold; font-weight: invalid'>hello</span>")))
    #expect(try editor.serializedState() == document(paragraph(text("hello", format: .bold))))
  }

  @Test func generatedHTMLAgreesWithDOMOracle() throws {
    if Support.environment("HTML_RECORD_NODE_SAMPLES") == "1" {
      var generator = Generator(seed: 168)
      let samples = (0..<200).map { _ in generator.document() }
      let destination = Support.fixturesSource.appending(path: "HTML/documents.json")
      try JSONValue.array(samples).stringified.write(to: destination, atomically: true, encoding: .utf8)
    }
    try replayHTMLFixtures("HTML/fuzz.json")
    try replayHTMLFixtures("HTML/node-fuzz.json")
  }

  @Test func recordedDOMOracleAgreesWithNativePaste() throws {
    try replayHTMLFixtures("HTML/paste.json")
  }

  private func replayHTMLFixtures(_ file: String) throws {
    let json = try JSONValue(parsing: String(contentsOf: Support.fixturesSource.appending(path: file), encoding: .utf8))
    for fixture in try #require(json.arrayValue) {
      let html = try #require(fixture["html"]?.stringValue)
      let nodes = try #require(fixture["nodes"]?.arrayValue)
      let expected = Editor()
      let actual = Editor()
      for editor in [expected, actual] {
        try editor.load(document(paragraph()))
        try editor.apply(.caret(Point(path: [0], offset: 0, type: .element)))
      }
      do {
        try expected.apply(.paste(Clipboard(plainText: "", lexical: LexicalClipboardPayload(namespace: editorNamespace, nodes: nodes))))
      } catch EditorError.unsupported(let expectedMessage) {
        do {
          try actual.apply(.paste(Clipboard(plainText: "", html: html)))
          Issue.record("Expected refusal: \(expectedMessage)")
        } catch EditorError.unsupported(let actualMessage) {
          #expect(actualMessage.components(separatedBy: "(#").last == expectedMessage.components(separatedBy: "(#").last)
        }
        #expect(try actual.serializedState() == document(paragraph()))
        continue
      }
      try actual.apply(.paste(Clipboard(plainText: "", html: html)))
      let expectedState = try expected.serializedState()
      let actualState = try actual.serializedState()
      #expect(actualState == expectedState, "\(fixture["name"]?.stringValue ?? "")")
    }
  }

  @Test func unportedImageReportsItsOwningTicket() throws {
    let editor = Editor()
    try editor.load(document(paragraph()))
    try editor.apply(.caret(Point(path: [0], offset: 0, type: .element)))
    #expect(throws: EditorError.unsupported("Pasting inline-image HTML isn't supported yet (#131)")) {
      try editor.apply(.paste(Clipboard(plainText: "image", html: "<img src='https://example.com/image.png' alt='image'>")))
    }
    #expect(try editor.serializedState() == document(paragraph()))
  }

  @Test func malformedRawTextHTMLAgreesWithChromium() throws {
    try replayHTMLFixtures("HTML/upstream/malformed-raw-text.chromium.json")
  }

  @Test func commandReferenceRequiresTheIndependentDOMOracleForHTML() throws {
    let reference = try Support.referenceEditor()
    try reference.load(document(paragraph()))
    try reference.apply(.caret(Point(path: [0], offset: 0, type: .element)))
    #expect(throws: EditorError.unsupported("HTML import requires the bun DOM oracle (#168)")) {
      try reference.apply(.paste(Clipboard(plainText: "hello", html: "<b>hello</b>")))
    }
  }

  @Test func identicalHTMLAndPlainTextUsePlainTextImport() throws {
    let editor = Editor()
    try editor.load(document(paragraph()))
    try editor.apply(.caret(Point(path: [0], offset: 0, type: .element)))
    try editor.apply(.paste(Clipboard(plainText: " hello ", html: " hello ")))
    #expect(try editor.serializedState() == document(paragraph(text(" hello "))))
  }

  @Test func importantStylesWinOverLaterDeclarations() throws {
    let editor = Editor()
    try editor.load(document(paragraph()))
    try editor.apply(.caret(Point(path: [0], offset: 0, type: .element)))
    try editor.apply(.paste(Clipboard(plainText: "hello", html: "<span style='font-weight:bold!important; font-weight:normal'>hello</span>")))
    #expect(try editor.serializedState() == document(paragraph(text("hello", format: .bold))))
  }

  @Test func malformedCSSKeepsValidDeclarations() throws {
    let editor = Editor()
    try editor.load(document(paragraph()))
    try editor.apply(.caret(Point(path: [0], offset: 0, type: .element)))
    try editor.apply(.paste(Clipboard(plainText: "hello", html: "<span style='color red; font-weight:bold'>hello</span>")))
    #expect(try editor.serializedState() == document(paragraph(text("hello", format: .bold))))
  }

  @Test func referenceConsumesLexicalBeforeHTML() throws {
    let reference = try Support.referenceEditor()
    try reference.load(document(paragraph()))
    try reference.apply(.caret(Point(path: [0], offset: 0, type: .element)))
    let nodes = [text("hello", format: .italic)]
    try reference.apply(.paste(Clipboard(plainText: "hello", html: "<b>hello</b>", lexical: LexicalClipboardPayload(namespace: editorNamespace, nodes: nodes))))
    #expect(try reference.serializedState() == document(paragraph(text("hello", format: .italic))))
  }

}
