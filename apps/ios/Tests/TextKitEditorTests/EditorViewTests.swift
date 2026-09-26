#if canImport(UIKit)
import LexicalFuzz
import LexicalSwift
import Testing
import TextKitEditor
import UIKit

/// The hardware keys a UI script can't press: the simulator never passes
/// Delete or Forward Delete from XCUITest's `typeKey` to the app. These run
/// each key's command as UIKit would on the key.
@MainActor @Suite struct EditorViewTests {
  /// Backspace alone is the keyboard's: it calls `deleteBackward`.
  @Test func backspaceHasNoCommand() throws {
    let model = Editor()
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([])]))
    let commands = EditorView(model: model).keyCommands ?? []
    #expect(!commands.contains { $0.input == UIKeyCommand.inputDelete && $0.modifierFlags.isEmpty })
  }

  @Test func optionDeleteDeletesTheWordBeforeTheCaret() throws {
    #expect(try text(afterPressing: UIKeyCommand.inputDelete, .alternate, in: "one two three", caretAt: 13) == "one two ")
  }

  @Test func commandDeleteDeletesToTheStartOfTheLine() throws {
    #expect(try text(afterPressing: UIKeyCommand.inputDelete, .command, in: "one two three", caretAt: 8) == "three")
  }

  @Test func forwardDeleteDeletesTheCharacterAfterTheCaret() throws {
    #expect(try text(afterPressing: "\u{7F}", [], in: "one two", caretAt: 0) == "ne two")
  }

  @Test func forwardDeleteDeletesAJoinedEmojiWhole() throws {
    let family = "👨‍👩‍👧"
    #expect(
      try text(afterPressing: "\u{7F}", [], in: family + "👍🏽🇯🇵", caretAt: family.utf16.count)
        == family + "🇯🇵")
  }

  @Test func optionForwardDeleteDeletesTheWordAfterTheCaret() throws {
    #expect(try text(afterPressing: "\u{7F}", .alternate, in: "one two", caretAt: 0) == " two")
  }

  /// The paragraph's text after the key command for `input` and `modifiers`
  /// runs with the caret `caretAt` UTF-16 offsets into `text`.
  private func text(
    afterPressing input: String, _ modifiers: UIKeyModifierFlags, in text: String, caretAt offset: Int
  ) throws -> String {
    let model = Editor()
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text(text)])]))
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
    let view = EditorView(model: model)
    view.frame = window.bounds
    window.addSubview(view)
    window.makeKeyAndVisible()
    #expect(view.becomeFirstResponder())
    view.layoutIfNeeded()
    let caret = try #require(view.position(from: view.beginningOfDocument, offset: offset))
    view.selectedTextRange = view.textRange(from: caret, to: caret)
    let command = try #require(view.keyCommands?.first { $0.input == input && $0.modifierFlags == modifiers })
    let action = try #require(command.action)
    view.perform(action, with: command)
    let paragraph = try model.snapshot().state["root"]?["children"]?.arrayValue?.first
    return paragraph?["children"]?.arrayValue?.first?["text"]?.stringValue ?? ""
  }
}
#endif
