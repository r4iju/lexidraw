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
    func typingInto(nodes: Int) throws -> () throws -> Duration {
      let paragraphs = nodes / 5
      let editor = Editor()
      try editor.load(
        LexicalJSON.document(
          (0..<paragraphs).map { _ in
            LexicalJSON.paragraph([
              LexicalJSON.text("plain "), LexicalJSON.text("bold", format: .bold), LexicalJSON.text(" and "),
              LexicalJSON.text("italic", format: .italic),
            ])
          }))
      try editor.apply(.caret(.text([paragraphs / 2, 2], 3)))
      var kept: [EditorState] = []
      return {
        try ContinuousClock().measure {
          for _ in 0..<100 {
            try editor.apply(.insertText("a"))
            kept.append(editor.state)
          }
        }
      }
    }

    let typeSmall = try typingInto(nodes: 1_000)
    let typeBig = try typingInto(nodes: 9_000)
    // Alternating the two puts a busy machine's slowdowns on both sides.
    var small = try typeSmall()
    var big = try typeBig()
    for _ in 1..<5 {
      small = min(small, try typeSmall())
      big = min(big, try typeBig())
    }

    #expect(big < small * 2, "1k nodes: \(small), 9k nodes: \(big)")
  }
}
