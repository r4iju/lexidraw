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

  lazy var keyboard = HardwareKeyboard(app, typingInto: app)

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
    keyboard.press("r")
    XCTAssertTrue(app.buttons["Rectangle"].isSelected)
  }

  func testKeysStillWorkAfterAMenuCloses() {
    app.buttons["Insert Image"].tap()
    XCTAssertTrue(app.buttons["Photo Library"].waitForExistence(timeout: 5))
    point(0.5, 0.3).tap()
    XCTAssertTrue(app.buttons["Photo Library"].waitForNonExistence(timeout: 5))

    keyboard.press("o")
    XCTAssertTrue(app.buttons["Ellipse"].isSelected)
    point(0.3, 0.2).press(forDuration: 0.1, thenDragTo: point(0.6, 0.28))
    let redo = app.buttons["Redo"]
    XCTAssertTrue(waitUntil { self.app.buttons["Undo"].isEnabled }, "no ellipse was drawn")
    keyboard.press("z", .command)
    XCTAssertTrue(waitUntil { redo.isEnabled }, "Command-Z undid nothing after the menu")
  }

  func testCommandZUndoesOneEditAndShiftCommandZRedoesIt() {
    keyboard.press("r")
    point(0.3, 0.72).press(forDuration: 0.1, thenDragTo: point(0.6, 0.8))
    keyboard.press("r")
    point(0.3, 0.2).press(forDuration: 0.1, thenDragTo: point(0.6, 0.28))
    let undo = app.buttons["Undo"]
    let redo = app.buttons["Redo"]
    XCTAssertTrue(undo.waitForExistence(timeout: 3))
    XCTAssertFalse(redo.isEnabled)

    keyboard.press("z", .command)
    XCTAssertTrue(waitUntil { redo.isEnabled })
    XCTAssertTrue(undo.isEnabled, "Command-Z undid more than one edit")

    keyboard.press("z", [.command, .shift])
    XCTAssertTrue(waitUntil { !redo.isEnabled })
  }
}

final class ToolbarUITests: DrawingUITestCase {
  /// A group and a shape beside it take the most actions: Group, Ungroup
  /// and Delete. On an iPhone they didn't fit in a bar with the tools, which
  /// then went into a menu that showed nothing.
  func testTheToolsStayInTheirBarWhileShapesAreSelected() {
    selectEverything()
    XCTAssertTrue(waitUntil { self.app.buttons["Delete"].exists || self.app.buttons["More"].exists })

    for tool in ["Select", "Rectangle", "Diamond", "Ellipse", "Arrow", "Line", "Draw", "Text"] {
      XCTAssertTrue(app.buttons[tool].isHittable, "\(tool) left the bar")
    }
    XCTAssertTrue(reachable("Ungroup").exists)
  }

  func testTheSelectionIsDeletedFromTheBar() {
    selectEverything()
    XCTAssertTrue(waitUntil { self.app.buttons["Delete"].exists || self.app.buttons["More"].exists })
    XCTAssertFalse(app.buttons["Redo"].isEnabled)
    reachable("Delete").tap()
    XCTAssertTrue(waitUntil { !self.app.buttons["Delete"].exists })
    app.buttons["Undo"].tap()
    XCTAssertTrue(waitUntil { self.app.buttons["Redo"].isEnabled })
  }

  /// A toolbar button, from the "More" menu when the bar hasn't room for it.
  private func reachable(_ title: String) -> XCUIElement {
    let button = app.buttons[title]
    if !(button.exists && button.isHittable) {
      app.buttons["More"].tap()
      XCTAssertTrue(button.waitForExistence(timeout: 3), "\(title) is in neither the bar nor its menu")
    }
    return button
  }
}
