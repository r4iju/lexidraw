import EditorModelInterface
import LexicalFuzz
import TextKitEditor
import UIKit
import XCTest

/// Scripts for what only a real text view exercises, typed through the
/// simulator's keyboards into the editor harness. Each checks the document
/// the harness saves, never the screen.
@MainActor
class EditorUITests: XCTestCase {
  /// The model the harness edits with. A subclass runs every script again
  /// with another.
  class var model: EditorModelChoice { .lexicalSwift }

  private var app: XCUIApplication!
  private var editor: XCUIElement!
  private var savedURL: URL!
  private var inputLogURL: URL!
  private var hasPressedAKey = false

  override func setUp() {
    continueAfterFailure = false
  }

  func testTypingAndNewParagraphs() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello")])]))

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
    open(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("Hello")]), LexicalJSON.paragraph([LexicalJSON.text("World")]),
      ]))

    editor.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6))
    editor.typeText("!")

    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello!")])]))
  }

  func testShiftReturnBreaksTheLine() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello")])]))

    // With Shift held, XCUIKeyboardKey.return never reaches the app; "\n" does.
    press("\n", .shift)
    editor.typeText("World")

    XCTAssertEqual(
      try saved(),
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("Hello"), LexicalJSON.lineBreak, LexicalJSON.text("World")])
      ]))
  }

  func testBoldItalicAndUnderlineFromTheHardwareKeyboard() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Plain ")])]))

    press("b", .command)
    editor.typeText("bold")
    press("b", .command)
    press("i", .command)
    editor.typeText("italic")
    press("i", .command)
    press("u", .command)
    editor.typeText("under")

    XCTAssertEqual(
      try saved(),
      LexicalJSON.document([
        LexicalJSON.paragraph([
          LexicalJSON.text("Plain "), LexicalJSON.text("bold", format: .bold),
          LexicalJSON.text("italic", format: .italic), LexicalJSON.text("under", format: .underline),
        ])
      ]))
  }

  func testSelectAllThenTypingReplacesEverything() throws {
    open(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("Hello")]), LexicalJSON.paragraph([LexicalJSON.text("World")]),
      ]))

    press("a", .command)
    editor.typeText("x")

    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("x")])]))
  }

  func testUndoAndRedoFromTheHardwareKeyboard() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello")])]))
    editor.typeText(" world")

    press("z", .command)
    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello")])]))

    press("z", [.command, .shift])
    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello world")])]))
  }

  func testMovingByWordAndLine() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("one two three")])]))

    press(.leftArrow, .option)
    editor.typeText("X")
    press(.leftArrow, .command)
    editor.typeText("Y")
    press(.rightArrow, .option)
    editor.typeText("Z")
    press(.rightArrow, .command)
    editor.typeText("!")

    XCTAssertEqual(
      try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("YoneZ two Xthree!")])]))
  }

  func testMovingUpAndDown() throws {
    open(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("1234")]), LexicalJSON.paragraph([LexicalJSON.text("5678")]),
      ]))

    press(.upArrow)
    editor.typeText("X")
    press(.downArrow)
    editor.typeText("Y")

    XCTAssertEqual(
      try saved(),
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("1234X")]), LexicalJSON.paragraph([LexicalJSON.text("5678Y")]),
      ]))
  }

  func testShiftExtendsTheSelection() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello")])]))

    press(.leftArrow, .shift)
    press(.leftArrow, .shift)
    editor.typeText("p!")

    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Help!")])]))
  }

  func testJoinedEmojiMoveLeftAndDeleteBackwardAsOneCharacter() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("👨‍👩‍👧👍🏽")])]))

    editor.typeText("🇯🇵")
    press(.leftArrow)
    press(.leftArrow)
    editor.typeText("x")
    editor.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 2))

    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("👍🏽🇯🇵")])]))
  }

  func testJoinedEmojiMoveRightAsOneCharacter() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("👨‍👩‍👧👍🏽🇯🇵")])]))

    for _ in 0..<3 { press(.leftArrow) }
    press(.rightArrow)
    editor.typeText("x")
    press(.rightArrow)
    editor.typeText("y")

    XCTAssertEqual(
      try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("👨‍👩‍👧x👍🏽y🇯🇵")])]))
  }

  func testTappingBetweenJoinedEmojiPutsTheCaretBetweenThem() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("👨‍👩‍👧👍🏽🇯🇵")])]))

    tapText(atPoints: 16 + Self.emojiWidth, line: 0)
    editor.typeText("x")
    tapText(atPoints: 16 + Self.emojiWidth * 0.6, line: 0)
    editor.typeText("y")

    XCTAssertEqual(
      try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("👨‍👩‍👧yx👍🏽🇯🇵")])]))
  }

  /// Romaji to kana to kanji on the Japanese keyboard. The keyboard's calls
  /// are what `web-composition.json` recorded from iOS, the view shows the
  /// composition where the caret was, and the harness saves what the web
  /// editor saved for the same calls (`recording/composition.ts`).
  func testJapaneseCompositionSavesWhatTheWebEditorSaves() throws {
    let recording = ProcessInfo.processInfo.environment["RECORD_COMPOSITION"] != nil
    let fixture = recording ? nil : try WebComposition.read()
    var recorded: [WebComposition.Case] = []
    for script in CompositionScript.all {
      try XCTContext.runActivity(named: script.name) { _ in
        open(script.start)
        for shortcut in script.shortcuts { press(shortcut.key, shortcut.modifiers) }
        XCTAssertTrue(app.keys["ー"].waitForExistence(timeout: 5), "The Japanese keyboard isn't up; scripts/test-ui.sh puts it first")
        for key in script.keys { app.keys[key].tap() }
        for candidate in script.candidates { tapCandidate(candidate) }
        if script.confirms { app.buttons["Return"].tap() }

        let saved = try saved()
        let input = try inputs()
        script.expectShowsComposition(input)
        recorded.append(.init(name: script.name, start: script.start, shortcuts: script.shortcuts, input: input.map(\.call)))
        guard let fixture else { return }
        let web = try XCTUnwrap(fixture.cases.first { $0.name == script.name }, "Record \(script.name)")
        XCTAssertEqual(input.map(\.call), web.input, "iOS sends other calls than were recorded")
        XCTAssertEqual(saved, try XCTUnwrap(web.saved, "Record what the web saves"))
      }
    }
    if recording { try WebComposition(recordedOn: "iOS \(UIDevice.current.systemVersion)", cases: recorded).write() }
  }

  /// Opens `document` in the harness with the caret at its end, where a tap
  /// below the text puts it.
  private func open(_ document: JSONValue) {
    app = XCUIApplication()
    let run = UUID().uuidString
    savedURL = FileManager.default.temporaryDirectory.appending(path: "saved-\(run).json")
    inputLogURL = FileManager.default.temporaryDirectory.appending(path: "input-\(run).json")
    app.launchEnvironment["EDITOR_MODEL"] = Self.model.rawValue
    app.launchEnvironment["EDITOR_DOCUMENT"] = String(decoding: try! JSONEncoder().encode(document), as: UTF8.self)
    app.launchEnvironment["EDITOR_SAVE_PATH"] = savedURL.path
    app.launchEnvironment["EDITOR_INPUT_LOG"] = inputLogURL.path
    app.launch()
    editor = app.textViews["editor"]
    XCTAssertTrue(editor.waitForExistence(timeout: 10))
    editor.tap()
    hasPressedAKey = false
  }

  /// Presses `key` on the hardware keyboard. The simulator drops the first
  /// shortcut after the software keyboard comes up, from a UITextView too,
  /// so a Shift press goes first. Only then: once a hardware key is down,
  /// the Japanese keyboard types a space as U+3000.
  private func press(_ key: XCUIKeyboardKey, _ modifiers: XCUIElement.KeyModifierFlags = []) {
    press(key.rawValue, modifiers)
  }

  private func press(_ key: String, _ modifiers: XCUIElement.KeyModifierFlags = []) {
    if !hasPressedAKey { editor.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: []) }
    hasPressedAKey = true
    editor.typeKey(key, modifierFlags: modifiers)
  }

  /// Taps `candidate` in the keyboard's candidate bar, or in the full list
  /// of suggestions where the bar hasn't room for it: a clause's candidates
  /// come after the whole reading's.
  private func tapCandidate(_ candidate: String) {
    let cell = app.cells[candidate]
    if !cell.waitForExistence(timeout: 2) {
      app.buttons["More suggestions"].tap()
      var shown: [String] = []
      while !cell.waitForExistence(timeout: 1) {
        let cells = app.cells.allElementsBoundByIndex
        guard cells.map(\.identifier) != shown, let top = cells.first?.frame else { break }
        shown = cells.map(\.identifier)
        let screen = app.coordinate(withNormalizedOffset: .zero)
        screen.withOffset(CGVector(dx: top.maxX, dy: top.minY + 4 * top.height))
          .press(forDuration: 0.1, thenDragTo: screen.withOffset(CGVector(dx: top.maxX, dy: top.minY)))
      }
    }
    XCTAssertTrue(cell.waitForExistence(timeout: 5), "No \(candidate) candidate")
    cell.tap()
  }

  /// The width an emoji takes in body text at the default text size.
  private static let emojiWidth: CGFloat = 22

  /// Taps the text `x` points from the editor's left edge, on line `line`.
  private func tapText(atPoints x: CGFloat, line: Int) {
    editor.coordinate(withNormalizedOffset: .zero)
      .withOffset(CGVector(dx: x, dy: 16 + 11 + CGFloat(line) * 22)).tap()
  }

  /// Saves through the harness and reads back what it wrote.
  private func saved() throws -> JSONValue {
    if FileManager.default.fileExists(atPath: savedURL.path) { try FileManager.default.removeItem(at: savedURL) }
    app.buttons["Save"].tap()
    let deadline = Date().addingTimeInterval(5)
    while !FileManager.default.fileExists(atPath: savedURL.path), Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    return try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: savedURL))
  }

  /// The keyboard's calls up to the last save.
  private func inputs() throws -> [TextInputRecord] {
    try JSONDecoder().decode([TextInputRecord].self, from: Data(contentsOf: inputLogURL))
  }
}

