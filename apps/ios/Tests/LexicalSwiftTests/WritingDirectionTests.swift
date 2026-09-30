import Foundation
import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct WritingDirectionTests {
  @Test(.enabled(if: Support.environment("RECORD_FIXTURES") != nil))
  func recordWritingDirectionFixtures() throws {
    let start = document(paragraph(text("abc")), paragraph(text("def")))
    let scripts: [(String, [EditorCommand])] = [
      (
        "writing-direction-explicit-and-automatic",
        [
          .selectAll, .setWritingDirection(.rtl), .setWritingDirection(.ltr),
          .setWritingDirection(.auto),
        ]
      ),
      (
        "writing-direction-range-edge",
        [
          .setSelection(anchor: .text([0, 0], 0), focus: .text([1, 0], 0)),
          .setWritingDirection(.rtl),
        ]
      ),
      ("writing-direction-undo", [.caret(.text([0, 0], 0)), .setWritingDirection(.rtl), .undo]),
    ]
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    for (name, commands) in scripts {
      let fixture = try Fixture.record(
        start: start, commands: commands, on: try Support.referenceEditor())
      try (encoder.encode(fixture) + Data("\n".utf8)).write(
        to: Support.fixturesSource.appending(path: "\(name).json"))
    }
  }

  @Test func aRangeEndingAtTheNextBlocksStartLeavesItsDirection() throws {
    let fixture = try Fixture.record(
      start: document(paragraph(text("abc")), paragraph(text("def"))),
      commands: [
        .setSelection(anchor: .text([0, 0], 0), focus: .text([1, 0], 0)),
        .setWritingDirection(.rtl),
      ], on: try Support.referenceEditor())
    #expect(fixture.expected.state["root"]?["children"]?.arrayValue?[1]["direction"] == .null)
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func selectedParagraphsHaveAnExplicitDirectionAndCanReturnToAutomatic() throws {
    let editor = Editor()
    try editor.load(document(paragraph(text("abc")), paragraph(text("def"))))
    try editor.apply(.setSelection(anchor: .text([0, 0], 0), focus: .text([1, 0], 2)))
    for direction in ["rtl", "ltr", "auto"] {
      let command = try JSONDecoder().decode(
        EditorCommand.self,
        from: Data("{\"type\":\"setWritingDirection\",\"direction\":\"\(direction)\"}".utf8))
      try editor.apply(command)
      let expected: JSONValue = direction == "auto" ? .null : .string(direction)
      #expect(try editor.node(at: [0])["direction"] == expected)
      #expect(try editor.node(at: [1])["direction"] == expected)
    }
  }
}
