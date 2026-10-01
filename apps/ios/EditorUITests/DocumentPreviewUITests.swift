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

  func testSlideNavigationRestoresTheActiveSlideAndOnlySavesEditableNavigation() {
    let document = LexicalJSON.document([["type": "slide-deck", "version": 1,
      "data": ["currentSlideId": "second", "slides": [
        ["id": "first", "elements": []], ["id": "second", "elements": []]
      ]]]])
    for access in ["EDIT", "READ"] {
      let app = open(access: access, document: document)
      let current = app.buttons["Slide 2 of 2"]
      XCTAssertTrue(current.waitForExistence(timeout: 10))
      current.tap()
      app.buttons["Slide 1"].tap()
      XCTAssertTrue(app.buttons["Slide 1 of 2"].waitForExistence(timeout: 5))
      if access == "EDIT" {
        let saved = NSPredicate(format: "label CONTAINS %@", "entities-save")
        expectation(for: saved, evaluatedWith: app.staticTexts["server requests"])
        waitForExpectations(timeout: 10)
      } else { XCTAssertEqual(requests(in: app), "entities-load") }
      app.terminate()
    }
  }

  func testMixedTextAndSlideControlsRemainAccessibleAndAutosave() {
    let document = LexicalJSON.document([
      ["type": "paragraph", "version": 1, "children": [["type": "text", "version": 1, "text": "Mixed text remains editable", "format": 0, "detail": 0, "mode": "normal", "style": ""]]],
      ["type": "slide-deck", "version": 1, "data": ["currentSlideId": "second", "slides": [
        ["id": "first", "elements": []], ["id": "second", "elements": []]
      ]]]
    ])
    let app = open(access: "EDIT", document: document)
    XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 10))
    XCTAssertTrue((app.textViews.firstMatch.value as? String)?.contains("Mixed text remains editable") == true)
    let current = app.buttons["Slide 2 of 2"]
    XCTAssertTrue(current.waitForExistence(timeout: 5))
    current.tap()
    app.buttons["Slide 1"].tap()
    XCTAssertTrue(app.buttons["Slide 1 of 2"].waitForExistence(timeout: 5))
    let saved = NSPredicate(format: "label CONTAINS %@", "entities-save")
    expectation(for: saved, evaluatedWith: app.staticTexts["server requests"])
    waitForExpectations(timeout: 10)
  }

  func testSlideDragAndCornerResizeAutosaveGeometry() {
    let content = LexicalJSON.document([["type": "paragraph", "version": 1, "children": [["type": "text", "version": 1, "text": "Move me", "format": 0, "detail": 0, "mode": "normal", "style": ""]]]])
    let document = LexicalJSON.document([["type": "slide-deck", "version": 1, "data": ["currentSlideId": "first", "slides": [["id": "first", "elements": [["id": "box", "kind": "box", "x": 100, "y": 100, "width": 400, "height": 120, "zIndex": 0, "backgroundColor": "yellow", "editorStateJSON": content]]]]]]])
    let app = open(access: "EDIT", document: document)
    let text = app.textViews.matching(NSPredicate(format: "value CONTAINS %@", "Move me")).firstMatch
    XCTAssertTrue(text.waitForExistence(timeout: 10))
    let before = XCTAttachment(screenshot: app.screenshot())
    before.name = "Native slide before drag and resize"
    before.lifetime = .keepAlways
    add(before)
    let start = text.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: 50, dy: 30)))
    let saved = NSPredicate(format: "label CONTAINS %@", "entities-save")
    expectation(for: saved, evaluatedWith: app.staticTexts["server requests"])
    waitForExpectations(timeout: 10)
    let originalWidth = text.frame.width
    let edge = text.coordinate(withNormalizedOffset: CGVector(dx: 1, dy: 1))
    edge.press(forDuration: 0.1, thenDragTo: edge.withOffset(CGVector(dx: 30, dy: 20)))
    let savedTwice = NSPredicate(format: "label MATCHES %@", ".*entities-save.*entities-save.*")
    expectation(for: savedTwice, evaluatedWith: app.staticTexts["server requests"])
    waitForExpectations(timeout: 10)
    XCTAssertGreaterThan(text.frame.width, originalWidth + 10)
    let after = XCTAttachment(screenshot: app.screenshot())
    after.name = "Native slide after drag and resize"
    after.lifetime = .keepAlways
    add(after)
  }

  func testSlideElementsOfferAccessibleActionsWithoutCanvasGestures() {
    let element: JSONValue = ["id": "image", "kind": "image", "x": 10, "y": 20,
      "width": 200, "height": 100, "zIndex": 0, "url": ""]
    let slide: JSONValue = ["id": "first", "elements": [element]]
    let document = LexicalJSON.document([["type": "slide-deck", "version": 1,
      "data": ["currentSlideId": "first", "slides": [slide]]]])
    let app = open(access: "EDIT", document: document)
    let actions = app.buttons["Slide element 1, image actions"]
    XCTAssertTrue(actions.waitForExistence(timeout: 10))
    actions.tap()
    XCTAssertTrue(app.buttons["Edit content"].exists)
    XCTAssertTrue(app.buttons["Bring to front"].exists)
    XCTAssertTrue(app.buttons["Delete element"].exists)
    app.buttons["Position and size"].tap()
    XCTAssertTrue(app.alerts["Position and size"].waitForExistence(timeout: 5))
    app.alerts["Position and size"].buttons["Cancel"].tap()
    XCTAssertFalse(requests(in: app).contains("entities-save"))
    app.terminate()
    let readOnly = open(access: "READ", document: document)
    XCTAssertTrue(readOnly.staticTexts["Slide element 1, image"].waitForExistence(timeout: 10))
    XCTAssertFalse(readOnly.buttons["Slide element 1, image actions"].exists)
    XCTAssertFalse(requests(in: readOnly).contains("entities-save"))
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
