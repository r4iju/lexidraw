import XCTest

@MainActor
final class SearchSidebarUITests: XCTestCase {
  func testSidebarSearchRetainsItsFileAndQueryAndRevealsIntoHome() throws {
    guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad sidebar search") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication()
    app.launchEnvironment["BROWSER_SCENARIO"] = "journeys"
    app.launch()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    let sidebar = app.collectionViews["Sidebar"]
    let listing = app.collectionViews.matching(NSPredicate(format: "label != %@", "Sidebar")).firstMatch
    listing.buttons["Projects"].tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
    XCTAssertTrue(sidebar.staticTexts["Search"].waitForExistence(timeout: 5))
    sidebar.staticTexts["Search"].tap()
    let field = app.searchFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("notes")
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 5))
    field.typeText("\n")
    app.staticTexts["Q3 notes"].tap()
    XCTAssertTrue(app.navigationBars["Q3 notes"].waitForExistence(timeout: 5))
    sidebar.staticTexts["Shared with Me"].tap()
    sidebar.staticTexts["Search"].tap()
    XCTAssertTrue(app.navigationBars["Q3 notes"].waitForExistence(timeout: 5))
    app.navigationBars["Q3 notes"].buttons["BackButton"].tap()
    XCTAssertEqual(field.value as? String, "notes")
    app.buttons["Reveal Q3 notes in Q3"].tap()
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].waitForExistence(timeout: 5))
    app.navigationBars["Q3"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    sidebar.staticTexts["Search"].tap()
    XCTAssertEqual(field.value as? String, "notes")
  }
}
