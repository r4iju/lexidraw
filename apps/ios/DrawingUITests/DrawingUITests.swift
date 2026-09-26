import XCTest

/// The drawing harness opened on its bundled drawing, fitted to the screen:
/// two rectangles grouped, and a circle beside them.
@MainActor
class DrawingUITestCase: XCTestCase {
  var app: XCUIApplication!

  override func setUp() async throws {
    continueAfterFailure = false
    app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.buttons["Insert Image"].waitForExistence(timeout: 20))
  }

  private var hasPressedAKey = false

  /// Presses `key` on the hardware keyboard. The simulator drops the first
  /// shortcut after an input view comes up, as #113 found for a text view
  /// too, so a Shift press goes first.
  func press(_ key: String, _ modifiers: XCUIElement.KeyModifierFlags = []) {
    if !hasPressedAKey { app.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: []) }
    hasPressedAKey = true
    app.typeKey(key, modifierFlags: modifiers)
  }

  /// A point on the screen, as a fraction of its width and height.
  func point(_ x: Double, _ y: Double) -> XCUICoordinate {
    app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y))
  }

  /// Drags a selection box round the whole drawing.
  func selectEverything() {
    point(0.03, 0.16).press(forDuration: 0.1, thenDragTo: point(0.97, 0.84))
  }

  func waitUntil(_ timeout: TimeInterval = 3, _ condition: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() {
      guard Date() < deadline else { return false }
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    return true
  }
}

/// `scripts/test-drawing-ui.sh` runs these alone on a freshly booted
/// simulator. A key pressed by `typeKey` attaches a hardware keyboard until
/// the next boot, and with one attached no software keyboard comes up.
final class MenuKeyboardUITests: DrawingUITestCase {
  func testAMenuBringsUpNoKeyboardWhereTextStillDoes() {
    app.buttons["Insert Image"].tap()
    XCTAssertTrue(app.buttons["Photo Library"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.keyboards.firstMatch.waitForExistence(timeout: 3), "a keyboard came up with the menu")
    point(0.5, 0.3).tap()
    XCTAssertTrue(app.buttons["Photo Library"].waitForNonExistence(timeout: 5))

    // Text still brings the keyboard up, so none above means none would come.
    app.buttons["Text"].tap()
    point(0.5, 0.3).tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "no keyboard came up for text")
  }
}

final class CanvasKeysUITests: DrawingUITestCase {
  func testAKeyChoosesATool() {
    press("r")
    XCTAssertTrue(app.buttons["Rectangle"].isSelected)
  }

  func testKeysStillWorkAfterAMenuCloses() {
    app.buttons["Insert Image"].tap()
    XCTAssertTrue(app.buttons["Photo Library"].waitForExistence(timeout: 5))
    point(0.5, 0.3).tap()
    XCTAssertTrue(app.buttons["Photo Library"].waitForNonExistence(timeout: 5))

    press("o")
    XCTAssertTrue(app.buttons["Ellipse"].isSelected)
    point(0.3, 0.2).press(forDuration: 0.1, thenDragTo: point(0.6, 0.28))
    let redo = app.buttons["Redo"]
    XCTAssertTrue(waitUntil { self.app.buttons["Undo"].isEnabled }, "no ellipse was drawn")
    press("z", .command)
    XCTAssertTrue(waitUntil { redo.isEnabled }, "Command-Z undid nothing after the menu")
  }

  func testCommandZUndoesOneEditAndShiftCommandZRedoesIt() {
    press("r")
    point(0.3, 0.72).press(forDuration: 0.1, thenDragTo: point(0.6, 0.8))
    press("r")
    point(0.3, 0.2).press(forDuration: 0.1, thenDragTo: point(0.6, 0.28))
    let undo = app.buttons["Undo"]
    let redo = app.buttons["Redo"]
    XCTAssertTrue(undo.waitForExistence(timeout: 3))
    XCTAssertFalse(redo.isEnabled)

    press("z", .command)
    XCTAssertTrue(waitUntil { redo.isEnabled })
    XCTAssertTrue(undo.isEnabled, "Command-Z undid more than one edit")

    press("z", [.command, .shift])
    XCTAssertTrue(waitUntil { !redo.isEnabled })
  }
}
