import XCTest

/// Presses keys on the simulator's hardware keyboard into a harness that
/// shows, as "hardware keys", how many presses reached it unhandled. Nothing
/// is pressed before the first `press`.
@MainActor
final class HardwareKeyboard {
  private let app: XCUIApplication
  private let element: XCUIElement
  private var isReady = false

  init(_ app: XCUIApplication, typingInto element: XCUIElement) {
    self.app = app
    self.element = element
  }

  func press(_ key: XCUIKeyboardKey, _ modifiers: XCUIElement.KeyModifierFlags = []) {
    press(key.rawValue, modifiers)
  }

  func press(_ key: String, _ modifiers: XCUIElement.KeyModifierFlags = []) {
    if !isReady { ready() }
    isReady = true
    element.typeKey(key, modifierFlags: modifiers)
  }

  /// The simulator drops the first shortcut after the software keyboard
  /// comes up, from a UITextView too, and now and then takes the modifiers
  /// off the next one: Shift+Left arrives as Left, Command-Z as Z. So a Shift
  /// goes first, then Shift+F13, which does nothing with its modifier or
  /// without, and the keys wait for the harness to have been given it.
  private func ready() {
    element.typeKey(XCUIKeyboardKey.shift.rawValue, modifierFlags: [])
    element.typeKey(XCUIKeyboardKey.F13.rawValue, modifierFlags: .shift)
    let given = XCTNSPredicateExpectation(
      predicate: NSPredicate(format: "label != '0'"), object: app.staticTexts["hardware keys"])
    XCTAssertEqual(XCTWaiter.wait(for: [given], timeout: 10), .completed, "The harness was never given Shift+F13")
  }
}
