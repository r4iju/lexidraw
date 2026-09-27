import XCTest

/// The app's document screen in the harness, on a document its server
/// serves with the access each test gives.
@MainActor
final class DocumentPreviewUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  /// Edits aren't saved in the preview, and the screen says so for as long
  /// as the document is open, keyboard up or not.
  func testAnEditableDocumentSaysItsChangesArentSaved() {
    let app = open(access: "EDIT")
    let notice = app.staticTexts["Preview: changes aren’t saved"]
    XCTAssertTrue(notice.waitForExistence(timeout: 10))

    let editor = app.textViews.firstMatch
    editor.tap()
    editor.typeText("Typed in the preview")

    XCTAssertTrue(notice.isHittable)
  }

  /// A document the user may only read says so, since typing does nothing.
  func testAReadOnlyDocumentSaysItIsReadOnly() {
    let app = open(access: "READ")

    XCTAssertTrue(app.staticTexts["Read only"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["Preview: changes aren’t saved"].exists)
  }

  private func open(access: String) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment["EDITOR_PREVIEW_ACCESS"] = access
    app.launch()
    return app
  }
}
