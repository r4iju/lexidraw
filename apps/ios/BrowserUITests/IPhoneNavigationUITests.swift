import XCTest

/// The signed-in iPhone journey uses the real browser with fixture-backed services.
final class IPhoneNavigationUITests: XCTestCase {
  func testSwitchingDestinationsKeepsTheFolderAndSecondaryDestinationsReachable() throws {
    continueAfterFailure = false
    guard UIDevice.current.userInterfaceIdiom == .phone else {
      throw XCTSkip("The iPad keeps its sidebar navigation.")
    }
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    let tabs = app.tabBars.firstMatch
    XCTAssertTrue(tabs.buttons["Library"].waitForExistence(timeout: 5))
    XCTAssertTrue(tabs.buttons["Shared"].exists)
    XCTAssertTrue(tabs.buttons["Search"].exists)
    app.buttons["Projects"].tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
    app.buttons["Q3"].tap()
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 5))
    tabs.buttons["Shared"].tap()
    XCTAssertTrue(app.navigationBars["Shared"].waitForExistence(timeout: 5))
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
    app.buttons["Done"].tap()
    tabs.buttons["Search"].tap()
    XCTAssertTrue(app.navigationBars["Search"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Find a file"].exists)
    tabs.buttons["Library"].tap()
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 5))
    app.navigationBars["Q3"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
    app.navigationBars["Projects"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    app.buttons["Trash"].tap()
    XCTAssertTrue(app.navigationBars["Trash"].waitForExistence(timeout: 5))
    tabs.buttons["Shared"].tap()
    tabs.buttons["Library"].tap()
    XCTAssertTrue(app.navigationBars["Trash"].exists)
    app.navigationBars["Trash"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    app.buttons["New"].tap()
    XCTAssertTrue(app.buttons["Document"].waitForExistence(timeout: 5))
  }

  func testAccountAccessAndSearchReturnKeepTheCurrentFolder() throws {
    continueAfterFailure = false
    guard UIDevice.current.userInterfaceIdiom == .phone else {
      throw XCTSkip("The iPad keeps its sidebar navigation.")
    }
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    app.buttons["Projects"].tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5))
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
    app.buttons["Done"].tap()
    app.tabBars.buttons["Search"].tap()
    XCTAssertTrue(app.buttons["Settings"].exists)
    app.tabBars.buttons["Library"].tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
  }

  func testDrawingSaveFailureKeepsBackGestureAndDestinationRecoveryOnScreen() throws {
    guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Phone drawing exits") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
    app.launchEnvironment["BROWSER_SCENARIO"] = "drawing-save-failure"
    app.launch()
    XCTAssertTrue(app.buttons["Projects"].waitForExistence(timeout: 5))
    app.buttons["Projects"].tap()
    app.staticTexts["A drawing with a wonderfully long title for our next adventure together"].tap()
    XCTAssertTrue(app.buttons["Insert Image"].waitForExistence(timeout: 5))
    for tool in ["Select", "Rectangle", "Diamond", "Ellipse", "Arrow", "Line", "Draw", "Text"] {
      XCTAssertTrue(app.segmentedControls.buttons[tool].isHittable, "Every drawing tool remains reachable above destinations: \(tool)")
    }
    let rectangle = app.segmentedControls.buttons["Rectangle"]
    XCTAssertTrue(rectangle.isHittable)
    rectangle.tap()
    let window = app.windows.firstMatch
    window.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3))
      .press(forDuration: 0.1, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5)))
    XCTAssertTrue(app.buttons["Try Saving Again"].waitForExistence(timeout: 5), "A canvas edit reaches the failed save boundary")
    app.navigationBars.firstMatch.buttons.matching(NSPredicate(format: "label == 'Back' OR identifier == 'BackButton'")).firstMatch.tap()
    XCTAssertTrue(app.buttons["Try Saving Again"].waitForExistence(timeout: 5), "Failed Back must retain save recovery")
    window.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
      .press(forDuration: 0.1, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.5)))
    XCTAssertTrue(rectangle.exists, "An edge exit cannot discard failed edits")
    app.tabBars.buttons["Shared"].tap()
    XCTAssertTrue(app.tabBars.buttons["Library"].isSelected, "A failed destination exit retains the drawing")
    XCTAssertTrue(app.buttons["Try Saving Again"].exists)
    app.buttons["Try Saving Again"].tap()
    XCTAssertTrue(rectangle.exists, "Retry retains the edited canvas")
  }

}
