import XCTest

@MainActor final class AutocompleteJourneysUITests: XCTestCase {
  private func journey(_ source: String) throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchEnvironment["BROWSER_SCENARIO"] = "autocomplete-" + source
    app.launch()
    defer { app.terminate() }
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    app.staticTexts["Readme"].firstMatch.tap()
    XCTAssertTrue(app.buttons["Edit"].waitForExistence(timeout: 5))
    app.buttons["Edit"].tap()
    XCTAssertTrue(app.switches["writing-suggestions-opt-in"].waitForExistence(timeout: 5))
    XCTAssertEqual(app.switches["writing-suggestions-opt-in"].value as? String, "0")
    app.switches["writing-suggestions-opt-in"].tap()
    let editor = app.textViews.firstMatch
    editor.tap()
    editor.typeText("The capital of France is ")
    let accept = app.buttons["accept-writing-suggestion"]
    XCTAssertTrue(accept.waitForExistence(timeout: 30), app.debugDescription)
    if source == "local" {
      print("PHYSICAL_LOCAL_SUGGESTION_READY")
      Thread.sleep(forTimeInterval: 4)
    }
    let before = editor.value as? String ?? ""
    XCTAssertFalse(before.contains(source == "local" ? "Paris" : "sentence."))
    let evidence = XCTAttachment(screenshot: app.screenshot())
    evidence.name = "283-\(source)-unaccepted-editor-suggestion"
    evidence.lifetime = .keepAlways
    add(evidence)
    accept.tap()
    XCTAssertNotEqual(editor.value as? String, before)
    app.switches["writing-suggestions-opt-in"].tap()
    XCTAssertFalse(accept.exists)
  }
  func testProEditorUsesAggregateAllowanceAndExplicitAcceptance() throws { try journey("pro") }
  func testBYOKEditorUsesDeviceTransportAndExplicitAcceptance() throws { try journey("byok") }
  func testPhysicalLocalEditorUsesActualModelAndExplicitAcceptance() throws {
    guard ProcessInfo.processInfo.environment["LEXIDRAW_PHYSICAL_LOCAL_CHECK"] == "1" else {
      throw XCTSkip("Explicit physical local compute only")
    }
    try journey("local")
  }
}
