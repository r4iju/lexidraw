import EditorModelInterface
import LexicalFuzz
import XCTest

/// Scripts for what only a real text view exercises, typed through the
/// simulator's keyboards into the editor harness. Each ends by checking the
/// document the harness saves, never the screen. The Japanese scripts need
/// the Japanese (Romaji) keyboard up, which `scripts/test-ui.sh` sets.
@MainActor
class EditorUITests: XCTestCase {
  /// The model the harness edits with. A subclass runs every script again
  /// with another.
  class var model: String { "lexicalswift" }

  private var app: XCUIApplication!
  private var savedURL: URL!
  private var hasPressedAKey = false

  override func setUp() {
    continueAfterFailure = false
  }

  func testTypingAndNewParagraphs() throws {
    let editor = open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello")])]))

    editor.typeText(" world")
    editor.typeText("\n")
    editor.typeText("Second")

    XCTAssertEqual(
      try saved(),
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("Hello world")]),
        LexicalJSON.paragraph([LexicalJSON.text("Second")]),
      ]))
  }

  func testDeletingJoinsParagraphs() throws {
    let editor = open(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("Hello")]), LexicalJSON.paragraph([LexicalJSON.text("World")]),
      ]))

    editor.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6))
    editor.typeText("!")

    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello!")])]))
  }

  func testBoldAndItalicFromTheHardwareKeyboard() throws {
    let editor = open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Plain ")])]))

    command("b", in: editor)
    editor.typeText("bold")
    command("b", in: editor)
    command("i", in: editor)
    editor.typeText("italic")

    XCTAssertEqual(
      try saved(),
      LexicalJSON.document([
        LexicalJSON.paragraph([
          LexicalJSON.text("Plain "), LexicalJSON.text("bold", format: .bold), LexicalJSON.text("italic", format: .italic),
        ])
      ]))
  }

  func testJoinedEmojiMoveAndDeleteAsOneCharacter() throws {
    let editor = open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("👨‍👩‍👧👍🏽")])]))

    editor.typeText("🇯🇵")
    editor.typeKey(.leftArrow, modifierFlags: [])
    editor.typeKey(.leftArrow, modifierFlags: [])
    editor.typeText("x")
    editor.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 2))

    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("👍🏽🇯🇵")])]))
  }

  /// Romaji to kana to kanji on the Japanese keyboard, committed by tapping
  /// the candidate, saves what the web editor saved for the same composition
  /// (`recording/composition.ts`).
  func testJapaneseCompositionSavesWhatTheWebEditorSaves() throws {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "web-composition", withExtension: "json"))
    let fixture = try JSONDecoder().decode(WebComposition.self, from: Data(contentsOf: url))
    for recorded in fixture.cases {
      try XCTContext.runActivity(named: recorded.name) { _ in
        let editor = open(recorded.start)
        for key in recorded.shortcuts { command(key, in: editor) }
        XCTAssertTrue(
          app.keys["ー"].waitForExistence(timeout: 5),
          "The Japanese (Romaji) keyboard should be up; scripts/test-ui.sh sets it")
        for key in fixture.keys { app.keys[key].tap() }
        let candidate = app.cells[fixture.candidate]
        XCTAssertTrue(candidate.waitForExistence(timeout: 5), "No \(fixture.candidate) candidate")
        candidate.tap()

        XCTAssertEqual(try saved(), recorded.saved)
      }
    }
  }

  /// Opens `document` in the harness with the caret at its end, where a tap
  /// below the text puts it.
  private func open(_ document: JSONValue) -> XCUIElement {
    app = XCUIApplication()
    savedURL = FileManager.default.temporaryDirectory.appending(path: "saved-\(UUID().uuidString).json")
    app.launchEnvironment["EDITOR_MODEL"] = Self.model
    app.launchEnvironment["EDITOR_DOCUMENT"] = String(decoding: try! JSONEncoder().encode(document), as: UTF8.self)
    app.launchEnvironment["EDITOR_SAVE_PATH"] = savedURL.path
    app.launch()
    let editor = app.textViews["editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    editor.tap()
    hasPressedAKey = false
    return editor
  }

  /// Presses Command-`key` on the hardware keyboard. The simulator drops the
  /// first shortcut after the software keyboard comes up, from a UITextView
  /// too, so a Shift press goes first. Only then: once a hardware key is
  /// down, the Japanese keyboard types a space as U+3000.
  private func command(_ key: String, in editor: XCUIElement) {
    if !hasPressedAKey { editor.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: []) }
    hasPressedAKey = true
    editor.typeKey(key, modifierFlags: .command)
  }

  /// Saves through the harness and reads back what it wrote.
  private func saved() throws -> JSONValue {
    app.buttons["Save"].tap()
    let deadline = Date().addingTimeInterval(5)
    while !FileManager.default.fileExists(atPath: savedURL.path), Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    return try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: savedURL))
  }
}

final class ReferenceEditorUITests: EditorUITests {
  override class var model: String { "reference" }
}

private struct WebComposition: Decodable {
  struct Case: Decodable {
    var name: String
    var start: JSONValue
    var shortcuts: [String]
    var saved: JSONValue
  }

  var keys: [String]
  var candidate: String
  var cases: [Case]
}