final class ReferenceEditorUITests: EditorUITests {
  override class var model: EditorModelChoice { .reference }
}

/// A hardware shortcut pressed before composing, as the fixture names it.
enum Shortcut: String, Codable {
  case bold = "⌘b"
  case left = "←"

  var key: String {
    switch self {
    case .bold: "b"
    case .left: XCUIKeyboardKey.leftArrow.rawValue
    }
  }

  var modifiers: XCUIElement.KeyModifierFlags {
    switch self {
    case .bold: .command
    case .left: []
    }
  }
}

/// A composition on the Japanese keyboard: `keys` typed, each of
/// `candidates` tapped in turn, then, if it `confirms`, the rest committed
/// as kana with the confirm key.
struct CompositionScript {
  var name: String
  var start: JSONValue
  var shortcuts: [Shortcut] = []
  /// The view's text either side of the caret once the shortcuts are down.
  var before: String
  var after: String = ""
  var keys: [String]
  var candidates: [String]
  var confirms = false

  static let nihon = ["n", "i", "h", "o", "n", "n"]
  static let kyouHaIiTenki = ["k", "y", "o", "u", "h", "a", "i", "i", "t", "e", "n", "k", "i"]
  static let konnichiwa = LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("今日は")])])
  static let empty = LexicalJSON.document([LexicalJSON.paragraph([])])

  static let all = [
    CompositionScript(name: "after-text", start: konnichiwa, before: "今日は", keys: nihon, candidates: ["日本"]),
    CompositionScript(name: "empty-paragraph", start: empty, before: "", keys: nihon, candidates: ["日本"]),
    CompositionScript(
      name: "after-bold-shortcut", start: konnichiwa, shortcuts: [.bold], before: "今日は", keys: nihon,
      candidates: ["日本"]),
    CompositionScript(
      name: "mid-text", start: konnichiwa, shortcuts: [.left], before: "今日", after: "は", keys: nihon,
      candidates: ["日本"]),
    CompositionScript(
      name: "multi-clause", start: empty, before: "", keys: kyouHaIiTenki, candidates: ["今日は", "いい天気"]),
    CompositionScript(
      name: "partial-commit", start: empty, before: "", keys: kyouHaIiTenki, candidates: ["今日は"], confirms: true),
  ]

  /// Checks that the view showed each composition over the caret, between
  /// the text before it and after it, and marked only the composed text.
  func expectShowsComposition(_ input: [TextInputRecord]) {
    var committed = ""
    var composing = ""
    for record in input {
      switch record.call {
      case .setMarkedText(let text, _):
        composing = text
        let start = (before + committed).utf16.count
        XCTAssertEqual(record.text, before + committed + text + after + "\n", "\(name): \(record.call)")
        XCTAssertEqual(record.marked, NSRange(location: start, length: text.utf16.count), "\(name): \(record.call)")
        continue
      case .insertText(let text): committed += text
      case .unmarkText: committed += composing
      case .deleteBackward: XCTFail("\(name): the keyboard deleted")
      }
      composing = ""
      XCTAssertEqual(record.text, before + committed + after + "\n", "\(name): \(record.call)")
      XCTAssertNil(record.marked, "\(name): \(record.call)")
    }
  }
}

/// What iOS sent for each composition and what the web editor saved for the
/// same calls.
struct WebComposition: Codable {
  struct Case: Codable {
    var name: String
    var start: JSONValue
    var shortcuts: [Shortcut]
    var input: [TextInputRecord.Call]
    /// Written by `recording/composition.ts`.
    var saved: JSONValue?
  }

  var recordedOn: String
  var recordedWith: String?
  var cases: [Case]

  static let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appending(path: "Fixtures/web-composition.json")

  static func read() throws -> WebComposition {
    try JSONDecoder().decode(WebComposition.self, from: Data(contentsOf: url))
  }

  func write() throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    try encoder.encode(self).write(to: Self.url, options: .atomic)
  }
}
