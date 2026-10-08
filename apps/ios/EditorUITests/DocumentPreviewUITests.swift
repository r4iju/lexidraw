import EditorModelInterface
import LexicalFuzz
import XCTest

/// The app's document screen in the harness, on a document its server
/// serves with the access each test gives.
@MainActor
final class DocumentPreviewUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  func testHideKeyboardKeepsTheDocumentOpenAndCanResumeEditing() {
    let app = open(access: "EDIT")
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    let editor = app.textViews.firstMatch
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    let before = editor.value as? String
    let hide = app.buttons["editor hide keyboard"]
    XCTAssertTrue(hide.waitForExistence(timeout: 3))
    XCTAssertTrue(hide.isHittable)
    hide.tap()
    expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: app.keyboards.firstMatch)
    waitForExpectations(timeout: 5)
    XCTAssertTrue(editor.exists)
    XCTAssertEqual(editor.value as? String, before)
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
  }

  func testRealDocumentPredictionAcceptanceUndoesOneReplacement() throws {
    let original = LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("prefix ")])])
    let app = open(access: "EDIT", document: original)
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    let editor = app.textViews.firstMatch
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    if app.buttons["Continue"].exists { app.buttons["Continue"].tap() }
    for character in "hel" {
      let lower = app.keyboards.keys[String(character)]
      let key = lower.exists ? lower : app.keyboards.keys[String(character).uppercased()]
      XCTAssertTrue(key.isHittable)
      key.tap()
    }
    XCTAssertTrue((editor.value as? String)?.lowercased().contains("hel") == true)
    let beforeAcceptance = try XCTUnwrap(editor.value as? String)
    let prediction = app.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", "Hello")).firstMatch
    XCTAssertTrue(prediction.waitForExistence(timeout: 3), "\(app.keyboards.debugDescription)")
    XCTAssertTrue(prediction.isHittable)
    prediction.tap()
    XCTAssertTrue((editor.value as? String)?.lowercased().contains("hello") == true)
    editor.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: [])
    editor.typeKey(XCUIKeyboardKey.F13.rawValue, modifierFlags: .shift)
    editor.typeKey("z", modifierFlags: .command)
    XCTAssertEqual(editor.value as? String, beforeAcceptance)
  }


  /// Real QuickPath drags. The simulator delivers the first word and its
  /// space as separate calls, then each later word as one `insertText` (#236).
  func testRealDocumentSwipedWordsUndoAndRedoTogether() throws {
    let original = LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("Say ")])])
    let app = open(access: "EDIT", document: original)
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    let editor = app.textViews.firstMatch
    editor.tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    if app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
    func swipe(_ from: String, _ to: String) {
      func key(_ name: String) -> XCUICoordinate {
        let lower = app.keyboards.keys[name]
        return (lower.exists ? lower : app.keyboards.keys[name.uppercased()])
          .coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
      }
      key(from).press(forDuration: 0.05, thenDragTo: key(to), withVelocity: 300, thenHoldForDuration: 0.05)
    }
    swipe("t", "o")
    let afterFirstWord = try XCTUnwrap(editor.value as? String)
    swipe("w", "e")
    swipe("t", "o")
    let swiped = try XCTUnwrap(editor.value as? String)
    XCTAssertEqual(swiped.split(separator: " ").count, afterFirstWord.split(separator: " ").count + 2)
    editor.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: [])
    editor.typeKey(XCUIKeyboardKey.F13.rawValue, modifierFlags: .shift)
    editor.typeKey("z", modifierFlags: .command)
    XCTAssertEqual(editor.value as? String, afterFirstWord)
    editor.typeKey("z", modifierFlags: [.command, .shift])
    XCTAssertEqual(editor.value as? String, swiped)
  }

  func testAnEditableDocumentAutosavesItsChanges() {
    let app = open(access: "EDIT")
    let notice = app.staticTexts["Saved"]
    XCTAssertTrue(notice.waitForExistence(timeout: 10))

    XCTAssertTrue(offersKeyboard(app))
    app.textViews.firstMatch.typeText("Typed in the document")

    let saved = NSPredicate(format: "label CONTAINS %@", "entities-save")
    expectation(for: saved, evaluatedWith: app.staticTexts["server requests"])
    waitForExpectations(timeout: 10)
    XCTAssertTrue(notice.waitForExistence(timeout: 10))
    XCTAssertEqual(requests(in: app), "entities-load entities-save")
  }

  func testAReadOnlyDocumentSaysItIsReadOnly() {
    let app = open(access: "READ")

    XCTAssertTrue(app.staticTexts["Read only"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["Preview: changes aren’t saved"].exists)
    XCTAssertFalse(offersKeyboard(app))
  }

  /// Reading is what a read-only document is for, so a word pressed on is
  /// selected and offered to copy, and nothing that would edit is offered.
  func testAReadOnlyDocumentOffersToCopyWhatIsSelected() {
    let app = open(access: "READ")
    XCTAssertTrue(app.staticTexts["Read only"].waitForExistence(timeout: 10))

    app.textViews.firstMatch.press(forDuration: 1)

    XCTAssertTrue(app.menuItems["Copy"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.menuItems["Cut"].exists)
    XCTAssertFalse(app.menuItems["Paste"].exists)
    XCTAssertEqual(app.keyboards.count, 0)
  }

  func testADocumentTheAppCantEditYetOpensReadOnlyAndShowsWhatItCantShowYet() {
    let document = LexicalJSON.document([
      LexicalJSON.paragraph([LexicalJSON.text("Watch this")]), ["type": "unported-widget", "version": 1],
    ])
    let app = open(access: "EDIT", document: document)

    XCTAssertTrue(
      app.staticTexts["Read only: this document has parts the app can’t edit yet"].waitForExistence(
        timeout: 10))
    XCTAssertFalse(app.staticTexts["Preview: changes aren’t saved"].exists)
    XCTAssertTrue((app.textViews.firstMatch.value as? String)?.contains("unported-widget") == true)
    XCTAssertFalse(offersKeyboard(app))
  }

  /// Loaded again, here once shared to read only, the screen shows the
  /// second load, not the editor the first one made.
  func testASecondLoadReplacesWhatIsShown() {
    let app = open(access: "EDIT,READ")
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))

    app.buttons["Away"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()

    XCTAssertTrue(app.staticTexts["Read only"].waitForExistence(timeout: 10))
    XCTAssertEqual(requests(in: app), "entities-load entities-load")
    XCTAssertFalse(offersKeyboard(app))
  }

  func testADocumentTheAppCantReadSaysSoWithoutARetry() {
    let app = open(
      access: "EDIT", document: ["root": ["type": "paragraph", "version": 1, "children": []]])

    XCTAssertTrue(app.staticTexts["Can’t open the document"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["Try Again"].exists)
  }

  func testFractionalColumnsBelowOneLeaveTheRemainingSpaceEmpty() {
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "children": []]
    let item: JSONValue = ["type": "layout-item", "version": 1, "children": [paragraph]]
    let document = LexicalJSON.document([["type": "layout-container", "version": 1,
      "templateColumns": "0.25fr 0.25fr", "children": [item, item]]])
    let app = open(access: "EDIT", document: document)
    let column = app.buttons["Edit column 1"]
    XCTAssertTrue(column.waitForExistence(timeout: 10))
    XCTAssertGreaterThan(app.frame.width, 600)
    XCTAssertGreaterThan(column.frame.width, app.frame.width * 0.15)
    XCTAssertLessThan(column.frame.width, app.frame.width * 0.35)
  }

  func testRepeatedMinmaxColumnsKeepTheirImplicitRows() {
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "children": []]
    let item: JSONValue = ["type": "layout-item", "version": 1, "children": [paragraph]]
    let document = LexicalJSON.document([["type": "layout-container", "version": 1,
      "templateColumns": "repeat(2, minmax(100px, 1fr))", "children": [item, item, item, item]]])
    let app = open(access: "EDIT", document: document)
    let first = app.buttons["Edit column 1"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    let second = app.buttons["Edit column 2"]
    let third = app.buttons["Edit column 3"]
    XCTAssertTrue(third.exists)
    XCTAssertEqual(first.frame.width, second.frame.width, accuracy: 1)
    XCTAssertGreaterThan(first.frame.width, 100)
    XCTAssertEqual(third.frame.minX, first.frame.minX, accuracy: 1)
    XCTAssertGreaterThan(third.frame.minY, first.frame.maxY)
  }

  func testImportedColumnsRetainFixedPercentageAndFractionalTracks() {
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "children": []]
    let item: JSONValue = ["type": "layout-item", "version": 1, "children": [paragraph]]
    let document = LexicalJSON.document([["type": "layout-container", "version": 1,
      "templateColumns": "100px 25% 0.5fr", "children": [item, item, item]]])
    let app = open(access: "EDIT", document: document)
    let first = app.buttons["Edit column 1"]
    XCTAssertTrue(first.waitForExistence(timeout: 10))
    XCTAssertGreaterThan(app.frame.width, 600)
    XCTAssertEqual(first.frame.width, 82, accuracy: 1) // 100px track minus the source border and padding.
    let percentage = app.buttons["Edit column 2"].frame.width
    XCTAssertGreaterThan(percentage, app.frame.width * 0.15)
    XCTAssertLessThan(percentage, app.frame.width * 0.3)
    XCTAssertTrue(app.buttons["Edit column 3"].exists)
  }

  private func open(access: String, document: JSONValue? = nil) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["EDITOR_PREVIEW_ACCESS"] = access
    if let document {
      app.launchEnvironment["EDITOR_DOCUMENT"] = String(
        decoding: try! JSONEncoder().encode(document), as: UTF8.self)
    }
    app.launch()
    return app
  }

  /// Whether a tap on the editor brings up the keyboard. A read-only editor
  /// still takes focus, for its text to be selected and copied.
  private func offersKeyboard(_ app: XCUIApplication) -> Bool {
    app.textViews.firstMatch.tap()
    return app.keyboards.firstMatch.waitForExistence(timeout: 3)
  }

  /// Document operations, excluding the independent account identity read.
  private func requests(in app: XCUIApplication) -> String {
    app.staticTexts["server requests"].label.split(separator: " ").filter { $0 != "auth-me" }.joined(separator: " ")
  }
}
