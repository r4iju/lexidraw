import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct MediaTests {
  static let nodes: [JSONValue] = [
    ["type": "image", "version": 1, "src": "https://example.com/photo.png", "altText": "Photo", "width": 640, "height": 480, "$": ["figure": ["caption": "A figure", "width": "wide"]]],
    ["type": "inline-image", "version": 1, "src": "https://example.com/inline.png", "altText": "Inline", "width": 32, "height": 32, "position": "left"],
    ["type": "video", "version": 1, "src": "https://example.com/movie.mp4", "width": 640, "height": 360],
    ["type": "youtube", "version": 1, "videoID": "dQw4w9WgXcQ"],
    ["type": "tweet", "version": 1, "id": "123456789"],
    ["type": "figma", "version": 1, "documentID": "abc123"],
  ]

  @Test func mountedCaptionMentionKeepsDocumentEditable() throws {
    let mention: JSONValue = ["type": "mention", "version": 1, "text": "Aayla Secura", "mentionName": "Aayla Secura", "mode": "segmented", "format": 0, "style": "", "detail": 0]
    let caption = LexicalJSON.document([LexicalJSON.paragraph([mention])])
    for type in ["image", "inline-image"] {
      let image: JSONValue = ["type": .string(type), "version": 1, "src": "https://example.com/disposable.png", "showCaption": true, "caption": ["editorState": caption]]
      let editor = Editor()
      try editor.load(document(image))
      #expect(MediaCaptionSupport.refusal(in: caption) == nil)
      #expect(editor.isEditable)
    }
  }

  @Test func supportedCaptionColorsAllowSurroundingEdits() throws {
    let caption = LexicalJSON.document([LexicalJSON.paragraph([
      LexicalJSON.text("caption", style: "color: red; background-color: #0000ff;")
    ])])
    var fields = try #require(Self.nodes[0].objectValue)
    fields["showCaption"] = true
    fields["caption"] = ["editorState": caption]
    let editor = Editor()
    try editor.load(document(paragraph(text("before")), .object(fields)))
    #expect(MediaCaptionSupport.refusal(in: caption) == nil)
    #expect(editor.isEditable)
  }

  @Test func anUnportedCaptionStyleDoesNotSilentlyEnableEditing() throws {
    let caption: JSONValue = ["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": [["type": "text", "version": 1, "text": "styled", "format": 0, "style": "text-shadow: 2px 2px red;"]]]]]]
    let image: JSONValue = ["type": "image", "version": 1, "src": "https://example.com/a.png", "showCaption": true, "caption": ["editorState": caption]]
    let editor = Editor()
    try editor.load(document(paragraph(text("before")), image))
    #expect(!editor.isEditable)
    #expect(throws: EditorError.self) { try editor.apply(caret([0, 0], 0)) }
  }

  @Test(arguments: nodes)
  func mediaRoundTripsAndAllowsSurroundingEdits(_ node: JSONValue) throws {
    let start = document(paragraph(text("before")), node, paragraph(text("after")))
    let reference = try Support.referenceEditor()
    try reference.load(start)
    let editor = Editor()
    try editor.load(start)
    #expect(editor.isEditable)
    #expect(try editor.serializedState() == reference.serializedState())
    let commands: [EditorCommand] = [caret([0, 0], 6), .insertText(" edited"), .undo, .redo]
    let fixture = try Fixture.record(start: start, commands: commands, on: reference)
    #expect(try fixture.replay(on: editor) == fixture.recorded)
  }

  @Test(arguments: nodes)
  func mediaPastesLikeTheWeb(_ node: JSONValue) throws {
    let start = document(paragraph(text("before after")))
    let commands: [EditorCommand] = [caret([0, 0], 7), .paste(copied("", node)), .undo, .redo]
    let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}
