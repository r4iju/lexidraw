import LexicalSwift
import LexidrawJSON
import Testing

@Suite struct StickyCaptionTests {
  @Test func stickyTypingStaysLiveWhenItsUndoIsOwnedByTheParent() throws {
    let json = try #require(StructuralBlockConfiguration.insertionNodes["sticky"])
    var sticky = try #require(JSONValue(parsing: json).objectValue)
    sticky["caption"] = ["editorState": document(paragraph(text("one")))]
    let state = document(paragraph(text("parent")), paragraph(.object(sticky)))
    let parent = Editor()
    try parent.load(state)
    let key = try #require(parent.childKeys(at: [1]).first)
    let caption = try parent.captionEditor(key: key)
    let source = try Support.referenceEditor(editorContext: .stickyCaption)
    try source.loadNested(parent: state, ownerPath: [1, 0])
    for command: EditorCommand in [.caret(.text([0, 0], 6)), .wait(milliseconds: 1001), .insertText("!")] {
      try parent.apply(command)
      try source.applyToParent(command)
    }
    for command: EditorCommand in [.caret(.text([0, 0], 3)), .insertText("?"), .insertParagraph, .insertText("tail"), .undo] {
      try caption.apply(command)
      try source.apply(command)
      #expect(try caption.snapshot() == source.snapshot())
      #expect(try parent.snapshot() == source.parentSnapshot())
    }
    #expect(!caption.supportsRichText)
    #expect(try parent.captionEditor(key: key) === caption)
  }
}
