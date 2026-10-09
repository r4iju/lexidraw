import XCTest

@MainActor
final class AccessibilityJourneysUITests: XCTestCase {
  func testTabletSharedExplanationDoesNotCoverFilesAtLargestText() throws {
    guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("Tablet Shared accessibility") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launchEnvironment["BROWSER_SCENARIO"] = "journeys"
    app.launch()
    let sidebar = app.collectionViews["Sidebar"]
    XCTAssertTrue(sidebar.staticTexts["Shared"].waitForExistence(timeout: 5))
    sidebar.staticTexts["Shared"].tap()
    XCTAssertTrue(app.navigationBars["Shared"].exists, "The selected destination has the same concise name as its sidebar control")
    XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Private team brief,")).firstMatch.waitForExistence(timeout: 5))
    let explanation = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Available here even when")).firstMatch
    XCTAssertFalse(explanation.isHittable, "The explanation must scroll after files, instead of occupying their viewport")
    let listing = app.collectionViews.matching(NSPredicate(format: "identifier != %@", "Sidebar")).firstMatch
    for _ in 0..<5 {
      if explanation.isHittable { break }
      listing.swipeUp()
    }
    XCTAssertTrue(explanation.isHittable, "The access explanation remains reachable after the files")
  }

  func testMaximumTextEditingControlsDoNotOverlapDestinationControls() throws {
    guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Compact editor controls") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication()
    app.launchEnvironment["BROWSER_SCENARIO"] = "journeys"
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launch()
    app.buttons["Projects"].tap()
    app.staticTexts["Projects plan"].tap()
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 5))
    app.buttons["Edit"].tap()
    let lists = app.buttons["editor lists"]
    XCTAssertTrue(lists.waitForExistence(timeout: 5))
    XCTAssertFalse(app.tabBars.firstMatch.exists && app.tabBars.firstMatch.frame.intersects(lists.frame),
      "Destination controls must not obscure contextual editing controls")
    lists.tap()
    XCTAssertTrue(app.buttons["Bulleted list"].waitForExistence(timeout: 5))
  }

  func testLargestTextFiltersLeaveFilesAndClearActionReachableInLandscape() throws {
    guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Compact filter layout") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    let app = XCUIApplication()
    app.launchEnvironment["BROWSER_SCENARIO"] = "journeys"
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launch()
    app.buttons["Projects"].tap()
    app.buttons["Filter by Tags"].tap()
    app.buttons["Work"].tap()
    XCTAssertTrue(app.buttons["Clear filters"].isHittable)
    let actions = app.buttons["Actions for Projects plan"]
    XCTAssertTrue(actions.waitForExistence(timeout: 5))
    actions.tap()
    XCTAssertTrue(app.buttons["Share Link…"].waitForExistence(timeout: 5))
  }

  func testNativeLibraryAccessibilityAudit() throws {
    XCUIDevice.shared.orientation = .portrait
    let app = XCUIApplication()
    app.launchEnvironment["BROWSER_SCENARIO"] = "journeys"
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launch()
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Actions for Projects"].exists)
    // Audit the initial viewport. Scrolling a caption beneath the native glass
    // bar makes the contrast heuristic measure the intentionally obscured text.
    // iOS 27's Dynamic Type heuristic reports cached SwiftUI list labels as
    // unscaled even when the same rows visibly scale to accessibility XXXL.
    // Keep the unfiltered audit evidence; exercise reachability at that size
    // here and in the search and document journeys, alongside the other audits.
    try app.performAccessibilityAudit(for: [.contrast, .elementDetection, .hitRegion,
      .sufficientElementDescription, .trait, .textClipped])
  }

  func testSearchRecoveryRemainsReachableWithLargestTextAndLandscapeKeyboard() throws {
    guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("Compact phone accessibility") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    app.launchEnvironment["BROWSER_SCENARIO"] = "search-retry"
    app.launch()
    app.tabBars.buttons["Search"].tap()
    let field = app.searchFields.firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("notes")
    XCTAssertTrue(app.staticTexts["Couldn’t search"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.keyboards.firstMatch.exists, "Exercise the actual landscape software keyboard")
    field.typeText("\n")
    XCTAssertEqual(field.value as? String, "notes", "Dismissing input retains the failed query")
    for _ in 0..<5 {
      if app.buttons["Try Again"].isHittable { break }
      app.scrollViews.containing(.button, identifier: "Try Again").firstMatch.swipeUp()
    }
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "273-search-maximum-landscape-recovery"
    attachment.lifetime = .keepAlways
    add(attachment)
    XCTAssertTrue(app.buttons["Try Again"].isHittable)
    app.buttons["Try Again"].tap()
    XCTAssertTrue(app.buttons["Reveal Q3 notes in Q3"].waitForExistence(timeout: 10))
    let result = app.buttons["Reveal Q3 notes in Q3"]
    let listing = app.collectionViews.firstMatch
    let top = app.navigationBars.firstMatch.frame.maxY
    let bottom = app.tabBars.firstMatch.frame.minY
    for _ in 0..<20 {
      if result.isHittable && result.frame.minY >= top && result.frame.maxY <= bottom { break }
      // A full-screen swipe can pass the whole result in this short viewport.
      let delta: CGFloat = result.frame.minY < top ? 0.1 : -0.1
      listing.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65))
        .press(forDuration: 0.1, thenDragTo: listing.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.65 + delta)),
          withVelocity: .slow, thenHoldForDuration: 0.1)
    }
    XCTAssertGreaterThanOrEqual(result.frame.minY, top)
    XCTAssertLessThanOrEqual(result.frame.maxY, bottom)
    XCTAssertTrue(result.isHittable)
    result.tap()
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].waitForExistence(timeout: 5))
    app.tabBars.buttons["Search"].tap()
    XCTAssertEqual(app.searchFields.firstMatch.value as? String, "notes")
    app.buttons["Clear text"].tap()
    XCTAssertTrue(app.staticTexts["Find a file"].waitForExistence(timeout: 5))
  }
}
