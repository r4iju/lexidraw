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
    sidebar.staticTexts["Shared"].tap()
    sidebar.staticTexts["Search"].tap()
    XCTAssertTrue(app.navigationBars["Q3 notes"].waitForExistence(timeout: 5))
    app.buttons["Close file"].tap()
    XCTAssertEqual(field.value as? String, "notes")
    app.buttons["Reveal Q3 notes in Q3"].tap()
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].waitForExistence(timeout: 5))
    app.navigationBars["Q3"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    sidebar.staticTexts["Search"].tap()
    XCTAssertEqual(field.value as? String, "notes")
  }
  func testChangingQueryWhileRevealWaitsForSavingKeepsTheNewSearchAndEditedFile() throws {
    guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad awaited save reveal") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
    app.launchEnvironment["BROWSER_SCENARIO"] = "reveal-save-delayed"
    app.launch()
    let sidebar = app.collectionViews["Sidebar"]
    XCTAssertTrue(sidebar.staticTexts["Search"].waitForExistence(timeout: 5))
    sidebar.staticTexts["Search"].tap()
    let field = app.searchFields.firstMatch
    field.tap()
    field.typeText("Readme\n")
    XCTAssertTrue(app.buttons["Reveal Readme in Library or Shared"].waitForExistence(timeout: 5))
    app.staticTexts["Readme"].firstMatch.tap()
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 5))
    app.buttons["Edit"].tap()
    app.textViews.firstMatch.typeText("Preserve my pending edit")
    app.buttons["editor hide keyboard"].tap()
    XCTAssertTrue(app.staticTexts["Saving…"].waitForExistence(timeout: 5))
    app.buttons["Reveal Readme in Library or Shared"].tap()
    XCTAssertEqual(app.buttons["Reveal Readme in Library or Shared"].value as? String, "Finding location")
    field.tap()
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6) + "notes\n")
    XCTAssertTrue(app.buttons["Reveal Q3 notes in Q3"].waitForExistence(timeout: 5))
    let departed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"), object: app.navigationBars["Library"])
    departed.isInverted = true
    wait(for: [departed], timeout: 22)
    XCTAssertEqual(field.value as? String, "notes")
    XCTAssertTrue(app.navigationBars["Readme"].exists, "Obsolete Reveal keeps its edited detail")
    XCTAssertTrue((app.textViews.firstMatch.value as? String ?? "").contains("Preserve my pending edit"))
    XCTAssertTrue(app.buttons["Reveal Q3 notes in Q3"].isEnabled)
  }

}
