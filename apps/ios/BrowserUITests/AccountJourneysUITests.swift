import XCTest

@MainActor
final class AccountJourneysUITests: XCTestCase {
  private var app: XCUIApplication!

  override func setUp() async throws {
    guard UIDevice.current.userInterfaceIdiom == .phone else { throw XCTSkip("iPhone account journeys") }
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
    app = XCUIApplication()
  }

  private func launch(_ scenario: String = "account") {
    app.launchEnvironment["BROWSER_SCENARIO"] = scenario
    app.launch()
  }

  private func capture(_ name: String) {
    let attachment = XCTAttachment(screenshot: app.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }

  private func settings() {
    app.buttons["Settings"].tap()
    XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
  }

  func testAIPowerExplainsDeviceSetupAndKeepsProUnavailable() {
    launch("account")
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5))
    settings()
    app.buttons["AI Power"].tap()
    XCTAssertTrue(app.navigationBars["AI Power"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Pro · Coming soon"].exists)
    XCTAssertTrue(app.staticTexts["No key on this device"].waitForExistence(timeout: 5))
    XCTAssertTrue(
      app.staticTexts[
        "Your key stays in this device’s Keychain. Set it up separately on each device. Signing out removes this device’s configured key."
      ].exists)
    XCTAssertTrue(app.buttons["Save Key"].exists)
    XCTAssertFalse(app.buttons["Save Key"].isEnabled)
    capture("279-device-setup")
  }

  func testAIPowerCanSaveReplaceRemoveAndCancelDeviceWork() {
    launch("ai-power")
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5))
    settings()
    app.buttons["AI Power"].tap()
    XCTAssertTrue(app.staticTexts["No key on this device"].waitForExistence(timeout: 5))
    let key = app.secureTextFields["OpenRouter key"]
    key.tap()
    key.typeText("sk-or-v1-ui-distinctive-fake-credential")
    app.buttons["Save Key"].tap()
    XCTAssertTrue(app.buttons["Validate Key"].waitForExistence(timeout: 5))
    app.buttons["Validate Key"].tap()
    XCTAssertTrue(
      app.staticTexts["Key accepted by OpenRouter. Text access is checked when you generate."]
        .waitForExistence(timeout: 5))
    key.tap()
    key.typeText("sk-or-v1-ui-distinctive-replaced-credential")
    app.buttons["Replace Key"].tap()
    XCTAssertTrue(
      app.staticTexts["Key saved. Validate it directly with OpenRouter."].waitForExistence(
        timeout: 5))
    app.buttons["ai-power-source"].tap()
    app.buttons["My OpenRouter key"].tap()
    let before = app.textFields["Text to continue"]
    XCTAssertTrue(before.waitForExistence(timeout: 5))
    before.tap()
    before.typeText("A short ")
    app.buttons["Try Text"].tap()
    let cancel = app.buttons["Cancel"]
    XCTAssertTrue(cancel.waitForExistence(timeout: 5))
    cancel.tap()
    XCTAssertTrue(
      app.staticTexts["Generation stopped. An issued provider request may still be billed."]
        .waitForExistence(timeout: 5))
    app.buttons["Try Text"].tap()
    XCTAssertTrue(app.staticTexts["Text completed on this device."].waitForExistence(timeout: 12))
    app.buttons["Remove Key"].tap()
    XCTAssertTrue(app.staticTexts["No key on this device"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.buttons["Try Text"].isEnabled)
    capture("279-key-lifecycle")
  }

