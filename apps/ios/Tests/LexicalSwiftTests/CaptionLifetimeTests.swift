import LexicalSwift
import LexidrawJSON
import Testing

@Suite struct CaptionLifetimeTests {
  @Test func discardedVideoRedoReleasesItsCaptionEditor() throws {
    let constructor = try #require(MediaInsertions.nodes["video"])
    var fields = try #require(JSONValue(parsing: constructor).objectValue)
    fields["captionsEnabled"] = true
    let parent = Editor()
    try parent.load(document(paragraph(text("Parent")), .object(fields)))
    let key = try #require(parent.childKeys(at: []).last)
    _ = try parent.captionEditor(key: key)
    let expected = try parent.node(at: [1])
    var replacement = try #require(expected.objectValue)
    replacement["width"] = 300
    _ = try parent.replaceEmbeddedNode(key: key, expected: expected, replacement: .object(replacement))
    weak var abandoned = try parent.captionEditor(key: key) as? Editor
    #expect(abandoned != nil)
    try parent.apply(.undo)
    #expect(abandoned != nil)
    try parent.apply(.caret(.text([0, 0], 6)))
    try parent.apply(.insertText("!"))
    #expect(abandoned == nil)
    #expect(try parent.node(at: [1])["width"] == 0)
  }
  @Test func markdownInsideKeyboardGroupReleasesDiscardedVideoRedo() throws {
    let constructor = try #require(MediaInsertions.nodes["video"])
    var fields = try #require(JSONValue(parsing: constructor).objectValue)
    fields["captionsEnabled"] = true
    let parent = Editor()
    try parent.load(document(paragraph(text("#")), .object(fields)))
    let key = try #require(parent.childKeys(at: []).last)
    _ = try parent.captionEditor(key: key)
    let expected = try parent.node(at: [1])
    var replacement = try #require(expected.objectValue)
    replacement["width"] = 300
    _ = try parent.replaceEmbeddedNode(key: key, expected: expected, replacement: .object(replacement))
    weak var abandoned = try parent.captionEditor(key: key) as? Editor
    #expect(abandoned != nil)
    try parent.apply(.undo)
    #expect(abandoned != nil)
    try parent.apply(.caret(.text([0, 0], 1)))
    let turn = parent.beginInputTurn()
    try parent.apply(.insertText("#"))
    try parent.apply(.insertText(" "))
    parent.endInputTurn(turn)
    #expect(abandoned == nil)
    #expect(try parent.node(at: [1])["width"] == 0)
  }
}
