import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct EditorStateTests {
  @Test func unknownNodesAndUnknownFieldsSurviveLoadThenSave() throws {
    // Lexical would drop the empty text, but a node nobody knows keeps what it holds.
    let future: JSONValue = [
      "type": "future-block", "version": 3, "shape": ["sides": [1, 2.5], "open": nil],
      "children": [text(""), ["type": "future-inline", "version": 1]],
    ]
    var withAddedField = paragraph(text("known"), ["type": "future-inline", "version": 1], text("node"))
    if case .object(var fields) = withAddedField {
      fields["addedLater"] = ["nested": [true, nil]]
      withAddedField = .object(fields)
    }
    var textWithAddedField = text("more")
    if case .object(var fields) = textWithAddedField {
      fields["reactions"] = ["👍🏽", 2]
      textWithAddedField = .object(fields)
    }
    let state = document(future, withAddedField, paragraph(textWithAddedField))
    let editor = Editor()

    try editor.load(state)

    #expect(try editor.snapshot().state == state)
  }

  /// Typing keeps every earlier state, as undo does, so a copy of the whole
  /// document per update would show here as time growing with its size.
  @Test func anUpdateCostsTheSameInABigDocumentAsInASmallOne() throws {
    func typingTime(nodes: Int) throws -> Duration {
      let paragraphs = nodes / 5
      let editor = Editor()
      try editor.load(
        LexicalJSON.document(
          (0..<paragraphs).map { _ in
            LexicalJSON.paragraph([
              LexicalJSON.text("plain "), LexicalJSON.text("bold", format: 1), LexicalJSON.text(" and "),
              LexicalJSON.text("italic", format: 2),
            ])
          }))
      try editor.apply(.caret(.text([paragraphs / 2, 2], 3)))
      var kept: [EditorState] = []
      let clock = ContinuousClock()
      var fastest: Duration?
      for _ in 0..<5 {
        let elapsed = try clock.measure {
          for _ in 0..<100 {
            try editor.apply(.insertText("a"))
            kept.append(editor.state)
          }
        }
        fastest = min(fastest ?? elapsed, elapsed)
      }
      #expect(kept.count == 500)
      return fastest!
    }

    let small = try typingTime(nodes: 1_000)
    let big = try typingTime(nodes: 9_000)

    #expect(big < small * 2, "1k nodes: \(small), 9k nodes: \(big)")
  }
}
