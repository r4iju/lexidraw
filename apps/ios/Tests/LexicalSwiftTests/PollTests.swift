import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct PollTests {
  static let poll: JSONValue = ["type": "poll", "version": 1, "question": "Choose a drawing tool", "options": [
    ["text": "Pen", "uid": "pen", "votes": ["reader"]], ["text": "Pencil", "uid": "pencil", "votes": []],
  ]]

  @Test func aStoredPollRemainsEditableWithoutChangingItsPayload() throws {
    let start = document(paragraph(Self.poll), paragraph(text("after")))
    let native = Editor()
    try native.load(start)
    #expect(native.isEditable)
    let reference = try Support.referenceEditor()
    try reference.load(start)
    #expect(try native.snapshot().state == reference.snapshot().state)
  }
}
