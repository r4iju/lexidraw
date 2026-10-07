import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct SocialTransformTests {
  @Test func imageCaptionKeepsItsActualRestrictedNodeRegistry() throws {
    for context: EditorContext in [.imageCaption, .inlineImageCaption] {
      #expect(throws: EditorError.self) { try Editor(editorContext: context).load(document(heading("h2", text("Caption heading")))) }
    }
  }
  @Test func nestedEditorTransformsFollowEachMountedWebContext() throws {
    for context: EditorContext in [.imageCaption, .inlineImageCaption, .videoCaption] {
      let start = document(paragraph(text("Before ", format: .bold)))
      let commands: [EditorCommand] = [.caret(.text([0, 0], 7)), .insertText("#native congratulations :) "), .undo, .redo]
      let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor(editorContext: context))
      let outcome = try fixture.replay(on: Editor(editorContext: context))
      #expect(outcome == fixture.recorded)
    }
  }
  @Test func storedKeywordModesFollowTheActualTextEntityClass() throws {
    for mode in ["token", "segmented"] {
      var fields = try #require(text("congratulations").objectValue)
      fields["type"] = "keyword"; fields["mode"] = .string(mode)
      let start = document(paragraph(.object(fields)))
      let editor = Editor(); try editor.load(start)
      #expect(editor.isEditable)
      let commands: [EditorCommand] = [.caret(.text([0, 0], 4)), .insertText("x"), .undo,
        .caret(.text([0, 0], 4)), .deleteCharacter(backward: true), .undo,
        .setSelection(anchor: .text([0, 0], 2), focus: .text([0, 0], 8)), .formatText(.bold), .undo, .redo]
      let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
      #expect(try fixture.replay(on: editor) == fixture.recorded)
    }
  }
  @Test func malformedArticleDataStaysReadOnly() throws {
    let editor = Editor()
    try editor.load(document(["type": "article", "version": 1, "format": ""]))
    #expect(!editor.isEditable)
  }

  @Test func convertsArticleBodyAsTheWebDoesAndUndoesAsOneUpdate() throws {
    let article: JSONValue = ["type": "article", "version": 1, "format": "", "data": ["mode": "url", "url": "https://example.test", "distilled": ["title": "Article", "contentHtml": "<h2>Heading</h2><p>Body <strong>bold</strong>.</p>"]]]
    let fixture = try Fixture.record(start: document(article, paragraph(text("After"))), commands: [.convertArticle(path: [0], html: "<h2>Heading</h2><p>Body <strong>bold</strong>.</p>"), .undo, .redo], on: Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func malformedCommentPayloadsStayReadOnly() throws {
    for marker: JSONValue in [
      ["type": "comment", "version": 1, "comment": ["id": "partial"]],
      ["type": "thread", "version": 1, "thread": ["type": "thread", "id": "thread", "quote": "Body", "comments": [["id": "partial"]]]]
    ] {
      let editor = Editor()
      try editor.load(document(paragraph(marker)))
      #expect(!editor.isEditable)
    }
  }

  @Test func deletingCommentsRemovesBothMarkerKindsWithTheSameID() throws {
    let comment: JSONValue = ["type": "comment", "version": 1,
      "comment": ["type": "comment", "id": "same", "author": "Reader", "content": "Imported", "deleted": false, "timeStamp": 0]]
    let thread: JSONValue = ["type": "thread", "version": 1, "thread": ["type": "thread", "id": "same", "quote": "Body", "comments": []]]
    let fixture = try Fixture.record(start: document(paragraph(comment), paragraph(thread)),
      commands: [.saveCommentThread(id: "same", thread: nil), .undo, .redo], on: Support.referenceEditor())
    let outcome = try fixture.replay(on: Editor())
    #expect(outcome == fixture.recorded)
  }

  @Test func deletingAThreadKeepsOtherAnnotationsAndUnwrapsItsOwnMarks() throws {
    func mark(_ ids: [String], _ body: String) -> JSONValue {
      ["type": "mark", "version": 1, "ids": .array(ids.map(JSONValue.string)), "children": .array([text(body)])]
    }
    let thread: JSONValue = ["type": "thread", "version": 1, "thread": ["type": "thread", "id": "one", "quote": "SharedOnly", "comments": []]]
    let start = document(paragraph(mark(["one", "two"], "Shared"), mark(["one"], "Only")), paragraph(thread))
    let commands: [EditorCommand] = [.saveCommentThread(id: "one", thread: nil), .removeCommentAnnotations(id: "one"), .undo, .redo]
    let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
    let outcome = try fixture.replay(on: Editor())
    #expect(outcome == fixture.recorded)
  }

  @Test func savingAThreadUpdatesEveryStoredMarkerWithThatID() throws {
    let original: JSONValue = ["type": "thread", "id": "thread-one", "quote": "Selected text", "comments": [], "resolved": false]
    let marker: JSONValue = ["type": "thread", "version": 1, "thread": original]
    var resolved = try #require(original.objectValue)
    resolved["resolved"] = true
    let commands: [EditorCommand] = [.saveCommentThread(id: "thread-one", thread: .object(resolved)), .undo, .redo]
    let start = document(paragraph(marker), paragraph(marker))
    let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
    let outcome = try fixture.replay(on: Editor())
    #expect(outcome == fixture.recorded)
  }

  @Test func anchoringAThreadMatchesWebSelectionWrapping() throws {
    let start = document(paragraph(text("First paragraph")), paragraph(text("Second paragraph")))
    for backward in [false, true] {
      let startPoint = Point.text([0, 0], 3), endPoint = Point.text([1, 0], 6)
      let commands: [EditorCommand] = [.setSelection(anchor: backward ? endPoint : startPoint, focus: backward ? startPoint : endPoint), .annotateComment(id: "native-thread")]
      let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
      let outcome = try fixture.replay(on: Editor())
      #expect(outcome == fixture.recorded)
    }
  }

  @Test func addingAnUnanchoredCommentMatchesTheWebRootMarker() throws {
    let comment: JSONValue = ["type": "comment", "version": 1,
      "comment": ["type": "comment", "id": "disposable-comment", "author": "Reader", "content": "Native comment", "deleted": false, "timeStamp": 0]]
    let commands: [EditorCommand] = [.appendComment(comment), .undo, .redo]
    let fixture = try Fixture.record(start: document(paragraph(text("Document"))), commands: commands, on: Support.referenceEditor())
    let outcome = try fixture.replay(on: Editor())
    #expect(outcome == fixture.recorded)
  }

  @Test func overlappingCommentMarksFlattenLikeTheMountedPlugin() throws {
    func mark(_ id: String, _ children: JSONValue...) -> JSONValue {
      ["type": "mark", "version": 1, "ids": .array([.string(id)]), "children": .array(children)]
    }
    let start = document(paragraph(mark("outer", text("Before "), mark("inner", text("Shared")), text(" After"))))
    let commands: [EditorCommand] = [.caret(.text([0, 0, 1, 0], 3)), .insertText("x")]
    let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func partialAndWholeCommentMarkCopiesMatchTheWeb() throws {
    var fields = try #require(paragraph(text("Annotated words")).objectValue)
    fields["type"] = "mark"; fields["ids"] = ["native-thread"]
    let start = document(paragraph(.object(fields)))
    for end in [5, 15] {
      let commands: [EditorCommand] = [.setSelection(anchor: .text([0, 0, 0], 0), focus: .text([0, 0, 0], end)), .copy]
      let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
      #expect(try fixture.replay(on: Editor()) == fixture.recorded)
    }
  }

  @Test func storedCommentMarksMatchBoundaryTypingAndParagraphSplits() throws {
    var fields = try #require(paragraph(text("Annotated words")).objectValue)
    fields["type"] = "mark"; fields["ids"] = ["native-thread"]
    let start = document(paragraph(.object(fields)))
    let native = Editor(); try native.load(start)
    #expect(native.isEditable)
    let commands: [EditorCommand] = [.caret(.text([0, 0, 0], 0)), .insertText("before"), .undo,
      .caret(.text([0, 0, 0], 15)), .insertText("after"), .undo,
      .caret(.text([0, 0, 0], 5)), .insertParagraph]
    let fixture = try Fixture.record(start: start, commands: commands, on: Support.referenceEditor())
    #expect(try fixture.replay(on: native) == fixture.recorded)
  }

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
