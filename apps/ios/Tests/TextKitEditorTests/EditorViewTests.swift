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

  /// A document the user may only read takes no keyboard, and no edit
  /// reaches it however it is asked for.
  @Test func aReadOnlyViewTakesNoEdits() throws {
    let model = Editor()
    let document = LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("one two")])])
    try model.load(document)
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
    let view = EditorView(model: model, isEditable: false)
    view.frame = window.bounds
    window.addSubview(view)
    window.makeKeyAndVisible()
    view.layoutIfNeeded()

    #expect(!view.becomeFirstResponder())
    let three = try #require(view.position(from: view.beginningOfDocument, offset: 3))
    let one = try #require(view.textRange(from: view.beginningOfDocument, to: three))
    view.selectedTextRange = one
    view.toggleBoldface(nil)
    view.insertText("!")
    view.deleteBackward()
    view.replace(one, withText: "1")
    view.setMarkedText("か", selectedRange: NSRange(location: 1, length: 0))
    view.unmarkText()
    view.undoManager?.undo()

    #expect(try model.snapshot().state == document)
  }

  /// What would edit isn't offered on a read-only view, in the edit menu or
  /// on a hardware keyboard.
  @Test func aReadOnlyViewOffersNothingThatEdits() throws {
    let model = Editor()
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("one two")])]))
    let view = EditorView(model: model, isEditable: false)

    for action in [
      #selector(UIResponder.toggleBoldface(_:)), #selector(UIResponder.toggleItalics(_:)),
      #selector(UIResponder.toggleUnderline(_:)),
    ] {
      #expect(!view.canPerformAction(action, withSender: nil), "\(action)")
    }
    #expect(view.canPerformAction(#selector(UIResponder.selectAll(_:)), withSender: nil))
    let keys = view.keyCommands ?? []
    #expect(!keys.contains { [UIKeyCommand.inputDelete, "\u{7F}", "\r"].contains($0.input) })
    #expect(keys.contains { $0.input == UIKeyCommand.inputLeftArrow && $0.modifierFlags.isEmpty })
  }

  /// VoiceOver names a block the editor can't show yet by its type, where
  /// the text holds one character for it.
  @Test func readsABlockItCantShowYetByItsType() throws {
    let model = Editor()
    try model.load(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("Watch this")]), LexicalJSON.youtube("dQw4w9WgXcQ"),
        LexicalJSON.paragraph([LexicalJSON.text("after")]),
      ]))
    let view = EditorView(model: model)

    #expect(view.accessibilityValue == "Watch this\nyoutube\nafter\n")
  }

  /// ⌘⌥0 to ⌘⌥3 and ⌘⌥Q set the block type, as on the web.
  @Test(arguments: [("1", "h1"), ("2", "h2"), ("3", "h3"), ("q", "quote"), ("0", "paragraph")])
  func commandOptionKeysSetTheBlockType(_ input: String, _ type: String) throws {
    let (model, view) = try host(
      LexicalJSON.document([LexicalJSON.heading("h4", [LexicalJSON.text("one")])]), caretAt: 1)

    try press(input, [.command, .alternate], in: view)

    let block = try model.snapshot().state["root"]?["children"]?.arrayValue?.first
    #expect((block?["type"] == "heading" ? block?["tag"] : block?["type"])?.stringValue == type)
    #expect(block?["children"]?.arrayValue?.first?["text"] == "one")
  }

  /// A composition reaches the model as one commit, which can finish a
  /// markdown shortcut as the end of a composition does on the web.
  @Test func aCompositionThatEndsInASpaceFinishesAShortcut() throws {
    let (model, view) = try host(LexicalJSON.document([LexicalJSON.paragraph([])]), caretAt: 0)

    view.setMarkedText("# ", selectedRange: NSRange(location: 2, length: 0))
    view.unmarkText()

    #expect(try model.snapshot().state["root"]?["children"]?.arrayValue?.first?["type"] == "heading")
  }

  @Test func tabIndentsAnItemAndShiftTabOutdentsIt() throws {
    let (model, view) = try host(
      LexicalJSON.document([
        LexicalJSON.list(.bullet, [.item([LexicalJSON.text("a")]), .item([LexicalJSON.text("b")])])
      ]), caretAt: 2)

    try press("\t", [], in: view)
    #expect(
      try model.snapshot().state
        == LexicalJSON.document([
          LexicalJSON.list(.bullet, [.item([LexicalJSON.text("a")]), .nested(.bullet, [.item([LexicalJSON.text("b")])])])
        ]))

    try press("\t", .shift, in: view)
    #expect(
      try model.snapshot().state
        == LexicalJSON.document([
          LexicalJSON.list(.bullet, [.item([LexicalJSON.text("a")]), .item([LexicalJSON.text("b")])])
        ]))
  }

  @Test func tabInsideTextInsertsATab() throws {
    let (model, view) = try host(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("ab")])]), caretAt: 1)

    try press("\t", [], in: view)

    #expect(
      try model.snapshot().state
        == LexicalJSON.document([
          LexicalJSON.paragraph([LexicalJSON.text("a"), LexicalJSON.tab(), LexicalJSON.text("b")])
        ]))
  }

  @Test func listsComeAndGoAndIndentFromTheView() throws {
    let (model, view) = try host(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("a")])]), caretAt: 1)

    view.insertList(.check)
    #expect(
      try model.snapshot().state == LexicalJSON.document([LexicalJSON.list(.check, [.item([LexicalJSON.text("a")])])]))

    view.removeList()
    view.indent()
    view.indent()
    view.outdent()
    #expect(
      try model.snapshot().state == LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("a")], indent: 1)]))
  }

  /// The paragraph's text after the key command for `input` and `modifiers`
  /// runs with the caret `caretAt` UTF-16 offsets into `text`.
  private func text(
    afterPressing input: String, _ modifiers: UIKeyModifierFlags, in text: String, caretAt offset: Int
  ) throws -> String {
    let (model, view) = try host(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text(text)])]), caretAt: offset)
    try press(input, modifiers, in: view)
    let paragraph = try model.snapshot().state["root"]?["children"]?.arrayValue?.first
    return paragraph?["children"]?.arrayValue?.first?["text"]?.stringValue ?? ""
  }

  /// A view of `document`, first responder with the caret `caretAt` UTF-16
  /// offsets into its text.
  private func host(_ document: JSONValue, caretAt offset: Int) throws -> (Editor, EditorView) {
    let model = Editor()
    try model.load(document)
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
    let view = EditorView(model: model)
    view.frame = window.bounds
    window.addSubview(view)
    window.makeKeyAndVisible()
    #expect(view.becomeFirstResponder())
    view.layoutIfNeeded()
    let caret = try #require(view.position(from: view.beginningOfDocument, offset: offset))
    view.selectedTextRange = view.textRange(from: caret, to: caret)
    return (model, view)
  }

  /// Runs the key command for `input` and `modifiers` as UIKit would.
  private func press(_ input: String, _ modifiers: UIKeyModifierFlags, in view: EditorView) throws {
    let command = try #require(view.keyCommands?.first { $0.input == input && $0.modifierFlags == modifiers })
    let action = try #require(command.action)
    view.perform(action, with: command)
  }
}
#endif
