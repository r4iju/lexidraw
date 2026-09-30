import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct SocialTransformTests {
  @Test func footnotePreviewKeepsBlockBreaksAndOmitsOtherReferences() throws {
    let model = Editor()
    let reference: JSONValue = ["type": "footnote-reference", "version": 1, "label": "other"]
    let note: JSONValue = ["type": "footnote-definition", "version": 1, "label": "note", "children": .array([paragraph(text("One"), reference), paragraph(text("Two"))])]
    try model.load(document(note))
    #expect(try model.nodeTextContent(at: [0]) == "One\n\nTwo")
  }

  @Test func footnotesImportInTableCellsWithoutTypingTransforms() throws {
    let commands = MarkdownTableTests.row("|Reader[^note]|[^note]: **A note**|")
    let fixture = try Fixture.record(start: document(paragraph()), commands: commands, on: Support.referenceEditor())
    let result = try fixture.replay(on: Editor())
    let matches = result == fixture.recorded
    #expect(matches)
  }

  @Test func storedFootnotesMatchWebEditingAndReferenceDeletion() throws {
    let reference: JSONValue = ["type": "footnote-reference", "version": 1, "label": "note"]
    var fields = try #require(paragraph(text("Native footnote")).objectValue)
    fields["type"] = "footnote-definition"; fields["label"] = "note"
    let start = document(paragraph(text("Reader"), reference, text(" after")), .object(fields))
    let native = Editor(); try native.load(start)
    #expect(native.isEditable)
    let commands: [EditorCommand] = [.caret(.text([1, 0], 6)), .insertText("x"), .insertParagraph,
      .undo, .caret(.text([0, 2], 0)), .deleteCharacter(backward: true)]
    let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
    #expect(try fixture.replay(on: native) == fixture.recorded)
  }

  @Test func typingAnEmojiShortcodeMatchesTheWeb() throws {
    let commands = [EditorCommand.caret(Point(path: [0], offset: 0, type: .element))]
      + MarkdownShortcutTests.typing(":smile:")
    let fixture = try Fixture.record(start: document(paragraph()), commands: commands, on: Support.referenceEditor())
    #expect(fixture.expected.state == document(paragraph(text("😄"))))
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func emojiShortcodesInAnImportedTableCellMatchTheWeb() throws {
    let commands = MarkdownTableTests.row("|**:smile:**|:unknown_native_sample:|")
    let fixture = try Fixture.record(start: document(paragraph()), commands: commands, on: Support.referenceEditor())
    #expect(MarkdownTableTests.shape(fixture.expected.state) == "table[p(😄)|p(:unknown_native_sample:)]")
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func storedHashtagsRemainEditableWithWebTextBoundaries() throws {
    var fields = try #require(text("#native").objectValue)
    fields["type"] = "hashtag"
    let hashtag = JSONValue.object(fields)
    let start = document(paragraph(hashtag))
    let native = Editor()
    try native.load(start)
    #expect(native.isEditable)
    let commands: [EditorCommand] = [.caret(.text([0, 0], 0)), .insertText("a"),
      .caret(.text([0, 1], 7)), .insertText("b"), .caret(.text([0, 1], 3)), .insertText("x")]
    let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
    #expect(try fixture.replay(on: native) == fixture.recorded)
  }

  @Test func storedKeywordsMatchWebBoundariesAndSplitting() throws {
    var fields = try #require(text("congratulations").objectValue)
    fields["type"] = "keyword"
    let start = document(paragraph(.object(fields)))
    let native = Editor(); try native.load(start)
    #expect(native.isEditable)
    let commands: [EditorCommand] = [.caret(.text([0, 0], 0)), .insertText("a"),
      .caret(.text([0, 1], 15)), .insertText("b"), .caret(.text([0, 1], 3)), .insertParagraph]
    let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
    #expect(try fixture.replay(on: native) == fixture.recorded)
  }

  @Test func storedEmojiTokensMatchTypingDeletionAndFormatting() throws {
    var fields = try #require(text("😄").objectValue)
    fields["type"] = "emoji"; fields["mode"] = "token"; fields["className"] = "emoji"
    let start = document(paragraph(.object(fields)))
    let native = Editor(); try native.load(start)
    #expect(native.isEditable)
    let commands: [EditorCommand] = [.caret(.text([0, 0], 1)), .insertText("x"), .undo,
      .setSelection(anchor: .text([0, 0], 0), focus: .text([0, 0], 1)), .formatText(.bold),
      .deleteCharacter(backward: true)]
    let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
    #expect(try fixture.replay(on: native) == fixture.recorded)
  }

  @Test func storedMentionsMatchSegmentedTypingAndDeletion() throws {
    var fields = try #require(text("Native Reader").objectValue)
    fields["type"] = "mention"; fields["mode"] = "segmented"; fields["detail"] = 1
    fields["mentionName"] = "Native Reader"
    let start = document(paragraph(.object(fields)))
    let native = Editor(); try native.load(start)
    #expect(native.isEditable)
    let commands: [EditorCommand] = [.caret(.text([0, 0], 3)), .insertText("x"), .undo,
      .caret(.text([0, 0], 3)), .deleteCharacter(backward: true), .undo,
      .setSelection(anchor: .text([0, 0], 1), focus: .text([0, 0], 4)), .deleteCharacter(backward: true)]
    let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
    let outcome = try fixture.replay(on: native)
    #expect(outcome == fixture.recorded)
  }

  @Test func splittingAStoredMentionMatchesTheWeb() throws {
    var fields = try #require(text("Native Reader").objectValue)
    fields["type"] = "mention"; fields["mode"] = "segmented"; fields["detail"] = 1; fields["mentionName"] = "Native Reader"
    let start = document(paragraph(.object(fields)))
    let fixture = try Fixture.record(start: start, commands: [.caret(.text([0, 0], 3)), .insertParagraph], on: Support.referenceEditor())
    let native = Editor()
    let outcome = try fixture.replay(on: native)
    #expect(outcome == fixture.recorded)
    try native.load(outcome.snapshot.state)
    #expect(native.isEditable)
  }

  @Test func splittingAStoredHashtagWithEnterMatchesTheWeb() throws {
    var fields = try #require(text("#native").objectValue)
    fields["type"] = "hashtag"
    let start = document(paragraph(.object(fields)))
    let commands: [EditorCommand] = [.caret(.text([0, 0], 3)), .insertParagraph]
    let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}
