import LexicalSwift
import LexidrawJSON
import Testing

@Suite struct VideoCaptionTests {
  @Test func changedVideoOwnsACopyOfItsLiveCaptionAndSelection() throws {
    let constructor = try #require(MediaInsertions.nodes["video"])
    var fields = try #require(JSONValue(parsing: constructor).objectValue)
    fields["captionsEnabled"] = true
    fields["caption"] = document(paragraph(text("Caption")))
    let initial = document(paragraph(text("Parent")), .object(fields))
    let parent = Editor()
    try parent.load(initial)
    let key = try #require(parent.childKeys(at: []).last)
    let caption = try parent.captionEditor(key: key)
    let source = try Support.referenceEditor(editorContext: .videoCaption)
    try source.loadNested(parent: initial, ownerPath: [1])
    for command: EditorCommand in [.caret(.text([0, 0], 7)), .insertText("!")] {
      try caption.apply(command)
      try source.apply(command)
    }
    let expected = try parent.node(at: [1])
    var replacement = try #require(expected.objectValue)
    replacement["showCaption"] = false
    try parent.replaceEmbeddedNode(key: key, expected: expected, replacement: .object(replacement))
    try source.setCaptionVisibility(false)
    let copied = try parent.captionEditor(key: key)
    #expect(try copied.snapshot() == source.captionOwnerSnapshot())
    #expect(try parent.snapshot() == source.parentSnapshot())
    let before = try parent.snapshot()
    #expect(throws: EditorError.self) { try caption.apply(.insertText("stale")) }
    #expect(try parent.snapshot() == before)
  }
}
