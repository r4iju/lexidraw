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

extension StickyCaptionTests {
  @Test func stickyCopyDoesNotExportTheRichLexicalClipboardChannel() throws {
    let json = try #require(StructuralBlockConfiguration.insertionNodes["sticky"])
    var sticky = try #require(JSONValue(parsing: json).objectValue)
    sticky["caption"] = ["editorState": document(paragraph(text("Disposable sticky text")))]
    let state = document(paragraph(.object(sticky)))
    let parent = Editor()
    try parent.load(state)
    let key = try #require(parent.childKeys(at: [0]).first)
    let caption = try parent.captionEditor(key: key)
    let source = try Support.referenceEditor(editorContext: .stickyCaption)
    try source.loadNested(parent: state, ownerPath: [0, 0])
    let selected = EditorCommand.setSelection(anchor: .text([0, 0], 0), focus: .text([0, 0], 21))
    try caption.apply(selected)
    try source.apply(selected)
    let copied = try caption.apply(.copy)
    let recorded = try source.apply(.copy)
    #expect(copied.clipboard == recorded.clipboard)
    #expect(copied.clipboard?.lexical == nil)
  }
}

extension StickyCaptionTests {
  @Test func parentHistoryUsesTimeSpentInTheStickyCaption() throws {
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
    for command: EditorCommand in [.caret(.text([0, 0], 6)), .insertText("A")] {
      try parent.apply(command)
      try source.applyToParent(command)
    }
    try caption.apply(.wait(milliseconds: 1001))
    try source.apply(.wait(milliseconds: 1001))
    try parent.apply(.insertText("B"))
    try source.applyToParent(.insertText("B"))
    try caption.apply(.undo)
    try source.apply(.undo)
    #expect(try caption.snapshot() == source.snapshot())
    #expect(try parent.snapshot() == source.parentSnapshot())
  }
}


extension StickyCaptionTests {
  @Test func standaloneStickyContextDoesNotMountItsOwnHistory() throws {
    let state = document(paragraph(text("sticky")))
    let native = Editor(plainText: true, editorContext: .stickyCaption)
    try native.load(state)
    let source = try Support.referenceEditor(editorContext: .stickyCaption)
    try source.load(state)
    for command: EditorCommand in [.caret(.text([0, 0], 6)), .insertText("!"), .undo, .redo] {
      try native.apply(command)
      try source.apply(command)
      #expect(try native.snapshot() == source.snapshot())
    }
  }
}
