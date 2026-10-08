import XCTest

@MainActor
final class LibraryJourneysUITests: XCTestCase {
  private var app: XCUIApplication!

  override func setUp() async throws {
    guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("iPhone library journeys") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    app = XCUIApplication()
    app.launchEnvironment["BROWSER_SCENARIO"] = "journeys"
    app.launch()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
  }

  func testVisibleActionsRenameMoveShareDeleteAndRestoreInTheOriginalFolder() {
    app.buttons["Projects"].tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
    let menu = app.buttons["Actions for Projects plan"]
    XCTAssertTrue(menu.waitForExistence(timeout: 5))
    menu.tap()
    app.buttons["Rename…"].tap()
    let title = app.textFields["Title"]
    replaceTitle(title, with: "Launch plan")
    XCTAssertEqual(title.value as? String, "Launch plan")
    app.navigationBars["Rename"].buttons["Rename"].tap()
    XCTAssertTrue(app.staticTexts["Launch plan"].waitForExistence(timeout: 5))
    app.buttons["Actions for Launch plan"].tap()
    app.buttons["Share Link…"].tap()
    // The system share popup exposes its outside-dismiss target on iOS 27;
    // earlier systems present a Close control in the app's accessibility tree.
    let dismiss = app.otherElements["dismiss popup"]
    if dismiss.waitForExistence(timeout: 3) {
      dismiss.tap()
    } else {
      let close = app.buttons["Close"].firstMatch
      XCTAssertTrue(close.waitForExistence(timeout: 5))
      close.tap()
    }
    app.buttons["Actions for Launch plan"].tap()
    app.buttons["Move…"].tap()
    XCTAssertTrue(app.buttons["Move Here"].waitForExistence(timeout: 5))
    app.buttons["Recipes"].tap()
    app.buttons["Move Here"].tap()
    XCTAssertTrue(app.staticTexts["Moved “Launch plan” to “Recipes”."].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["Launch plan"].exists)
    app.navigationBars["Projects"].buttons["BackButton"].tap()
    app.buttons["Recipes"].tap()
    XCTAssertTrue(app.staticTexts["Launch plan"].waitForExistence(timeout: 5))
    app.buttons["Actions for Launch plan"].tap()
    app.buttons["Delete…"].tap()
    XCTAssertTrue(app.staticTexts["Delete “Launch plan”?"].waitForExistence(timeout: 5))
    app.buttons["Delete"].tap()
    XCTAssertTrue(app.staticTexts["Deleted “Launch plan”."].waitForExistence(timeout: 5))
    app.navigationBars["Recipes"].buttons["BackButton"].tap()
    app.buttons["Trash"].tap()
    XCTAssertTrue(app.staticTexts["Launch plan"].waitForExistence(timeout: 5))
    app.buttons["Restore Launch plan"].tap()
    XCTAssertTrue(app.staticTexts["The Trash is empty"].waitForExistence(timeout: 5))
    app.navigationBars["Trash"].buttons["BackButton"].tap()
    app.buttons["Recipes"].tap()
    XCTAssertTrue(app.staticTexts["Launch plan"].waitForExistence(timeout: 5))
  }

  private func launch(_ scenario: String) {
    app.terminate()
    app.launchEnvironment["BROWSER_SCENARIO"] = scenario
    app.launch()
  }

