import LexicalSwift
import LexidrawJSON
import Testing

@Suite struct OwnedCaptionTests {
  @Test func anUnportedParentCannotBeEditedThroughItsCaption() throws {
    var fields = try #require(JSONValue(parsing: MediaImages.insertionNodeJSON).objectValue)
    fields["showCaption"] = true
    fields["caption"] = ["editorState": document(paragraph(text("Caption")))]
    let parent = Editor()
    try parent.load(document(paragraph(text("Parent")), .object(fields), ["type": "unported", "version": 1]))
    #expect(!parent.isEditable)
    let key = try #require(parent.childKeys(at: [1]).first)
    #expect(throws: EditorError.self) { try parent.captionEditor(key: key) }
  }
  @Test func ownerControlsUseTheLiveCaptionAsTheirStaleCheck() throws {
    var fields = try #require(JSONValue(parsing: MediaImages.insertionNodeJSON).objectValue)
    fields["showCaption"] = true
    fields["caption"] = ["editorState": document(paragraph(text("Caption")))]
    let state = document(paragraph(text("Parent")), .object(fields))
    let parent = Editor()
    try parent.load(state)
    let key = try #require(parent.childKeys(at: [1]).first)
    let caption = try parent.captionEditor(key: key)
    let source = try Support.referenceEditor(editorContext: .imageCaption)
    try source.loadNested(parent: state, ownerPath: [1, 0])
    for command: EditorCommand in [.caret(.text([0, 0], 7)), .insertText("!")] {
      try caption.apply(command)
      try source.apply(command)
    }
    let expected = try parent.node(at: [1, 0])
    var replacement = try #require(expected.objectValue)
    replacement["showCaption"] = false
    try parent.replaceEmbeddedNode(key: key, expected: expected, replacement: .object(replacement))
    try source.setCaptionVisibility(false)
    #expect(try parent.snapshot() == source.parentSnapshot())
  }
  @Test func replacingTheLoadedDocumentInvalidatesItsOpenCaptionEditor() throws {
    var fields = try #require(JSONValue(parsing: MediaImages.insertionNodeJSON).objectValue)
    fields["showCaption"] = true
    fields["caption"] = ["editorState": document(paragraph(text("Caption")))]
    let state = document(paragraph(text("Parent")), .object(fields))
    let parent = Editor()
    try parent.load(state)
    let caption = try parent.captionEditor(key: #require(parent.childKeys(at: [1]).first))
    try caption.apply(.caret(.text([0, 0], 7)))
    try parent.load(state)
    #expect(throws: EditorError.self) { try caption.apply(.insertText("stale")) }
  }
  @Test func captionTabEscapesChildFormatsBeforeDelegatingToTheParent() throws {
    var fields = try #require(JSONValue(parsing: MediaImages.insertionNodeJSON).objectValue)
    fields["showCaption"] = true
    fields["caption"] = ["editorState": document(paragraph(text("Caption")))]
    let state = document(paragraph(text("Parent")), .object(fields))
    let parent = Editor()
    try parent.load(state)
    let caption = try parent.captionEditor(key: #require(parent.childKeys(at: [1]).first))
    let source = try Support.referenceEditor(editorContext: .imageCaption)
    try source.loadNested(parent: state, ownerPath: [1, 0])
    try parent.apply(.caret(.text([0, 0], 0)))
    try source.applyToParent(.caret(.text([0, 0], 0)))
    for command: EditorCommand in [.caret(.text([0, 0], 7)), .formatText(.uppercase), .tab(backward: false)] {
      try caption.apply(command)
      try source.apply(command)
    }
    #expect(try parent.snapshot() == source.parentSnapshot())
    #expect(try caption.snapshot() == source.snapshot())
  }
  @Test func captionListCommandsDelegateToTheActualParent() throws {
    var fields = try #require(JSONValue(parsing: MediaImages.insertionNodeJSON).objectValue)
    fields["showCaption"] = true
    fields["caption"] = ["editorState": document(paragraph(text("Caption")))]
    let state = document(paragraph(text("Parent")), .object(fields))
    let parent = Editor()
    try parent.load(state)
    let caption = try parent.captionEditor(key: #require(parent.childKeys(at: [1]).first))
    let source = try Support.referenceEditor(editorContext: .imageCaption)
    try source.loadNested(parent: state, ownerPath: [1, 0])
    try parent.apply(.caret(.text([0, 0], 0)))
    try source.applyToParent(.caret(.text([0, 0], 0)))
    try caption.apply(.caret(.text([0, 0], 0)))
    try source.apply(.caret(.text([0, 0], 0)))
    let change = try caption.apply(.insertList(.bullet))
    try source.apply(.insertList(.bullet))
    #expect(change.changed.isEmpty)
    #expect(change.parentChanged)
    #expect(try parent.snapshot() == source.parentSnapshot())
    #expect(try caption.snapshot() == source.snapshot())
  }
  @Test func captionEditsKeepTheirOwnHistoryAndSaveThroughTheOwner() throws {
    var fields = try #require(JSONValue(parsing: MediaImages.insertionNodeJSON).objectValue)
    fields["showCaption"] = true
    fields["caption"] = ["editorState": document(paragraph(text("Caption")))]
    let state = document(paragraph(text("Parent")), .object(fields))
    let parent = Editor()
    try parent.load(state)
    let ownerKey = try #require(parent.childKeys(at: [1]).first)
    let caption = try parent.captionEditor(key: ownerKey)
    let source = try Support.referenceEditor(editorContext: .imageCaption)
    try source.loadNested(parent: state, ownerPath: [1, 0])
    let point = Point.text([0, 0], 7)
    try caption.apply(.caret(point))
    try source.apply(.caret(point))
    try caption.apply(.insertText("!"))
    try source.apply(.insertText("!"))
    #expect(try parent.snapshot() == source.parentSnapshot())
    try parent.apply(.undo)
    try source.applyToParent(.undo)
    #expect(try parent.snapshot() == source.parentSnapshot())
    #expect(try caption.snapshot() == source.snapshot())
    try caption.apply(.undo)
    try source.apply(.undo)
    #expect(try parent.snapshot() == source.parentSnapshot())
  }
}
