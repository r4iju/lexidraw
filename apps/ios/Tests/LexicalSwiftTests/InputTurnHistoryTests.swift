import LexicalSwift
import LexicalFuzz
import Testing

@Suite struct InputTurnHistoryTests {
  @Test(arguments: [false, true]) func acceptedPredictionAndAutomaticSpaceUndoTogetherAsSourceTurn(typesAfter: Bool) throws {
    let initial = document(paragraph(text("prefix ")))
    let native = Editor()
    let source = try Support.referenceEditor()
    try native.load(initial)
    try source.load(initial)
    for command: EditorCommand in [.caret(.text([0, 0], 7)), .insertText("H"), .wait(milliseconds: 450), .insertText("e"), .wait(milliseconds: 450), .insertText("l"), .wait(milliseconds: 1500)] {
      try native.apply(command)
      try source.apply(command)
    }
    let acceptance: [EditorCommand] = [.setSelection(anchor: .text([0, 0], 7), focus: .text([0, 0], 10)), .insertText("Hello"), .insertText(" ")]
    try source.applyInputTurn(acceptance)
    let turn = native.beginInputTurn()
    for command in acceptance { try native.apply(command) }
    native.endInputTurn(turn)
    #expect(try native.snapshot() == source.snapshot())
    if typesAfter {
      try native.apply(.insertText("!"))
      try source.apply(.insertText("!"))
    }
    try native.apply(.undo)
    try source.apply(.undo)
    #expect(try native.snapshot() == source.snapshot())
    #expect(try native.serializedState() == document(paragraph(text(typesAfter ? "prefix Hello " : "prefix Hel"))))
    for command: EditorCommand in [.redo, .wait(milliseconds: 1500), .insertText("?"), .undo, .formatText(.bold), .insertText("b"), .undo, .caret(.text([0, 0], 0)), .insertText("x"), .undo] {
      try native.apply(command)
      try source.apply(command)
      #expect(try native.snapshot() == source.snapshot(), "Boundary after \(command)")
    }
  }
}
