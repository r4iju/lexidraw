import EditorModelInterface
import LexicalFuzz
@testable import TextKitEditor
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
  private var keyboard: HardwareKeyboard!

  override func setUp() {
    continueAfterFailure = false
  }

  func testEmojiAliasSuggestionsReplaceTheTypedTrigger() throws {
    guard Self.model == .lexicalSwift else { return }
    open(LexicalJSON.document([LexicalJSON.paragraph([])]))
    editor.typeText(":smile")
    let choice=app.buttons["emoji-option-grinning"]
    XCTAssertTrue(choice.waitForExistence(timeout:5), "The actual source tag search must offer grinning")
    choice.tap()
    editor.typeText("!")
    XCTAssertEqual(try saved(),LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("😀!")])]))
    XCTAssertFalse(app.buttons["emoji-option-grinning"].exists)
  }

  func testCommandShiftLeftSelectsToStartOfLine() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("one two three")])]))
    keyboard.press(.leftArrow, [.command, .shift])
    editor.typeText("X")
    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("X")])]))
  }

  func testCommandShiftRightSelectsToEndOfLine() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("one two three")])]))
    keyboard.press(.leftArrow, .command)
    keyboard.press(.rightArrow, [.command, .shift])
    editor.typeText("X")
    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("X")])]))
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
    keyboard.press("\n", .shift)
    editor.typeText("World")

    XCTAssertEqual(
      try saved(),
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("Hello"), LexicalJSON.lineBreak, LexicalJSON.text("World")])
      ]))
  }

  func testBoldItalicAndUnderlineFromTheHardwareKeyboard() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Plain ")])]))

    keyboard.press("b", .command)
    editor.typeText("bold")
    keyboard.press("b", .command)
    keyboard.press("i", .command)
    editor.typeText("italic")
    keyboard.press("i", .command)
    keyboard.press("u", .command)
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

  func testMarkdownShortcutsWhileTyping() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([])]))

    editor.typeText("# Title\n> Quoted\nPlain **bold** after")

    XCTAssertEqual(
      try saved(),
      LexicalJSON.document([
        LexicalJSON.heading("h1", [LexicalJSON.text("Title")]),
        LexicalJSON.quote([LexicalJSON.text("Quoted")]),
        LexicalJSON.paragraph([
          LexicalJSON.text("Plain "), LexicalJSON.text("bold", format: .bold), LexicalJSON.text(" after"),
        ]),
      ]))
  }

  func testBlockTypesFromTheHardwareKeyboard() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Title")])]))

    keyboard.press("2", [.command, .option])
    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.heading("h2", [LexicalJSON.text("Title")])]))

    keyboard.press("q", [.command, .option])
    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.quote([LexicalJSON.text("Title")])]))

    keyboard.press("0", [.command, .option])
    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Title")])]))
  }

  func testSelectAllThenTypingReplacesEverything() throws {
    open(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("Hello")]), LexicalJSON.paragraph([LexicalJSON.text("World")]),
      ]))

    keyboard.press("a", .command)
    editor.typeText("x")

    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("x")])]))
  }

  func testUndoAndRedoFromTheHardwareKeyboard() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello")])]))
    editor.typeText(" world")

    keyboard.press("z", .command)
    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello")])]))

    keyboard.press("z", [.command, .shift])
    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello world")])]))
  }

  func testMovingByWordAndLine() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("one two three")])]))

    keyboard.press(.leftArrow, .option)
    editor.typeText("X")
    keyboard.press(.leftArrow, .command)
    editor.typeText("Y")
    keyboard.press(.rightArrow, .option)
    editor.typeText("Z")
    keyboard.press(.rightArrow, .command)
    editor.typeText("!")

    XCTAssertEqual(
      try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("YoneZ two Xthree!")])]))
  }

  func testMovingUpAndDown() throws {
    open(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("1234")]), LexicalJSON.paragraph([LexicalJSON.text("5678")]),
      ]))

    keyboard.press(.upArrow)
    editor.typeText("X")
    keyboard.press(.downArrow)
    editor.typeText("Y")

    XCTAssertEqual(
      try saved(),
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("1234X")]), LexicalJSON.paragraph([LexicalJSON.text("5678Y")]),
      ]))
  }

  func testShiftExtendsTheSelection() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello")])]))

    keyboard.press(.leftArrow, .shift)
    keyboard.press(.leftArrow, .shift)
    editor.typeText("p!")

    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Help!")])]))
  }

  func testJoinedEmojiMoveLeftAndDeleteBackwardAsOneCharacter() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("👨‍👩‍👧👍🏽")])]))

    editor.typeText("🇯🇵")
    keyboard.press(.leftArrow)
    keyboard.press(.leftArrow)
    editor.typeText("x")
    editor.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 2))

    XCTAssertEqual(try saved(), LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("👍🏽🇯🇵")])]))
  }

  func testJoinedEmojiMoveRightAsOneCharacter() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("👨‍👩‍👧👍🏽🇯🇵")])]))

    for _ in 0..<3 { keyboard.press(.leftArrow) }
    keyboard.press(.rightArrow)
    editor.typeText("x")
    keyboard.press(.rightArrow)
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

  func testTappingABoxChecksItsItemAndLeavesTheCaret() throws {
    open(
      LexicalJSON.document([
        LexicalJSON.list(.check, [.item([LexicalJSON.text("one")]), .item([LexicalJSON.text("two")])])
      ]))

    tapBox(ofItem: 0)
    editor.typeText("!")

    XCTAssertEqual(
      try saved(),
      LexicalJSON.document([
        LexicalJSON.list(.check, [.item([LexicalJSON.text("one")], checked: true), .item([LexicalJSON.text("two!")])])
      ]))
  }

  func testTabNestsAnItemAndShiftTabBringsItBack() throws {
    let flat = LexicalJSON.document([
      LexicalJSON.list(.bullet, [.item([LexicalJSON.text("one")]), .item([LexicalJSON.text("two")])])
    ])
    open(flat)
    // Tab indents where the caret is at the start of the item; elsewhere it
    // types a tab.
    keyboard.press(.leftArrow, .command)

    keyboard.press(.tab)
    XCTAssertEqual(
      try saved(),
      LexicalJSON.document([
        LexicalJSON.list(
          .bullet, [.item([LexicalJSON.text("one")]), .nested(.bullet, [.item([LexicalJSON.text("two")])])])
      ]))

    keyboard.press(.tab, .shift)
    XCTAssertEqual(try saved(), flat)
  }

  /// A table from the edit menu's Table menu, typed into cell by cell with
  /// Tab and Shift-Tab, then given and relieved of rows and columns there.
  func testTablesFromTheEditMenu() throws {
    open(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Hello")])]))

    chooseFromEditMenu(at: CGPoint(x: 16 + 20, y: 16 + 11), "Table", "Insert Table…")
    for (name, count) in [("Rows", "2"), ("Columns", "2")] {
      let field = app.alerts.textFields[name]
      field.tap()
      field.typeText(XCUIKeyboardKey.delete.rawValue + count)
    }
    app.alerts.buttons["Insert Table"].tap()
    editor.typeText("a")
    keyboard.press(.tab)
    editor.typeText("b")
    keyboard.press(.tab)
    editor.typeText("c")
    keyboard.press(.tab, .shift)
    editor.typeText("!")
    XCTAssertEqual(try cellTexts(), [["a", "b!"], ["c", ""]])

    chooseFromEditMenu(at: Self.firstCell(row: 1), "Table", "Insert Row Above")
    chooseFromEditMenu(at: Self.firstCell(row: 0), "Table", "Insert Column Right")
    chooseFromEditMenu(at: Self.firstCell(row: 2), "Table", "Delete Row")
    XCTAssertEqual(try cellTexts(), [["a", "", "b!"], ["", "", ""]])
    chooseFromEditMenu(at: Self.firstCell(row: 0), "Table", "Delete Column")
    XCTAssertEqual(try cellTexts(), [["", "b!"], ["", ""]])
  }

  func testTableHeadersColourAndDeletionFromTheEditMenu() throws {
    open(LexicalJSON.document([LexicalJSON.table([["a", "b"], ["c", "d"]]), LexicalJSON.paragraph([])]))
    chooseFromEditMenu(at: Self.inLetter(column: 0), "Table", "Header Row")
    XCTAssertEqual(try savedNode([0, 0, 1])?["headerState"], 1)
    chooseFromEditMenu(at: Self.inLetter(column: 0), "Table", "Header Column")
    XCTAssertEqual(try savedNode([0, 1, 0])?["headerState"], 2)
    chooseFromEditMenu(at: Self.inLetter(column: 0), "Table", "Cell Background Colour…")
    app.alerts.textFields["Colour"].tap()
    app.alerts.textFields["Colour"].typeText("#123456")
    app.alerts.buttons["Apply"].tap()
    XCTAssertEqual(try savedNode([0, 0, 0])?["backgroundColor"], "#123456")
    chooseFromEditMenu(at: Self.inLetter(column: 0), "Table", "Delete Table")
    XCTAssertEqual(try saved()["root"]?["children"]?.arrayValue?.compactMap { $0["type"]?.stringValue }, ["paragraph"])
  }

  func testMergesCellsFromTheEditMenu() throws {
    open(LexicalJSON.document([LexicalJSON.table([["a", "b"], ["c", "d"]]), LexicalJSON.paragraph([])]))
    tap(Self.inLetter(column: 0))
    keyboard.press(.downArrow, .shift)
    keyboard.press(.rightArrow, .shift)
    editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: Self.inLetter(column: 0).x, dy: Self.inLetter(column: 0).y)).press(forDuration: 1)
    chooseShownEditMenu(["Table", "Merge Cells"])
    XCTAssertEqual(try savedNode([0, 0, 0])?["colSpan"], 2)
  }

  func testUnmergesACellFromTheEditMenu() throws {
    let cell = LexicalJSON.element("tablecell", [LexicalJSON.paragraph([LexicalJSON.text("a")])], ["colSpan": 2, "rowSpan": 1, "headerState": 0, "backgroundColor": nil])
    let table = LexicalJSON.element("table", [LexicalJSON.element("tablerow", [cell])])
    open(LexicalJSON.document([table, LexicalJSON.paragraph([])]))
    tap(Self.inLetter(column: 0))
    editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: Self.inLetter(column: 0).x, dy: Self.inLetter(column: 0).y)).press(forDuration: 1)
    chooseShownEditMenu(["Table", "Unmerge Cells"])
    XCTAssertEqual(try savedNode([0, 0])?["children"]?.arrayValue?.count, 2)
    XCTAssertEqual(try savedNode([0, 0, 0])?["colSpan"], 1)
  }

  func testInsertsSelectedRowsFromTheEditMenu() throws {
    open(LexicalJSON.document([LexicalJSON.table([["a", "b"], ["c", "d"]]), LexicalJSON.paragraph([])]))
    tap(Self.inLetter(column: 0))
    keyboard.press(.downArrow, .shift)
    keyboard.press(.downArrow, .shift)
    editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: Self.inLetter(column: 0).x, dy: Self.inLetter(column: 0).y)).press(forDuration: 1)
    chooseShownEditMenu(["Table", "Insert 2 Rows Below"])
    XCTAssertEqual(try savedNode([0])?["children"]?.arrayValue?.count, 4)
  }

  func testInsertsSelectedColumnsFromTheEditMenu() throws {
    for direction in ["Left", "Right"] {
      open(LexicalJSON.document([LexicalJSON.table([["a", "b"], ["c", "d"]]), LexicalJSON.paragraph([])]))
      tap(Self.inLetter(column: 0))
      keyboard.press(.downArrow, .shift)
      keyboard.press(.rightArrow, .shift)
      editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: Self.inLetter(column: 0).x, dy: Self.inLetter(column: 0).y)).press(forDuration: 1)
      chooseShownEditMenu(["Table", "Insert 2 Columns \(direction)"])
      XCTAssertEqual(try savedNode([0, 0])?["children"]?.arrayValue?.count, 4)
    }
  }

  /// Shift and Down at a cell's last line select the cell, as
  /// @lexical/table's handler does, and then Shift and an arrow move the
  /// selection's focus a cell at a time. What Command-B makes bold shows
  /// which cells were selected, and Command-I which were after.
  func testShiftArrowsMakeAndChangeATableSelection() throws {
    open(LexicalJSON.document([LexicalJSON.table([["a", "b"], ["c", "d"]]), LexicalJSON.paragraph([])]))
    tap(Self.inLetter(column: 0))

    keyboard.press(.downArrow, .shift)
    keyboard.press(.downArrow, .shift)
    keyboard.press(.rightArrow, .shift)
    keyboard.press("b", .command)
    XCTAssertEqual(try cells(formatted: .bold), [[true, true], [true, true]])

    keyboard.press(.leftArrow, .shift)
    keyboard.press("i", .command)
    XCTAssertEqual(try cells(formatted: .italic), [[true, false], [true, false]])
  }

  /// The handle at the end of selected cells, dragged into another cell,
  /// selects the cells up to it.
  func testDraggingAHandleChangesATableSelection() throws {
    open(LexicalJSON.document([LexicalJSON.table([["a", "b", "c"]]), LexicalJSON.paragraph([])]))
    tap(Self.inLetter(column: 0))
    keyboard.press(.downArrow, .shift)

    dragHandle(from: Self.letterEnd(column: 0), to: Self.inLetter(column: 2))
    keyboard.press("b", .command)
    XCTAssertEqual(try cells(formatted: .bold), [[true, true, true]])

    dragHandle(from: Self.letterEnd(column: 2), to: Self.inLetter(column: 1))
    keyboard.press("i", .command)
    XCTAssertEqual(try cells(formatted: .italic), [[true, true, false]])
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
        for shortcut in script.shortcuts { keyboard.press(shortcut.key, shortcut.modifiers) }
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
    // Readied only by the first key a script presses: once a hardware key is
    // down, the Japanese keyboard types a space as U+3000.
    keyboard = HardwareKeyboard(app, typingInto: editor)
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

  /// Taps the box of item `item` of a checklist at the top of the document,
  /// its items one line each.
  private func tapBox(ofItem item: Int) {
    let em: CGFloat = 17
    let list = ListAndIndentLayout.list
    let x = 16 + (list.padding + list.box.size / 2) * em
    editor.coordinate(withNormalizedOffset: .zero)
      .withOffset(CGVector(dx: x, dy: 16 + 11 + CGFloat(item) * (22 + list.itemSpacing * em))).tap()
  }

  /// A point in the first cell of `row` of a table below one line of text,
  /// past the table's margin, its rows a line of table text tall.
  private static func firstCell(row: Int) -> CGPoint {
    let em: CGFloat = 17
    let (web, table) = (DocumentTypography.web, DocumentTypography.web.table)
    let top = 16 + (web.lineHeight + table.margin) * em
    let rowHeight = 2 * table.paddingY + table.fontSize * table.lineHeight * em + table.border
    return CGPoint(x: 16 + 16, y: top + rowHeight * (CGFloat(row) + 0.5))
  }

  /// Where the letter in a cell of the first row of a table of letters at
  /// the top of the document ends, at the foot of the line, where UIKit
  /// takes hold of the handle there. Points from the editor's top left.
  private static func letterEnd(column: Int) -> CGPoint {
    let start = cellStart(column: column)
    return CGPoint(x: start.x + 1 + 12 + 8.5, y: start.y + 15 * 1.5 / 2)
  }

  private static func inLetter(column: Int) -> CGPoint {
    let start = cellStart(column: column)
    return CGPoint(x: start.x + 1 + 12 + 4, y: start.y)
  }

  /// The left edge of a cell of the first row of a table of letters,
  /// halfway down it. A cell of one letter is as wide as the letter and its
  /// padding, which no least width widens on the web.
  private static func cellStart(column: Int) -> CGPoint {
    CGPoint(x: 16 + 34.5 * CGFloat(column), y: 16 + (8 + 15 * 1.5 + 8 + 1) / 2)
  }

  private func tap(_ point: CGPoint) {
    editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y)).tap()
  }

  /// Drags the selection handle at `start` to `end`, points from the
  /// editor's top left.
  private func dragHandle(from start: CGPoint, to end: CGPoint) {
    let origin = editor.coordinate(withNormalizedOffset: .zero)
    origin.withOffset(CGVector(dx: start.x, dy: start.y)).press(
      forDuration: 0.1, thenDragTo: origin.withOffset(CGVector(dx: end.x, dy: end.y)), withVelocity: .slow,
      thenHoldForDuration: 0.3)
  }

  /// Whether each cell of the saved document's table has `format`, row by
  /// row.
  private func cells(formatted format: TextFormat) throws -> [[Bool]] {
    let blocks = try saved()["root"]?["children"]?.arrayValue ?? []
    return (blocks.first { $0["type"] == "table" }?["children"]?.arrayValue ?? []).map { row in
      (row["children"]?.arrayValue ?? []).map { cell in
        let texts = (cell["children"]?.arrayValue ?? []).flatMap { $0["children"]?.arrayValue ?? [] }
        return !texts.isEmpty
          && texts.allSatisfy { TextFormat(rawValue: Int($0["format"]?.numberValue ?? 0)).contains(format) }
      }
    }
  }

  /// Double-taps the word at `point`, points from the editor's top left, for
  /// the edit menu, then chooses `path` from it.
  private func chooseFromEditMenu(at point: CGPoint, _ path: String...) {
    editor.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y)).doubleTap()
    chooseShownEditMenu(path)
  }

  private func chooseShownEditMenu(_ path: [String]) {
    for title in path {
      // An item of the menu's row, or of the list the row opens into.
      let item = app.descendants(matching: .any).matching(
        NSPredicate(
          format: "label == %@ AND elementType IN %@", title,
          [XCUIElement.ElementType.menuItem.rawValue, XCUIElement.ElementType.button.rawValue])
      ).firstMatch
      // A narrow screen pages the menu: its row on iOS 26, into a list on
      // iOS 27.
      let forward = app.buttons.matching(NSPredicate(format: "label IN %@", ["Forward", "Next Page"])).firstMatch
      let shown = XCTNSPredicateExpectation(
        predicate: NSPredicate { _, _ in item.exists || forward.exists }, object: nil)
      _ = XCTWaiter.wait(for: [shown], timeout: 5)
      for _ in 0..<4 where !item.exists && forward.exists {
        forward.tap()
        _ = item.waitForExistence(timeout: 1)
      }
      XCTAssertTrue(item.waitForExistence(timeout: 5), "No \(title) in the edit menu: \(app.debugDescription)")
      // The list's last items can be under the keyboard until it scrolls.
      for _ in 0..<3 where !item.isHittable {
        let screen = app.coordinate(withNormalizedOffset: .zero)
        let visibleBottom = app.keyboards.firstMatch.exists ? app.keyboards.firstMatch.frame.minY : app.frame.maxY
        let list = CGVector(dx: item.frame.midX, dy: min(item.frame.minY - 60, visibleBottom - 100))
        screen.withOffset(list).press(forDuration: 0.1, thenDragTo: screen.withOffset(CGVector(dx: list.dx, dy: list.dy - 150)))
      }
      item.tap()
    }
  }

  /// The text of each cell of the saved document's table, row by row.
  private func cellTexts() throws -> [[String]] {
    let blocks = try saved()["root"]?["children"]?.arrayValue ?? []
    XCTAssertEqual(blocks.compactMap { $0["type"]?.stringValue }, ["paragraph", "table", "paragraph"])
    return (blocks.first { $0["type"] == "table" }?["children"]?.arrayValue ?? []).map { row in
      (row["children"]?.arrayValue ?? []).map { cell in
        (cell["children"]?.arrayValue ?? []).flatMap { block in
          (block["children"]?.arrayValue ?? []).compactMap { $0["text"]?.stringValue }
        }.joined()
      }
    }
  }

  private func savedNode(_ path: [Int]) throws -> JSONValue? {
    path.reduce(try saved()["root"]) { node, index in
      guard let children = node?["children"]?.arrayValue, children.indices.contains(index) else { return nil }
      return children[index]
    }
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
