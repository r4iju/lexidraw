import LexicalSwift
import Testing

@Suite struct ReferenceEditorTests {
  @Test func insertsTextAtTheCaretInUTF16Offsets() throws {
    let editor = try Support.referenceEditor()
    try editor.load(document(paragraph(text("hé👍🏽x"), text("bold", format: .bold))))

    try editor.apply(.caret(.text([0, 0], 2)))
    try editor.apply(.insertText("日本"))

    #expect(
      try editor.snapshot()
        == Snapshot(
          state: document(paragraph(text("hé日本👍🏽x"), text("bold", format: .bold))),
          selection: Selection(
            anchor: .text([0, 0], 4), focus: .text([0, 0], 4), format: [], style: "")))
  }

  @Test func aCaretTakesTheFormatOfTheTextItLandsIn() throws {
    let editor = try Support.referenceEditor()
    try editor.load(document(paragraph(text("plain"), text("bold", format: .bold))))

    try editor.apply(.caret(.text([0, 1], 4)))

    #expect(try editor.snapshot().selection?.format == .bold)
  }

  @Test func loadsTheWebEditorsCustomNodes() throws {
    let editor = try Support.referenceEditor()
    let callout: JSONValue = [
      "type": "callout", "version": 1, "children": [], "direction": nil, "format": "",
      "indent": 0,
    ]

    try editor.load(document(callout))
    #expect(try editor.snapshot().state["root"]?["children"]?.arrayValue?.first?["type"] == "callout")

    #expect(throws: (any Error).self) {
      try editor.load(document(["type": "not-a-node", "version": 1]))
    }
  }

  @Test func aCommandOnAMissingNodeThrowsAndChangesNothing() throws {
    let editor = try Support.referenceEditor()
    let start = document(paragraph(text("a")))
    try editor.load(start)

    #expect(throws: (any Error).self) { try editor.apply(.caret(.text([3, 0], 0))) }
    #expect(try editor.snapshot() == Snapshot(state: start, selection: nil))
  }
}
