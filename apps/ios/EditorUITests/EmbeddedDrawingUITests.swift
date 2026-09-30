import EditorModelInterface
import LexicalFuzz
import XCTest

@MainActor final class EmbeddedDrawingUITests: XCTestCase {
  private var app: XCUIApplication!
  private var savedURL: URL!
  private let scene: JSONValue = [
    "elements": [["type": "rectangle", "id": "box", "x": 0, "y": 0, "width": 120, "height": 60,
      "angle": 0, "strokeColor": "#1e1e1e", "backgroundColor": "transparent", "fillStyle": "solid",
      "strokeWidth": 1, "strokeStyle": "solid", "roughness": 0, "opacity": 100, "seed": 1,
      "version": 1, "versionNonce": 1, "isDeleted": false, "groupIds": [], "boundElements": nil,
      "updated": 1, "link": nil, "locked": false]],
    "appState": ["viewBackgroundColor": "#ffffff", "name": "disposable embedded drawing"], "files": [:],
  ]

  override func setUp() { continueAfterFailure = false }

  func testSavingTheNativeDrawingUpdatesItsDocumentNode() throws {
    open()
    let before = try savedDrawing()
    openDrawing()
    app.buttons["Rectangle"].tap()
    point(0.15, 0.25).press(forDuration: 0.1, thenDragTo: point(0.35, 0.4))
    app.buttons["save embedded drawing"].tap()
    XCTAssertTrue(app.buttons["save embedded drawing"].waitForNonExistence(timeout: 5))
    let after = try savedDrawing()
    let updated = try JSONValue(parsing: XCTUnwrap(after["data"]?.stringValue))
    XCTAssertEqual(updated["elements"]?.arrayValue?.count, 2)
    XCTAssertEqual(updated["appState"]?["name"], scene["appState"]?["name"])
    XCTAssertEqual(after["width"], before["width"])
    XCTAssertEqual(after["height"], before["height"])
    XCTAssertEqual(after["$"]?["figure"]?["caption"], "Stored drawing caption")
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = "Embedded drawing after native Save"
    image.lifetime = .keepAlways
    add(image)
  }

  func testDiscardingTheNativeDrawingPreservesTheDocumentScene() throws {
    open()
    let before = try savedDrawing()
    openDrawing()
    app.buttons["Rectangle"].tap()
    point(0.15, 0.25).press(forDuration: 0.1, thenDragTo: point(0.35, 0.4))
    app.buttons["Cancel"].tap()
    XCTAssertTrue(app.buttons["Discard Changes"].waitForExistence(timeout: 5))
    app.buttons["Discard Changes"].tap()
    XCTAssertTrue(app.navigationBars["Drawing"].waitForNonExistence(timeout: 5))
    XCTAssertEqual(try savedDrawing(), before)
  }

  private func open() {
    let drawing: JSONValue = ["type": "excalidraw", "version": 1, "data": .string(scene.stringified),
      "width": 240, "height": 180, "$": ["figure": ["caption": "Stored drawing caption"]]]
    let document = LexicalJSON.document([LexicalJSON.paragraph([drawing]), LexicalJSON.paragraph([LexicalJSON.text("After drawing")])])
    app = XCUIApplication()
    savedURL = FileManager.default.temporaryDirectory.appending(path: "drawing-\(UUID().uuidString).json")
    app.launchEnvironment["EDITOR_DOCUMENT"] = document.stringified
    app.launchEnvironment["EDITOR_SAVE_PATH"] = savedURL.path
    app.launch()
    XCTAssertTrue(app.textViews["editor"].waitForExistence(timeout: 10))
  }

  private func openDrawing() {
    let editor = app.textViews["editor"]
    editor.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0)).withOffset(CGVector(dx: 0, dy: 70)).tap()
    XCTAssertTrue(app.buttons["save embedded drawing"].waitForExistence(timeout: 5))
  }

  private func savedDrawing() throws -> JSONValue {
    if FileManager.default.fileExists(atPath: savedURL.path) { try FileManager.default.removeItem(at: savedURL) }
    app.buttons["Save"].tap()
    let deadline = Date().addingTimeInterval(5)
    while !FileManager.default.fileExists(atPath: savedURL.path), Date() < deadline {
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    let state = try JSONValue(parsing: String(contentsOf: savedURL, encoding: .utf8))
    return try XCTUnwrap(state["root"]?["children"]?.arrayValue?.first?["children"]?.arrayValue?.first)
  }

  private func point(_ x: Double, _ y: Double) -> XCUICoordinate {
    app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y))
  }
}