  private func replaceTitle(_ field: XCUIElement, with title: String) {
    let previous = field.value as? String ?? ""
    field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: previous.count) + title)
  }

  private func nameCreatedItem(_ name: String) {
    XCTAssertTrue(app.navigationBars["Rename"].waitForExistence(timeout: 5))
    let title = app.textFields["Title"]
    replaceTitle(title, with: name)
    XCTAssertEqual(title.value as? String, name)
    app.navigationBars["Rename"].buttons["Rename"].tap()
    XCTAssertTrue(app.staticTexts[name].waitForExistence(timeout: 5))
  }

  func testEmptyLibraryCreatesAFolderThenDocumentAndDrawingInThatFolder() {
    launch("empty")
    XCTAssertTrue(app.staticTexts["Nothing here yet"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Create your first file"].waitForExistence(timeout: 5))
    app.buttons["Create your first file"].tap()
    app.buttons["Folder"].tap()
    nameCreatedItem("Travel journal")
    app.buttons["Travel journal"].tap()
    XCTAssertTrue(app.staticTexts["Nothing here yet"].waitForExistence(timeout: 5))
    app.buttons["Create your first file"].tap()
    app.buttons["Document"].tap()
    nameCreatedItem("Kyoto notes")
    app.buttons["New"].tap()
    app.buttons["Drawing"].tap()
    nameCreatedItem("Garden sketch")
    app.navigationBars["Travel journal"].buttons["BackButton"].tap()
    XCTAssertFalse(app.staticTexts["Kyoto notes"].exists)
    app.buttons["Travel journal"].tap()
    XCTAssertTrue(app.staticTexts["Kyoto notes"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Garden sketch"].exists)
  }

  func testTagFiltersRemainVisibleAcrossFoldersAndCanClearAnEmptyResult() {
    app.buttons["Projects"].tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
    app.buttons["Filter by Tags"].tap()
    app.buttons["Work"].tap()
    XCTAssertTrue(app.staticTexts["Tagged Work"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Projects plan"].exists)
    XCTAssertFalse(app.staticTexts["Design reference"].exists)
    app.tabBars.buttons["Shared"].tap()
    app.tabBars.buttons["Library"].tap()
    XCTAssertTrue(app.staticTexts["Tagged Work"].exists)
    app.navigationBars["Projects"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["No files tagged Work"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Clear filters"].waitForExistence(timeout: 5))
    app.buttons["Clear filters"].tap()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
  }

  func testSharedFilesOpenWithoutTheirParentAndActionsRespectEachFilesAccess() {
    app.tabBars.buttons["Shared"].tap()
    XCTAssertTrue(app.staticTexts["Shared files"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Private team brief"].exists)
    XCTAssertFalse(app.buttons["New"].exists)
    app.buttons["Actions for Private team brief"].tap()
    XCTAssertTrue(app.buttons["Listen"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Share Link…"].exists)
    XCTAssertFalse(app.buttons["Rename…"].exists)
    XCTAssertFalse(app.buttons["Move…"].exists)
    XCTAssertFalse(app.buttons["Delete…"].exists)
    app.buttons["Listen"].tap()
    XCTAssertTrue(app.staticTexts["Read aloud with AI"].waitForExistence(timeout: 5))
    app.buttons["Cancel"].tap()
    app.staticTexts["Private team brief"].tap()
    XCTAssertTrue(app.staticTexts["Read only"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.textViews.firstMatch.exists)
    app.navigationBars["Private team brief"].buttons["BackButton"].tap()
    app.buttons["Actions for Collaborative sketch"].tap()
    XCTAssertTrue(app.buttons["Rename…"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Move…"].exists)
    XCTAssertFalse(app.buttons["Delete…"].exists)
    app.buttons["Move…"].tap()
    XCTAssertTrue(app.buttons["Move Here"].waitForExistence(timeout: 5))
    app.buttons["Projects"].tap()
    XCTAssertFalse(app.buttons["Move Here"].isEnabled)
    app.buttons["Cancel"].tap()
    app.staticTexts["Reference only"].tap()
    XCTAssertTrue(app.staticTexts["Nothing here yet"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["New"].exists)
    XCTAssertFalse(app.buttons["Create your first file"].exists)
  }

  func testLoadingAndFailedLibrarySharedAndTrashCanRecoverWithoutRelaunching() {
    launch("delayed")
    XCTAssertTrue(app.descendants(matching: .any)["Loading Library"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 12))
    launch("retry")
    XCTAssertTrue(app.staticTexts["Couldn’t load Library"].waitForExistence(timeout: 5))
    app.buttons["Try Again"].tap()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Shared"].tap()
    XCTAssertTrue(app.staticTexts["Couldn’t load what’s shared with you"].waitForExistence(timeout: 5))
    app.buttons["Try Again"].tap()
    XCTAssertTrue(app.staticTexts["Private team brief"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Library"].tap()
    app.buttons["Trash"].tap()
    XCTAssertTrue(app.staticTexts["Couldn’t load the Trash"].waitForExistence(timeout: 5))
    app.buttons["Try Again"].tap()
    XCTAssertTrue(app.staticTexts["The Trash is empty"].waitForExistence(timeout: 5))
  }

  func testFailedRestoreRetainsTheFileAndCanRecoverToLibraryWhenItsFolderIsGone() {
    launch("restore-failure")
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    app.buttons["Trash"].tap()
    XCTAssertTrue(app.staticTexts["Recovered notes"].waitForExistence(timeout: 5))
    app.buttons["Restore Recovered notes"].tap()
    XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Connection interrupted. Please try again."].exists)
    app.alerts.buttons["OK"].tap()
    XCTAssertTrue(app.staticTexts["Recovered notes"].exists)
    app.buttons["Restore Recovered notes"].tap()
    XCTAssertTrue(app.staticTexts["The Trash is empty"].waitForExistence(timeout: 5))
    app.navigationBars["Trash"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Recovered notes"].waitForExistence(timeout: 5))
  }

  func testMixedFilesHaveReadableIdentityAndOpenBackIntoTheSameFolder() {
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "1 folder · Updated")).firstMatch.waitForExistence(timeout: 5))
    app.buttons["Projects"].tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
    let longTitle = "A drawing with a wonderfully long title for our next adventure together"
    XCTAssertTrue(app.staticTexts[longTitle].exists)
    XCTAssertTrue(app.staticTexts["Drawing"].exists)
    XCTAssertTrue(app.staticTexts["Link"].exists)
    app.staticTexts["Design reference"].tap()
    XCTAssertTrue(app.buttons["Open page"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Listen"].exists)
    app.navigationBars["Design reference"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts[longTitle].waitForExistence(timeout: 5))
    app.staticTexts[longTitle].tap()
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Couldn’t load")).firstMatch.exists)
    app.navigationBars.buttons["BackButton"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
    app.staticTexts["Projects plan"].tap()
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 5))
    app.navigationBars["Projects plan"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Design reference"].waitForExistence(timeout: 5))
  }

  func testRestoreShowsProgressAndPreventsRepeatedSubmissions() {
    launch("restore-delayed")
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    app.buttons["Trash"].tap()
    let restore = app.buttons["Restore Recovered notes"]
    XCTAssertTrue(restore.waitForExistence(timeout: 5))
    restore.tap()
    expectation(for: NSPredicate(format: "value == %@", "Restoring"), evaluatedWith: restore)
    waitForExpectations(timeout: 3)
    XCTAssertFalse(restore.isEnabled)
    XCTAssertTrue(app.staticTexts["The Trash is empty"].waitForExistence(timeout: 8))
  }

  func testRenameShowsTheCurrentNameAndCanCancelWithoutChangingTheFile() {
    app.buttons["Actions for Readme"].tap()
    app.buttons["Rename…"].tap()
    XCTAssertTrue(app.navigationBars["Rename"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.textFields["Title"].value as? String, "Readme")
    app.buttons["Cancel"].tap()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
  }

}
