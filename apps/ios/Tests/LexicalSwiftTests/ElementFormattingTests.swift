import Foundation
import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct ElementFormattingTests {
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
