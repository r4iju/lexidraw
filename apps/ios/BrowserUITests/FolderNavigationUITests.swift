import XCTest

/// Folders open from the listing and from the sidebar, as they do on the web.
final class FolderNavigationUITests: XCTestCase {
  private var app: XCUIApplication!

  override func setUpWithError() throws {
    guard UIDevice.current.userInterfaceIdiom == .pad else {
      throw XCTSkip("Sidebar journeys apply to iPad; iPhone uses destination tabs.")
    }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    app = XCUIApplication()
    app.launch()
    XCTAssertTrue(shows("Readme"))
  }

  private func shows(_ text: String) -> Bool {
    app.staticTexts[text].firstMatch.waitForExistence(timeout: 5)
  }

  private var sidebar: XCUIElement { app.collectionViews["Sidebar"] }
  private var listing: XCUIElement {
    app.collectionViews.matching(NSPredicate(format: "identifier != %@", "Sidebar")).firstMatch
  }

  func testAFolderInTheListingOpensAndSoDoesOneInsideIt() {
    listing.buttons["Projects"].tap()
    XCTAssertTrue(shows("Projects plan"))
    listing.buttons["Q3"].tap()
    XCTAssertTrue(shows("Q3 notes"))
    sidebar.staticTexts["Library"].tap()
    XCTAssertTrue(shows("Readme"))
  }

  func testABreadcrumbGoesBackToAFolderOnTheWay() {
    listing.buttons["Projects"].tap()
    listing.buttons["Q3"].tap()
    XCTAssertTrue(shows("Q3 notes"))
    app.descendants(matching: .any)["Folder location: Q3"].firstMatch.tap()
    app.collectionViews.matching(NSPredicate(format: "identifier != %@", "Sidebar")).buttons["Projects"]
      .firstMatch.tap()
    XCTAssertTrue(shows("Projects plan"))
    app.navigationBars["Projects"].buttons["BackButton"].tap()
    XCTAssertTrue(shows("Readme"))
  }

  func testAFolderInTheSidebarOpens() {
    sidebar.staticTexts["Recipes"].tap()
    XCTAssertTrue(shows("Pasta"))
  }

  func testAFolderInTheSidebarOpensFromAnotherSection() {
    sidebar.staticTexts["Shared"].tap()
    XCTAssertTrue(app.navigationBars["Shared"].waitForExistence(timeout: 5))
    sidebar.staticTexts["Recipes"].tap()
    XCTAssertTrue(shows("Pasta"))
  }

  func testAFolderWithFoldersInTheSidebarOpensAndSoDoesOneInsideIt() {
    sidebar.staticTexts["Projects"].tap()
    XCTAssertTrue(shows("Projects plan"))
    // Recipes has no folders, so the only disclosure triangle, which has no
    // label, is Projects'.
    sidebar.buttons.matching(NSPredicate(format: "label == ''")).firstMatch.tap()
    sidebar.staticTexts["Q3"].tap()
    XCTAssertTrue(shows("Q3 notes"))
  }

  /// A pointer's click, as a Mac's or a trackpad's, rather than a touch.
  func testAClickedFolderInTheListingOpens() {
    listing.buttons["Projects"].click()
    XCTAssertTrue(shows("Projects plan"))
  }
}
