import LexicalSwift
import LexicalFuzz
import LexidrawJSON
import Testing

@Suite struct MentionTypeaheadTests {
  @Test func matcherUsesSourceOffsetsAndJavaScriptUTF16Limits() throws {
    let match = try #require(MentionTypeaheadConfiguration.match("hello @Aay"))
    #expect(match.leadOffset == 6)
    #expect(match.matchingString == "Aay")
    #expect(match.replaceableString == "@Aay")
    #expect(MentionTypeaheadConfiguration.match("@ ") == nil)
    #expect(MentionTypeaheadConfiguration.match("@" + String(repeating: "a", count: 75)) != nil)
    #expect(MentionTypeaheadConfiguration.match("@" + String(repeating: "a", count: 76)) == nil)
    #expect(MentionTypeaheadConfiguration.match("@" + String(repeating: "😀", count: 37) + "a") != nil)
    #expect(MentionTypeaheadConfiguration.match("@" + String(repeating: "😀", count: 38)) == nil)
  }
}

extension MentionTypeaheadTests {
  @Test(arguments: ["image", "inline-image"], [(false, ""), (true, ""), (false, "color: red;"), (true, "color: red;")])
  func sourceMentionSelectionMatchesNativeCaptionPaste(type: String, attributes: (bold: Bool, style: String)) throws {
    let bold = attributes.bold
    let style = attributes.style
    var fields = try #require(JSONValue(parsing: MediaInsertions.nodes[type]!).objectValue)
    fields["showCaption"] = true
    fields["caption"] = ["editorState": document(paragraph(LexicalJSON.text("@Aay", format: bold ? .bold : [], style: style))) ]
    let initial = document(paragraph(.object(fields)))
    let parent = Editor()
    try parent.load(initial)
    let key = try #require(parent.childKeys(at: [0]).first)
    let native = try parent.captionEditor(key: key)
    let source = try Support.referenceEditor(editorContext: type == "image" ? .imageCaption : .inlineImageCaption)
    try source.loadNested(parent: initial, ownerPath: [0, 0])
    try native.apply(.caret(.text([0, 0], 4)))
    try source.apply(.caret(.text([0, 0], 4)))
    try source.selectWholeQueryMention("Aayla Secura")
    var mention = try #require(JSONValue(parsing: MentionTypeaheadConfiguration.mentionNodeJSON).objectValue)
    mention["text"] = "Aayla Secura"
    mention["mentionName"] = "Aayla Secura"
    try native.applyTypeahead(Clipboard(plainText: "Aayla Secura", lexical: LexicalClipboardPayload(namespace: "Lexidraw", nodes: [.object(mention)])), anchor: .text([0, 0], 0), focus: .text([0, 0], 4), preservingTypingAttributes: true)
    let expected = try source.snapshot()
    #expect(try native.serializedState() == expected.state)
    let actualSelection = try native.selection()
    #expect(actualSelection == expected.selection)
    #expect(try parent.serializedState() == source.parentSnapshot().state)
    for command: EditorCommand in [.wait(milliseconds: 1500), .insertText("!"), .undo, .undo, .redo, .redo] {
      try native.apply(command)
      try source.apply(command)
      let actual = try native.snapshot()
      let expected = try source.snapshot()
      #expect(actual == expected, "After \(command)")
      #expect(try parent.serializedState() == source.parentSnapshot().state)
    }
  }
}
