import Foundation
import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct ElementFormattingTests {
  @Test func clearingASelectionPreservesUnselectedFormats() throws {
    let command = try JSONDecoder().decode(EditorCommand.self,
      from: Data(#"{"type":"clearFormatting"}"#.utf8))
    let editor = Editor()
    try editor.load(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("abc", format: .bold, style: "font-size: 32px;")])]))
    try editor.apply(.setSelection(anchor: .text([0, 0], 1), focus: .text([0, 0], 2)))
    try editor.apply(command)
    let children = try editor.node(at: [0])["children"]?.arrayValue
    #expect(children?.map { $0["format"]?.intValue } == [1, 0, 1])
    #expect(children?.map { $0["style"]?.stringValue } == ["font-size: 32px;", "", "font-size: 32px;"])
  }

  @Test func increasingFontSizeAtCaretStylesNewTextAndKeepsExistingText() throws {
    let command = try JSONDecoder().decode(EditorCommand.self,
      from: Data(#"{"type":"changeFontSize","increase":true}"#.utf8))
    let editor = Editor()
    try editor.load(document(paragraph(text("abc"))))
    try editor.apply(.caret(.text([0, 0], 1)))
    try editor.apply(command)
    try editor.apply(.insertText("x"))
    let children = try editor.node(at: [0])["children"]?.arrayValue
    #expect(children?[1]["text"] == "x")
    #expect(children?[1]["style"] == "font-size: 17px;")
    #expect(children?[0]["style"] == "")
  }

  @Test func alignmentIncludesTheBlockAtTheRangesFarEdge() throws {
    let command = try JSONDecoder().decode(EditorCommand.self,
      from: Data(#"{"type":"formatElement","format":"center"}"#.utf8))
    let fixture = try Fixture.record(
      start: document(paragraph(text("abc")), paragraph(text("def"))),
      commands: [.setSelection(anchor: .text([0, 0], 0), focus: .text([1, 0], 0)), command],
      on: try Support.referenceEditor())
    #expect(fixture.expected.state["root"]?["children"]?.arrayValue?[1]["format"] == "center")
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}