  func testReadAloudConsentStaysReadableAndCanCancelAtAccessibilityTextSize() {
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    launch()
    let actions = app.buttons["Actions for Readme"]
    XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 5))
    for _ in 0..<4 {
      if actions.exists { break }
      app.swipeUp()
    }
    XCTAssertTrue(actions.exists)
    actions.tap()
    app.buttons["Listen"].tap()
    XCTAssertTrue(app.staticTexts["Read aloud with AI"].waitForExistence(timeout: 5))
    let allow = app.buttons["Allow Read Aloud"]
    for _ in 0..<4 { app.swipeUp() }
    XCTAssertFalse(app.staticTexts["Read aloud with AI"].isHittable, "The user can scroll through the disclosure to its end.")
    XCTAssertTrue(allow.isHittable)
    XCTAssertTrue(app.buttons["Cancel"].isHittable)
    capture("272-consent-accessibility-end")
    app.buttons["Cancel"].tap()
    XCTAssertFalse(app.buttons["Allow Read Aloud"].exists)
    XCTAssertTrue(app.buttons["Settings"].exists)
  }

  private func openSignInBrowser() {
    app.buttons["Sign In"].tap()
    let proceed = app.buttons["Continue"]
    if proceed.waitForExistence(timeout: 2) { proceed.tap() }
    else {
      let systemContinue = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["Continue"]
      if systemContinue.waitForExistence(timeout: 5) { systemContinue.tap() }
    }
    XCTAssertTrue(app.webViews.links["Return to Lexidraw"].waitForExistence(timeout: 8))
  }

  func testSignInFailureIsImmediatelyReadableAtAccessibilityTextSize() {
    app.launchArguments = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
    launch("sign-in")
    openSignInBrowser()
    app.webViews.links["Return to Lexidraw"].tap()
    let failure = app.staticTexts["Couldn’t sign in"]
    XCTAssertTrue(failure.waitForExistence(timeout: 8))
    XCTAssertTrue(failure.isHittable)
    XCTAssertTrue(app.buttons["Sign In"].isHittable)
    capture("272-signin-failure-accessibility")
  }

  func testSystemSignInCanCancelThenRecoverFromRefusedExchangeAndOpenLibrary() {
    launch("sign-in")
    XCTAssertTrue(app.staticTexts["A place for your ideas"].waitForExistence(timeout: 5))
    capture("272-signin-light")
    openSignInBrowser()
    capture("272-system-signin-browser")
    app.buttons["Cancel"].tap()
    XCTAssertTrue(app.buttons["Sign In"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Sign In"].isEnabled)
    XCTAssertFalse(app.staticTexts["Couldn’t sign in"].exists)
    openSignInBrowser()
    app.webViews.links["Return to Lexidraw"].tap()
    let busy = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Signing in…")).firstMatch
    XCTAssertTrue(busy.waitForExistence(timeout: 2))
    capture("272-signin-busy")
    XCTAssertTrue(app.staticTexts["Couldn’t sign in"].waitForExistence(timeout: 8))
    capture("272-signin-failure")
    XCTAssertTrue(app.buttons["Sign In"].isEnabled)
    openSignInBrowser()
    app.webViews.links["Return to Lexidraw"].tap()
    XCTAssertTrue(app.tabBars.buttons["Library"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.staticTexts["Readme"].waitForExistence(timeout: 5))
    settings()
    XCTAssertTrue(app.staticTexts["Native Reader"].waitForExistence(timeout: 5))
  }

  func testTypedDeletionKeepsWarningsShowsProgressAndRetainsConfirmationAfterFailure() {
    launch("deletion-failure")
    settings()
    app.buttons["Delete Account"].tap()
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "people you shared them with")).firstMatch.waitForExistence(timeout: 5))
    let field = app.textFields["Type reader@example.test to confirm"]
    XCTAssertTrue(field.waitForExistence(timeout: 5))
    field.tap()
    field.typeText("wrong")
    app.buttons["Hide keyboard"].tap()
    XCTAssertFalse(app.buttons["Delete Account"].isEnabled)
    field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
    field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 5) + "reader@example.test")
    XCTAssertEqual(field.value as? String, "reader@example.test")
    app.buttons["Hide keyboard"].tap()
    let delete = app.buttons["Delete Account"]
    XCTAssertTrue(delete.isEnabled)
    capture("272-delete-confirmation")
    delete.tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Deleting account…")).firstMatch.waitForExistence(timeout: 2))
    capture("272-delete-busy")
    XCTAssertFalse(field.isEnabled)
    XCTAssertFalse(app.navigationBars["Delete Account"].buttons["BackButton"].exists)
    XCTAssertTrue(app.alerts["Couldn’t delete your account"].waitForExistence(timeout: 8))
    capture("272-delete-failure")
    app.alerts.buttons["OK"].tap()
    XCTAssertEqual(field.value as? String, "reader@example.test")
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "can’t undo")).firstMatch.exists)
    XCTAssertTrue(delete.isEnabled)
    delete.tap()
    XCTAssertTrue(app.alerts["Signed out"].waitForExistence(timeout: 8))
    XCTAssertTrue(app.alerts.staticTexts["Your account and everything that was yours are deleted."].exists)
    app.alerts.buttons["OK"].tap()
    XCTAssertTrue(app.buttons["Sign In"].exists)
  }

  func testDeletionConfirmationFailureExplainsRecoveryAndCanRetry() {
    launch("deletion-confirmation-failure")
    settings()
    app.buttons["Delete Account"].tap()
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Checking confirmation…")).firstMatch.waitForExistence(timeout: 2))
    XCTAssertTrue(app.staticTexts["Couldn’t load confirmation"].waitForExistence(timeout: 6))
    XCTAssertFalse(app.textFields.firstMatch.exists)
    app.buttons["Try Again"].tap()
    XCTAssertTrue(app.textFields["Type reader@example.test to confirm"].waitForExistence(timeout: 5))
  }

  func testSignOutShowsProgressRetainsAccountOnLocalFailureAndCanRetry() {
    launch("signout-local-failure")
    settings()
    XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "other devices stay")).firstMatch.exists)
    app.buttons["Sign Out"].tap()
    let busy = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Signing out…")).firstMatch
    XCTAssertTrue(busy.waitForExistence(timeout: 2))
    capture("272-signout-busy")
    XCTAssertFalse(app.buttons["Done"].isEnabled)
    XCTAssertFalse(app.buttons["Delete Account"].isEnabled)
    XCTAssertTrue(app.alerts["Couldn’t sign out"].waitForExistence(timeout: 8))
    capture("272-signout-local-failure")
    XCTAssertTrue(app.alerts.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "still signed in")).firstMatch.exists)
    app.alerts.buttons["OK"].tap()
    XCTAssertTrue(app.staticTexts["Native Reader"].exists)
    app.buttons["Sign Out"].tap()
    XCTAssertTrue(app.buttons["Sign In"].waitForExistence(timeout: 8))
  }

  func testAccountIdentityFailureCanRetryWithoutHidingAccountActions() {
    launch("identity-failure")
    settings()
    XCTAssertTrue(app.staticTexts["Couldn’t load account details"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Sign Out"].exists)
    app.buttons["Try Again"].tap()
    XCTAssertTrue(app.staticTexts["Native Reader"].waitForExistence(timeout: 5))
  }

  func testAccountIdentityAndReadAloudExplanationAreReachableFromEveryDestination() {
    launch()
    for destination in ["Library", "Shared", "Search"] {
      app.tabBars.buttons[destination].tap()
      settings()
      XCTAssertTrue(app.staticTexts["Native Reader"].waitForExistence(timeout: 5))
      app.buttons["Read Aloud"].tap()
      XCTAssertTrue(app.staticTexts["Read aloud with AI"].waitForExistence(timeout: 5))
      XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Your microphone is not used")).firstMatch.exists)
      XCTAssertFalse(app.buttons["Allow Read Aloud"].exists)
      app.navigationBars.buttons["BackButton"].tap()
      app.buttons["Done"].tap()
    }
    app.tabBars.buttons["Library"].tap()
    app.buttons["Projects"].tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].waitForExistence(timeout: 5))
    settings()
    XCTAssertTrue(app.staticTexts["Native Reader"].waitForExistence(timeout: 5))
    app.buttons["Done"].tap()
    XCTAssertTrue(app.staticTexts["Projects plan"].exists)
  }
}
