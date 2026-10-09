import XCTest

@MainActor
final class IPadJourneysUITests: XCTestCase {
  func testReadAloudControlsSurviveDestinationChangesAndCanStop() throws {
    guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad listening journey") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
    app.launchEnvironment["BROWSER_SCENARIO"] = "listening"
    app.launch()
    XCTAssertTrue(app.buttons["Actions for Readme"].waitForExistence(timeout: 5))
    app.buttons["Actions for Readme"].tap()
    app.buttons["Listen"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5))
    let sidebar = app.collectionViews["Sidebar"]
    sidebar.staticTexts["Shared"].tap()
    XCTAssertTrue(app.buttons["Pause"].exists)
    sidebar.staticTexts["Search"].tap()
    XCTAssertTrue(app.buttons["Stop Listening"].isHittable)
    let playing = XCTAttachment(screenshot: app.screenshot())
    playing.name = "273-ipad-read-aloud-search"
    playing.lifetime = .keepAlways
    add(playing)
    app.buttons["Read aloud: Readme"].tap()
    XCTAssertTrue(app.buttons["Next Part"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Done"].isHittable)
    app.buttons["Done"].tap()
    app.buttons["Stop Listening"].tap()
    XCTAssertFalse(app.buttons["Stop Listening"].exists)
    XCTAssertTrue(app.searchFields.firstMatch.exists)
  }

  func testDrawingToolsRemainUsableDuringReadAloud() throws {
    guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad drawing and listening") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
    app.launchEnvironment["BROWSER_SCENARIO"] = "listening"
    app.launch()
    XCTAssertTrue(app.buttons["Actions for Readme"].waitForExistence(timeout: 5))
    app.buttons["Actions for Readme"].tap()
    app.buttons["Listen"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5))
    app.collectionViews["Sidebar"].buttons["Projects"].firstMatch.tap()
    app.staticTexts["A drawing with a wonderfully long title for our next adventure together"].firstMatch.tap()
    let rectangle = app.buttons["Rectangle"]
    XCTAssertTrue(rectangle.waitForExistence(timeout: 5))
    XCTAssertFalse(rectangle.frame.intersects(app.buttons["Read aloud: Readme"].frame),
      "Listening controls must not cover the drawing tools")
    rectangle.tap()
    XCTAssertTrue(rectangle.isSelected)
    XCTAssertTrue(app.buttons["Pause"].exists)
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = "273-ipad-drawing-and-playback"
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  func testDrawingSaveFailureKeepsTheFileOpenWhenClosing() throws {
    guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad file detail") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
    app.launchEnvironment["BROWSER_SCENARIO"] = "drawing-save-failure"
    app.launch()
    XCTAssertTrue(app.buttons["Projects"].firstMatch.waitForExistence(timeout: 5))
    app.buttons["Projects"].firstMatch.tap()
    app.staticTexts["A drawing with a wonderfully long title for our next adventure together"].firstMatch.tap()
    XCTAssertTrue(app.buttons["Rectangle"].waitForExistence(timeout: 5))
    app.buttons["Rectangle"].tap()
    let window = app.windows.firstMatch
    window.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.3))
      .press(forDuration: 0.1, thenDragTo: window.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)))
    XCTAssertTrue(app.buttons["Undo"].waitForExistence(timeout: 5))
    app.buttons["Close file"].tap()
    XCTAssertTrue(app.buttons["Try Saving Again"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Rectangle"].exists, "Failed save keeps the drawing open")
    XCTAssertTrue(app.buttons["Actions for Design reference"].exists, "The adjacent listing remains available")
  }

  func testDestinationsRetainFoldersAndFilesOpenBesideTheirListing() throws {
    guard UIDevice.current.userInterfaceIdiom == .pad else { throw XCTSkip("iPad adaptation") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .landscapeLeft
    let app = XCUIApplication()
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL"]
    app.launchEnvironment["BROWSER_SCENARIO"] = "journeys"
    app.launch()
    let sidebar = app.collectionViews["Sidebar"]
    XCTAssertTrue(sidebar.staticTexts["Library"].waitForExistence(timeout: 5))
    app.buttons["Projects"].firstMatch.tap()
    app.buttons["Q3"].firstMatch.tap()
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].waitForExistence(timeout: 5))
    app.typeKey("2", modifierFlags: .command)
    XCTAssertTrue(app.buttons["Actions for Private team brief"].waitForExistence(timeout: 5))
    app.typeKey("1", modifierFlags: .command)
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].waitForExistence(timeout: 5))
    app.staticTexts["Q3 notes"].firstMatch.tap()
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].exists, "Opening a file retains the adjacent folder listing")
    XCTAssertEqual(app.keyboards.count, 0)
    XCTAssertLessThanOrEqual(app.staticTexts["Reading"].frame.minY,
      app.navigationBars["Q3 notes"].frame.maxY + 100,
      "A short reading identity must not float in an empty inset")
    let detail = XCTAttachment(screenshot: app.screenshot())
    detail.name = "273-ipad-list-and-reading-detail"
    detail.lifetime = .keepAlways
    add(detail)
    app.buttons["Close file"].tap()
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].exists)
    app.typeKey(",", modifierFlags: .command)
    XCTAssertTrue(app.staticTexts["Native Reader"].waitForExistence(timeout: 5))
    app.buttons["Done"].tap()
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].exists)
    sidebar.buttons["Trash"].tap()
    XCTAssertTrue(app.navigationBars["Trash"].waitForExistence(timeout: 5))
    app.navigationBars["Trash"].buttons["BackButton"].tap()
    XCTAssertTrue(app.buttons["Actions for Q3 notes"].waitForExistence(timeout: 5),
      "Returning from Trash retains the originating folder")
  }
}
