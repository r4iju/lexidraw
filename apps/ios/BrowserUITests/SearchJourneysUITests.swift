import XCTest

@MainActor
final class SearchJourneysUITests: XCTestCase {
  private var app: XCUIApplication!

  override func setUp() async throws {
    guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("iPhone search journeys") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    app = XCUIApplication()
    app.launchEnvironment["BROWSER_SCENARIO"] = "journeys"
    app.launch()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Search"].tap()
  }

  private func search(_ text: String) {
    let field = app.searchFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    let previous = field.value as? String ?? ""
    let count = previous == "Search all file titles" ? 0 : previous.count
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: count) + text)
  }

  func testGlobalTitleResultsEmptyAndClearReturnToAnApproachablePrompt() {
    XCTAssertTrue(app.staticTexts["Find a file"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Search titles across all files you can access. Document contents aren’t searched."].exists)
    search("notes")
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["In Q3"].exists)
    XCTAssertTrue(app.buttons["Reveal Q3 notes in Q3"].exists)
    search("nonexistent")
    XCTAssertTrue(app.staticTexts["No matching titles"].waitForExistence(timeout: 5))
    app.buttons["Clear query"].tap()
    XCTAssertTrue(app.staticTexts["Find a file"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["Q3 notes"].exists)
  }
  private func launch(_ scenario: String) {
    app.terminate()
    app.launchEnvironment["BROWSER_SCENARIO"] = scenario
    app.launch()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Search"].tap()
  }

  func testLoadingFailureRetryKeepsTheQueryAndCanClear() {
    launch("search-retry")
    search("notes")
    XCTAssertTrue(app.descendants(matching: .any)["Searching titles"].firstMatch.waitForExistence(timeout: 3))
    XCTAssertTrue(app.staticTexts["Couldn’t search"].waitForExistence(timeout: 8))
    XCTAssertEqual(app.searchFields.firstMatch.value as? String, "notes")
    app.buttons["Try Again"].tap()
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 8))
    app.buttons["Clear query"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts["Find a file"].waitForExistence(timeout: 5))
  }

  func testSupersededTransportCannotReplaceNewResultsEvenWhenItIgnoresCancellation() {
    launch("search-obsolete")
    search("Projects")
    XCTAssertTrue(app.descendants(matching: .any)["Searching titles"].firstMatch.waitForExistence(timeout: 3))
    search("notes")
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 5))
    let obsolete = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"), object: app.staticTexts["Projects plan"])
    obsolete.isInverted = true
    wait(for: [obsolete], timeout: 12)
    XCTAssertTrue(app.staticTexts["Q3 notes"].exists)
    XCTAssertEqual(app.searchFields.firstMatch.value as? String, "notes")
  }

  func testClearCancelsAnInFlightTransportThatIgnoresCancellation() {
    launch("search-obsolete")
    search("Projects")
    XCTAssertTrue(app.descendants(matching: .any)["Searching titles"].firstMatch.waitForExistence(timeout: 3))
    app.buttons["Clear query"].firstMatch.tap()
    XCTAssertTrue(app.staticTexts["Find a file"].waitForExistence(timeout: 5))
    let obsolete = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"), object: app.staticTexts["Projects plan"])
    obsolete.isInverted = true
    wait(for: [obsolete], timeout: 12)
    XCTAssertTrue(app.staticTexts["Find a file"].exists)
  }

  private func submit() {
    app.searchFields.firstMatch.typeText("\n")
  }

  func testDocumentReadingEditingAndReturnKeepTheSearchQueryAndSavedContent() {
    search("notes")
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 5))
    submit()
    app.staticTexts["Q3 notes"].tap()
    XCTAssertTrue(app.staticTexts["Reading"].waitForExistence(timeout: 10))
    let editor = app.textViews.firstMatch
    editor.tap()
    XCTAssertFalse(app.keyboards.firstMatch.waitForExistence(timeout: 2))
    app.buttons["Edit"].tap()
    editor.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: [])
    editor.typeKey(XCUIKeyboardKey.F13.rawValue, modifierFlags: .shift)
    editor.typeKey("a", modifierFlags: .command)
    editor.typeText("A saved search journey")
    app.buttons["Done"].tap()
    XCTAssertTrue(app.staticTexts["Saved"].waitForExistence(timeout: 10))
    app.navigationBars["Q3 notes"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.searchFields.firstMatch.value as? String, "notes")
    app.staticTexts["Q3 notes"].tap()
    XCTAssertTrue(app.staticTexts["Reading"].waitForExistence(timeout: 10))
    XCTAssertEqual(app.textViews.firstMatch.value as? String, "A saved search journey\n")
    XCTAssertFalse(app.keyboards.firstMatch.exists)
  }

  func testOpenBackAndDestinationSwitchingRetainSearchThenRevealClearsLibraryFilters() {
    app.tabBars.buttons["Library"].tap()
    app.buttons["Filter by Tags"].tap()
    app.buttons["Unassigned"].tap()
    XCTAssertTrue(app.buttons["Clear filters"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Search"].tap()
    search("notes")
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 5))
    submit()
    app.staticTexts["Q3 notes"].tap()
    XCTAssertTrue(app.navigationBars["Q3 notes"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Shared"].tap()
    app.tabBars.buttons["Search"].tap()
    XCTAssertTrue(app.navigationBars["Q3 notes"].waitForExistence(timeout: 5))
    app.navigationBars["Q3 notes"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.searchFields.firstMatch.value as? String, "notes")
    app.tabBars.buttons["Library"].tap()
    XCTAssertTrue(app.buttons["Clear filters"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Search"].tap()
    app.buttons["Reveal Q3 notes in Q3"].tap()
    XCTAssertTrue(app.tabBars.buttons["Library"].isSelected)
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["Clear filters"].exists)
    app.navigationBars["Q3"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Search"].tap()
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.searchFields.firstMatch.value as? String, "notes")
  }

  func testFolderResultOpensNestedFoldersAndReturnsToItsQuery() {
    search("Projects")
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
    submit()
    app.staticTexts["Projects"].firstMatch.tap()
    XCTAssertTrue(app.buttons["Actions for Projects plan"].waitForExistence(timeout: 5))
    app.buttons["Q3"].tap()
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].waitForExistence(timeout: 5))
    app.navigationBars["Q3"].buttons["BackButton"].tap()
    app.navigationBars["Projects"].buttons["BackButton"].tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.searchFields.firstMatch.value as? String, "Projects")
  }

  func testRootAndPrivateParentResultsRevealAnAccessibleDestination() {
    search("Readme")
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    submit()
    app.buttons["Reveal Readme in Library or Shared"].tap()
    XCTAssertTrue(app.tabBars.buttons["Library"].isSelected)
    XCTAssertTrue(app.buttons["Actions for Readme"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Search"].tap()
    search("Private")
    XCTAssertTrue(app.staticTexts["Private team brief"].waitForExistence(timeout: 5))
    submit()
    XCTAssertTrue(app.staticTexts["In Library or Shared"].exists)
    app.buttons["Reveal Private team brief in Library or Shared"].tap()
    XCTAssertTrue(app.tabBars.buttons["Shared"].isSelected)
    XCTAssertTrue(app.buttons["Actions for Private team brief"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Search"].tap()
    XCTAssertEqual(app.searchFields.firstMatch.value as? String, "Private")
  }

  func testSearchingFromAFolderUsesGlobalScopeAndMutationsRefreshResults() {
    app.tabBars.buttons["Library"].tap()
    app.buttons["Projects"].tap()
    XCTAssertTrue(app.buttons["Actions for Projects plan"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Search"].tap()
    XCTAssertTrue(app.tabBars.buttons["Search"].isSelected)
    search("notes")
    XCTAssertTrue(app.staticTexts["Q3 notes"].waitForExistence(timeout: 5))
    submit()
    app.buttons["Reveal Q3 notes in Q3"].tap()
    app.buttons["Actions for Q3 notes"].tap()
    app.buttons["Rename…"].tap()
    let title = app.textFields["Title"]
    title.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
    title.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "Q3 notes".count) + "Quarterly memo")
    app.navigationBars["Rename"].buttons["Rename"].tap()
    XCTAssertTrue(app.staticTexts["Quarterly memo"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Search"].tap()
    XCTAssertTrue(app.staticTexts["No matching titles"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.searchFields.firstMatch.value as? String, "notes")
  }

  func testDelayedRevealCannotReplaceAFolderOpenedInAnotherDestination() {
    launch("reveal-delayed")
    search("Readme")
    XCTAssertTrue(app.buttons["Reveal Readme in Library or Shared"].waitForExistence(timeout: 5))
    submit()
    app.buttons["Reveal Readme in Library or Shared"].tap()
    XCTAssertEqual(app.buttons["Reveal Readme in Library or Shared"].value as? String, "Finding location")
    app.tabBars.buttons["Library"].tap()
    app.buttons["Projects"].tap()
    app.buttons["Q3"].tap()
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].waitForExistence(timeout: 5))
    let reset = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == true"), object: app.navigationBars["Library"])
    reset.isInverted = true
    wait(for: [reset], timeout: 12)
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].exists)
    app.tabBars.buttons["Search"].tap()
    let reveal = app.buttons["Reveal Readme in Library or Shared"]
    XCTAssertTrue(reveal.isEnabled, "An obsolete reveal releases its loading state")
    XCTAssertEqual(app.searchFields.firstMatch.value as? String, "Readme")
    reveal.tap()
    XCTAssertTrue(app.buttons["Actions for Readme"].waitForExistence(timeout: 5), "A fresh reveal remains useful")
  }

  func testChangingTheQueryMakesADelayedRevealObsolete() {
    launch("reveal-delayed")
    search("Readme")
    XCTAssertTrue(app.buttons["Reveal Readme in Library or Shared"].waitForExistence(timeout: 5))
    submit()
    app.buttons["Reveal Readme in Library or Shared"].tap()
    search("notes")
    XCTAssertTrue(app.buttons["Reveal Q3 notes in Q3"].waitForExistence(timeout: 5))
    submit()
    let departed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "selected == true"), object: app.tabBars.buttons["Library"])
    departed.isInverted = true
    wait(for: [departed], timeout: 12)
    XCTAssertEqual(app.searchFields.firstMatch.value as? String, "notes")
    let reveal = app.buttons["Reveal Q3 notes in Q3"]
    XCTAssertTrue(reveal.isEnabled)
    reveal.tap()
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].waitForExistence(timeout: 5))
  }

}
