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
}
