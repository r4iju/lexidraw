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

  func testAnEditableDocumentSaysItsChangesArentSavedAndSendsNothing() {
    let app = open(access: "EDIT")
    let notice = app.staticTexts["Preview: changes aren’t saved"]
    XCTAssertTrue(notice.waitForExistence(timeout: 10))

    let editor = app.textViews.firstMatch
    editor.tap()
    editor.typeText("Typed in the preview")

    XCTAssertTrue(notice.isHittable)
    XCTAssertEqual(requests(in: app), "entities-load")
  }

  func testAReadOnlyDocumentSaysItIsReadOnly() {
    let app = open(access: "READ")

    XCTAssertTrue(app.staticTexts["Read only"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["Preview: changes aren’t saved"].exists)
    XCTAssertFalse(offersKeyboard(app))
  }

  func testADocumentTheAppCantEditYetOpensReadOnlyAndShowsWhatItCantShowYet() {
    let document = LexicalJSON.document([
      LexicalJSON.paragraph([LexicalJSON.text("Watch this")]), LexicalJSON.youtube("dQw4w9WgXcQ"),
    ])
    let app = open(access: "EDIT", document: document)

    XCTAssertTrue(app.staticTexts["Read only: this document has parts the app can’t edit yet"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["Preview: changes aren’t saved"].exists)
    XCTAssertTrue((app.textViews.firstMatch.value as? String)?.contains("youtube") == true)
    XCTAssertFalse(offersKeyboard(app))
  }

  /// Loaded again, here once shared to read only, the screen shows the
  /// second load, not the editor the first one made.
  func testASecondLoadReplacesWhatIsShown() {
    let app = open(access: "EDIT,READ")
    XCTAssertTrue(app.staticTexts["Preview: changes aren’t saved"].waitForExistence(timeout: 10))

    app.buttons["Away"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()

    XCTAssertTrue(app.staticTexts["Read only"].waitForExistence(timeout: 10))
    XCTAssertEqual(requests(in: app), "entities-load entities-load")
    XCTAssertFalse(offersKeyboard(app))
  }

  func testADocumentTheAppCantReadSaysSoWithoutARetry() {
    let app = open(access: "EDIT", document: ["root": ["type": "paragraph", "version": 1, "children": []]])

    XCTAssertTrue(app.staticTexts["Can’t open the document"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.buttons["Try Again"].exists)
  }

  private func open(access: String, document: JSONValue? = nil) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["EDITOR_PREVIEW_ACCESS"] = access
    if let document {
      app.launchEnvironment["EDITOR_DOCUMENT"] = String(decoding: try! JSONEncoder().encode(document), as: UTF8.self)
    }
    app.launch()
    return app
  }

  /// Whether a tap gives the editor the keyboard, the hardware one included.
  private func offersKeyboard(_ app: XCUIApplication) -> Bool {
    let editor = app.textViews.firstMatch
    editor.tap()
    let focused = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hasKeyboardFocus == true"), object: editor)
    return XCTWaiter().wait(for: [focused], timeout: 3) == .completed
  }

  /// The operations the harness's server was asked for, in order.
  private func requests(in app: XCUIApplication) -> String {
    app.staticTexts["server requests"].label
  }
}
