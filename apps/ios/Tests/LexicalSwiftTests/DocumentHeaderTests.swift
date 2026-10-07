import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct DocumentHeaderTests {
  private func withRootState(_ state: JSONValue, _ document: JSONValue) -> JSONValue {
    guard var fields = document["root"]?.objectValue else { return document }
    fields["$"] = state
    return ["root": .object(fields)]
  }

  private let header: JSONValue = [
    "header": [
      "properties": [["key": "点検日", "value": "2026-09-27"], ["key": "状態", "value": "要対応 1件"]],
      "subtitle": "Demo", "toc": true, "cover": ["src": "https://example.com/a.png", "focus": "50% 35%"],
    ]
  ]

  @Test func editingBesideADocumentHeaderMatchesTheWebAndKeepsIt() throws {
    let start = withRootState(header, document(paragraph(text("ab"))))
    let fixture = try Fixture.record(
      start: start, commands: [.caret(.text([0, 0], 1)), .insertText("x"), .undo, .redo],
      on: try Support.referenceEditor())
    let editor = Editor()
    #expect(try fixture.replay(on: editor) == fixture.recorded)
    #expect(try editor.serializedState()["root"]?["$"] == header)
  }

  @Test func otherRootStateKeepsTheDocumentReadOnlyAndIsNamed() throws {
    let editor = Editor()
    try editor.load(withRootState(["unknown": true], document(paragraph(text("ab")))))
    #expect(!editor.isEditable)
    #expect(editor.uneditableParts == ["root state “unknown”"])
  }

  @Test func uneditableNodesAreNamedByType() throws {
    var unread = paragraph(text("b")).objectValue ?? [:]
    unread["unread"] = true
    let editor = Editor()
    try editor.load(document(paragraph(text("a")), .object(unread), .object(unread)))
    #expect(editor.uneditableParts == ["paragraph"])
  }
}
