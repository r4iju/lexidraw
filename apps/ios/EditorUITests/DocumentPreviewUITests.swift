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

  /// Every edit would be refused, so the keyboard isn't offered, and the
  /// screen says why.
  func testADocumentTheAppCantEditYetOpensReadOnly() {
    let document = LexicalJSON.document([
      LexicalJSON.paragraph([LexicalJSON.text("Watch this")]), LexicalJSON.youtube("dQw4w9WgXcQ"),
    ])
    let app = open(access: "EDIT", document: document)

    XCTAssertTrue(app.staticTexts["Read only: this document has parts the app can’t edit yet"].waitForExistence(timeout: 10))
    XCTAssertFalse(app.staticTexts["Preview: changes aren’t saved"].exists)
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
}
