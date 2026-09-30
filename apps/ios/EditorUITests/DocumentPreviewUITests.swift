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

  /// The operations the harness's server was asked for, in order.
  private func requests(in app: XCUIApplication) -> String {
    app.staticTexts["server requests"].label
  }
}
