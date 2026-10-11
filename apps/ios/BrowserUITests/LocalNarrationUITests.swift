import XCTest

@MainActor final class LocalNarrationUITests: XCTestCase {
  func testFreeLocalListenCanPauseSkipStopAndReopenAtItsPosition() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchEnvironment["BROWSER_SCENARIO"] = "local-narration"
    app.launch()
    defer {
      if app.buttons["Stop Listening"].exists { app.buttons["Stop Listening"].tap() }
      app.terminate()
    }
    XCTAssertTrue(app.buttons["Actions for Readme"].waitForExistence(timeout: 5))
    app.buttons["Actions for Readme"].tap()
    app.buttons["Listen"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 30))
    XCTAssertFalse(app.buttons["Allow Read Aloud"].exists)
    app.buttons["Pause"].tap()
    app.buttons["Read aloud: Readme"].tap()
    XCTAssertTrue(app.staticTexts["local-voice-description"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Play"].exists)
    app.buttons["Forward 15 Seconds"].tap()
    let position = app.staticTexts["listen-elapsed"].label
    XCTAssertNotEqual(position, "0:00")
    app.buttons["Done"].tap()
    app.buttons["Stop Listening"].tap()
    app.buttons["Actions for Readme"].tap()
    app.buttons["Listen"].tap()
    XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 30))
    app.buttons["Pause"].tap()
    app.buttons["Read aloud: Readme"].tap()
    func seconds(_ label: String) -> Int {
      let pieces = label.split(separator: ":").compactMap { Int($0) }
      return pieces.count == 2 ? pieces[0] * 60 + pieces[1] : -100
    }
    let resumed = seconds(app.staticTexts["listen-elapsed"].label)
    XCTAssertGreaterThanOrEqual(
      resumed, seconds(position), "Reopening must not reset the saved position.")
    XCTAssertLessThanOrEqual(
      resumed - seconds(position), 5,
      "Only the brief playback while XCTest locates and taps Pause may advance the saved position.")
    let evidence = XCTAttachment(screenshot: app.screenshot())
    evidence.name = "281-local-narration-paused-resumed"
    evidence.lifetime = .keepAlways
    add(evidence)
    app.buttons["Done"].tap()
  }
}

@MainActor final class AB8RecordingUITests: XCTestCase {
  func testSavedComposerResumesCanonicalReceiptPosition() throws {
    let app = XCUIApplication()
    app.launchEnvironment["BROWSER_SCENARIO"] = "ab8-recording"
    app.launch()
    let retained = app.buttons["Play retained audio"]
    XCTAssertTrue(retained.waitForExistence(timeout: 30))
    retained.tap()
    let evidence = app.staticTexts["ab8-playback-evidence"]
    XCTAssertTrue(evidence.label.contains("seconds 0.4"))
    app.buttons["Play saved device recording"].tap()
    let converged = NSPredicate(format: "label CONTAINS %@ AND label CONTAINS %@", "Playback 2", "seconds 0.4")
    let result = XCTWaiter.wait(for: [expectation(for: converged, evaluatedWith: evidence)], timeout: 5)
    XCTAssertEqual(result, .completed)
    XCTAssertTrue(evidence.label.contains("canonical-receipt-ab8"))
    app.buttons["Ordinary saved Listen"].tap()
    let ordinary = app.staticTexts["ab8-ordinary-position"]
    let resumed = NSPredicate(format: "label CONTAINS %@", "0.4")
    XCTAssertEqual(XCTWaiter.wait(for: [expectation(for: resumed, evaluatedWith: ordinary)], timeout: 5), .completed)
  }
}
