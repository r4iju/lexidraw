import Foundation
import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct RenderedEmbedTests {
  @Test func selectedRuleCanBecomeACodeBlock() throws {
    let start = Point(path: [0], offset: 0, type: .element)
    let fixture = try Fixture.record(start: document(paragraph(), LexicalJSON.horizontalRule, paragraph(text("after"))), commands: [
      .caret(start), .arrow(.down, extend: false, native: start, atCellEdge: false), .formatCode,
    ], on: Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func selectedCodeFormattingCreatesRawTextTabs() throws {
    let fixture = try Fixture.record(start: document(paragraph(text("hello\tworld"))), commands: [
      .setSelection(anchor: .text([0, 0], 0), focus: .text([0, 0], 11)), .formatCode,
    ], on: Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func highlightedCodeTextUsesItsOwnPayloadWhenEdited() throws {
    let code: JSONValue = ["type": "code", "version": 1, "children": [["type": "code-highlight", "version": 1, "text": "let answer = 42", "highlightType": "keyword"]]]
    let fixture = try Fixture.record(start: document(code), commands: [
      .setSelection(anchor: .text([0, 0], 3), focus: .text([0, 0], 3)), .insertText("X"), .deleteCharacter(backward: true),
      .setSelection(anchor: .text([0, 0], 1), focus: .text([0, 0], 3)), .formatText(.bold),
    ], on: Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func sourceEditRejectsUnportedCodeChildrenWithoutChangingTheDocument() throws {
    let editor = Editor()
    try editor.load(document(["type": "code", "version": 1, "children": [text("original")]]))
    let before = try editor.serializedState()
    let expected = try editor.nodeForPresentation(at: [0])
    let key = try #require(editor.childKeys(at: []).first)
    var replacement = try #require(expected.objectValue)
    replacement["children"] = [["type": "unported-widget", "version": 1]]
    #expect(throws: EditorError.self) { try editor.replaceRenderedNode(key: key, expected: expected, replacement: .object(replacement)) }
    #expect(try editor.serializedState() == before)
  }

  @Test func codeFormattingMatchesTheWebForCollapsedAndSelectedText() throws {
    let command = try JSONDecoder().decode(EditorCommand.self, from: Data(#"{"type":"formatCode"}"#.utf8))
    for end in [2, 5] {
      let fixture = try Fixture.record(start: document(paragraph(text("hello world"))), commands: [
        .setSelection(anchor: .text([0, 0], 2), focus: .text([0, 0], end)), command,
      ], on: Support.referenceEditor())
      #expect(fixture.expected.state["root"]?["children"]?.arrayValue?.contains { $0["type"] == "code" } == true)
      let actual = try fixture.replay(on: Editor())
      #expect(actual == fixture.recorded)
    }
  }

  @Test func surroundingCodeEditingAndClipboardMatchLexical() throws {
    let code: JSONValue = ["type": "code", "version": 1, "language": "swift", "children": [["type": "code-highlight", "version": 1, "text": "let x = 1", "highlightType": "keyword"]]]
    let input = document(paragraph(text("before")), code, paragraph(text("after")))
    let editor = Editor()
    let reference = try Support.referenceEditor()
    try editor.load(input)
    try reference.load(input)
    #expect(editor.isEditable)
    let point = Point(path: [2, 0], offset: 5, type: .text)
    for command: EditorCommand in [.setSelection(anchor: point, focus: point), .insertText("!"), .undo, .redo, .selectAll] {
      try editor.apply(command)
      try reference.apply(command)
      #expect(try editor.snapshot() == reference.snapshot())
    }
    let copied = try #require(editor.apply(.copy).clipboard)
    let referenceCopy = try reference.apply(.copy).clipboard
    #expect(copied == referenceCopy)
    try editor.apply(.cut)
    try reference.apply(.cut)
    #expect(try editor.snapshot() == reference.snapshot())
    try editor.apply(.paste(copied))
    try reference.apply(.paste(copied))
    #expect(try editor.snapshot() == reference.snapshot())
  }

  @Test func sourceEditKeepsFigureFieldsAndIsOneUndoStep() throws {
    let diagram: JSONValue = ["type": "mermaid", "version": 1, "schema": "graph TD; A-->B", "width": 320, "height": 180]
    let editor = Editor()
    try editor.load(document(diagram, paragraph(text("after"))))
    let original = try editor.serializedState()
    let key = try #require(editor.childKeys(at: []).first)
    let expected = try editor.nodeForPresentation(at: [0])
    var replacement = try #require(expected.objectValue)
    replacement["schema"] = "graph TD; A-->C"
    try editor.replaceRenderedNode(key: key, expected: expected, replacement: .object(replacement))
    #expect(try editor.node(at: [0])["schema"] == "graph TD; A-->C")
    #expect(try editor.node(at: [0])["width"] == 320)
    #expect(throws: EditorError.self) { try editor.replaceRenderedNode(key: key, expected: expected, replacement: .object(replacement)) }
    try editor.apply(.undo)
    #expect(try editor.serializedState() == original)
    try editor.apply(.redo)
    #expect(try editor.node(at: [0])["schema"] == "graph TD; A-->C")
  }
}
