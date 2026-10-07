import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct StructuralBlockTests {
  @Test func typingInACalloutKeepsItsBodyAndHistory() throws {
    let callout = LexicalJSON.element("callout", [paragraph(text("ab"))], ["kind": "note", "title": ""])
    let fixture = try Fixture.record(
      start: document(callout, paragraph(text("after"))),
      commands: [.caret(.text([0, 0, 0], 1)), .insertText("x"), .undo, .redo],
      on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}

extension StructuralBlockTests {
  @Test func deletionAtTheParagraphAfterACollapsedSectionExpandsIt() throws {
    let section = LexicalJSON.element(
      "collapsible-container",
      [
        LexicalJSON.element("collapsible-title", [text("Title")]),
        LexicalJSON.element("collapsible-content", [paragraph(text("body"))]),
      ], ["open": false])
    for backward in [true, false] {
      let fixture = try Fixture.record(
        start: document(section, paragraph(text("after"))),
        commands: [
          .caret(.text([1, 0], 0)), .deleteCharacter(backward: backward), .undo, .redo,
        ], on: try Support.referenceEditor())
      #expect(try fixture.replay(on: Editor()) == fixture.recorded)
    }
  }

  @Test func stickyCaptionsKeepMarkdownAndPastedMarkupAsPlainText() throws {
    let editor = Editor(plainText: true)
    try editor.load(document(paragraph()))
    try editor.apply(.caret(.init(path: [0], offset: 0, type: .element)))
    try editor.apply(.insertText("#"))
    try editor.apply(.insertText(" "))
    try editor.apply(.insertParagraph)
    try editor.apply(.paste(Clipboard(plainText: "bold\nnext", html: "<b>bold</b><p>next</p>")))
    let children = try #require(editor.node(at: [0])["children"]?.arrayValue)
    #expect(try editor.childKeys(at: []).count == 1)
    #expect(children.map { $0["type"] } == ["text", "linebreak", "text", "linebreak", "text"])
    #expect(children.filter { $0["type"] == "text" }.map { $0["text"] } == ["# ", "bold", "next"])
    #expect(children.filter { $0["type"] == "text" }.allSatisfy { $0["format"] == 0 })
  }

  @Test func typingInLayoutColumnsKeepsTheirBoundaries() throws {
    let columns = LexicalJSON.element(
      "layout-container",
      [
        LexicalJSON.element("layout-item", [paragraph(text("ab"))]),
        LexicalJSON.element("layout-item", [paragraph(text("cd"))]),
      ], ["templateColumns": "1fr 1fr"])
    let fixture = try Fixture.record(
      start: document(columns),
      commands: [
        .caret(.text([0, 0, 0, 0], 1)), .insertText("x"), .insertParagraph, .insertText("y"), .undo, .redo,
      ], on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func stickyCaptionsDoNotAutolinkTypedURLs() throws {
    let editor = Editor(plainText: true)
    try editor.load(document(paragraph()))
    try editor.apply(.caret(.init(path: [0], offset: 0, type: .element)))
    try editor.apply(.insertText("https://example.com "))
    #expect(try editor.node(at: [0, 0])["type"] == "text")
    #expect(try editor.node(at: [0, 0])["text"] == "https://example.com ")
  }
}

extension StructuralBlockTests {
  @Test func editingACollapsibleTitleAndBodyMatchesTheWeb() throws {
    let section = LexicalJSON.element(
      "collapsible-container",
      [
        LexicalJSON.element("collapsible-title", [text("Title")]),
        LexicalJSON.element("collapsible-content", [paragraph(text("body"))]),
      ], ["open": true])
    let fixture = try Fixture.record(
      start: document(section),
      commands: [
        .caret(.text([0, 0, 0], 1)), .insertText("x"),
        .caret(.text([0, 1, 0, 0], 2)), .insertParagraph, .insertText("y"), .undo, .redo,
      ], on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}

extension StructuralBlockTests {
  @Test func aStructuralPanelCommitsAndRejectsStaleUpdates() throws {
    let editor = Editor()
    try editor.load(document(LexicalJSON.element("callout", [paragraph(text("ab"))], ["kind": "note", "title": ""])))
    let key = try #require(editor.childKeys(at: []).first)
    let original = try editor.node(at: [0])
    var fields = try #require(original.objectValue)
    fields["title"] = "A title"
    let changed = JSONValue.object(fields)
    try editor.replaceEmbeddedNode(key: key, expected: original, replacement: changed)
    #expect(try editor.node(at: [0])["title"] == "A title")
    #expect(throws: EditorError.self) {
      try editor.replaceEmbeddedNode(key: key, expected: original, replacement: original)
    }
    try editor.apply(.undo)
    #expect(try editor.node(at: [0]) == original)
    try editor.apply(.redo)
    #expect(try editor.node(at: [0])["title"] == "A title")
  }
}

extension StructuralBlockTests {
  @Test func pageBreaksCanBePastedDeletedAndRestored() throws {
    let pageBreak: JSONValue = ["type": "page-break", "version": 1]
    let fixture = try Fixture.record(
      start: document(paragraph(text("ab"))),
      commands: [
        .caret(.text([0, 0], 1)), .paste(copied("", pageBreak)), .undo, .redo,
      ], on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}

extension StructuralBlockTests {
  @Test func stickyNotesDoNotPreventEditingTheDocument() throws {
    let sticky: JSONValue = [
      "type": "sticky", "version": 1, "color": "yellow", "xOffset": 0, "yOffset": 0,
      "caption": ["editorState": document(paragraph(text("note")))],
    ]
    let fixture = try Fixture.record(
      start: document(sticky, paragraph(text("ab"))),
      commands: [
        .caret(.text([1, 0], 1)), .insertText("x"), .undo, .redo,
      ], on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}

extension StructuralBlockTests {
  /// Stored decks hold whatever the slide editor saved, such as a box kept as
  /// a JSON string and element kinds nothing reads any more (#253).
  @Test func aStoredSlideDeckKeepsTheDocumentEditableAndIsDeletedLikeAnyBlock() throws {
    let deck: JSONValue = ["type": "slide-deck", "version": 1, "data": [
      "currentSlideId": "s1",
      "deckMetadata": ["bigIdea": "Quarterly review"],
      "slides": [["id": "s1", "elements": [
        ["kind": "box", "id": "b1", "x": 0, "y": 0, "width": 300, "height": "inherit", "zIndex": 0,
         "editorStateJSON": #"{"root":{"type":"root","version":1,"children":[]}}"#],
        ["kind": "video", "id": "v1", "src": "https://example.com/a.mp4"],
      ]]],
    ]]
    let start = document(deck, paragraph(text("ab")))
    let editor = Editor()
    try editor.load(start)
    #expect(editor.isEditable)
    #expect(try editor.snapshot().state["root"]?["children"]?.arrayValue?.first == deck)

    let fixture = try Fixture.record(
      start: start,
      commands: [
        .caret(.text([1, 0], 1)), .insertText("x"), .caret(.text([1, 0], 0)), .deleteCharacter(backward: true),
        .undo, .redo,
      ], on: try Support.referenceEditor())
    #expect(fixture.recorded.snapshot.state["root"]?["children"]?.arrayValue?.map { $0["type"] } == ["paragraph"])
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}

extension StructuralBlockTests {
  @Test func backspaceAtACollapsibleTitleMatchesTheWebRepair() throws {
    let section = LexicalJSON.element(
      "collapsible-container",
      [
        LexicalJSON.element("collapsible-title", [text("Title")]),
        LexicalJSON.element("collapsible-content", [paragraph(text("body"))]),
      ], ["open": true])
    let fixture = try Fixture.record(
      start: document(section),
      commands: [
        .caret(.text([0, 0, 0], 0)), .deleteCharacter(backward: true), .undo,
      ], on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}

extension StructuralBlockTests {
  @Test func enterInACollapsibleTitleOpensAndFocusesItsContent() throws {
    let section = LexicalJSON.element(
      "collapsible-container",
      [
        LexicalJSON.element("collapsible-title", [text("Title")]),
        LexicalJSON.element("collapsible-content", [paragraph(text("body"))]),
      ], ["open": false])
    let fixture = try Fixture.record(
      start: document(section),
      commands: [
        .caret(.text([0, 0, 0], 2)), .insertParagraph, .insertText("x"), .undo,
      ], on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}

extension StructuralBlockTests {
  @Test func emptyCalloutsRestoreTheirEditableParagraph() throws {
    let fixture = try Fixture.record(
      start: document(LexicalJSON.element("callout", [], ["kind": "note", "title": ""])),
      commands: [.caret(.init(path: [0], offset: 0, type: .element)), .insertText("x")],
      on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}

extension StructuralBlockTests {
  @Test func malformedLayoutContainersUnwrapTheirContent() throws {
    let layout = LexicalJSON.element("layout-container", [paragraph(text("ab"))], ["templateColumns": "1fr"])
    let fixture = try Fixture.record(
      start: document(layout), commands: [.selectAll, .copy], on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}

extension StructuralBlockTests {
  @Test func malformedCollapsibleContainersRepairTheirChildren() throws {
    let section = LexicalJSON.element(
      "collapsible-container",
      [
        LexicalJSON.element("collapsible-title", [text("Title")]),
        LexicalJSON.element("collapsible-content", [paragraph(text("body"))]),
        paragraph(text("extra")),
      ], ["open": true])
    let fixture = try Fixture.record(
      start: document(section), commands: [.selectAll, .copy], on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}

extension StructuralBlockTests {
  @Test func enterOnAnEmptyLastCalloutLineLeavesTheCallout() throws {
    let callout = LexicalJSON.element("callout", [paragraph(text("body")), paragraph()], ["kind": "tip", "title": ""])
    let fixture = try Fixture.record(
      start: document(callout),
      commands: [
        .caret(.init(path: [0, 1], offset: 0, type: .element)), .insertParagraph, .insertText("after"), .undo,
      ], on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }
}

extension StructuralBlockTests {
  @Test func structuralPanelsResolveInlineStickyKeysAfterTheParentMoves() throws {
    let sticky = try JSONValue(parsing: #require(StructuralBlockConfiguration.insertionNodes["sticky"]))
    let editor = Editor()
    try editor.load(document(paragraph(sticky)))
    let key = try #require(editor.childKeys(at: [0]).first)
    try editor.apply(.caret(.init(path: [0], offset: 0, type: .element)))
    try editor.apply(.insertList(.bullet))
    #expect(try editor.nodePath(for: key) == [0, 0, 0])
    let expected = try editor.node(at: [0, 0, 0])
    var fields = try #require(expected.objectValue)
    fields["color"] = "blue"
    try editor.replaceEmbeddedNode(key: key, expected: expected, replacement: .object(fields))
    #expect(try editor.node(at: [0, 0, 0])["color"] == "blue")
  }
}


extension StructuralBlockTests {
  @Test func panelSetterCommandsKeepTheSourceSelectionAndHistory() throws {
    let sticky = try JSONValue(parsing: #require(StructuralBlockConfiguration.insertionNodes["sticky"]))
    let fixture = try Fixture.record(
      start: document(paragraph(sticky), paragraph(text("after"))),
      commands: [.caret(.text([1, 0], 2)), .updateStructuralFields(path: [0, 0], fields: ["xOffset": 20, "yOffset": 30]), .undo, .redo],
      on: try Support.referenceEditor())
    let observed = try fixture.replay(on: Editor())
    if observed != fixture.recorded { _ = try fixture.write(into: Support.fixturesSource) }
    #expect(observed == fixture.recorded)
  }
}


extension StructuralBlockTests {
  @Test func changingColumnsKeepsTheExistingCaretThroughHistory() throws {
    let column: JSONValue = ["type": "layout-item", "version": 1, "children": [paragraph(text("keep"))]]
    let layout: JSONValue = ["type": "layout-container", "version": 1, "templateColumns": "1fr 1fr", "children": [column, column]]
    let fixture = try Fixture.record(
      start: document(layout),
      commands: [.caret(.text([0, 0, 0, 0], 2)), .updateStructuralFields(path: [0], fields: ["templateColumns": "1fr 1fr 1fr"]), .undo, .redo],
      on: try Support.referenceEditor())
    let observed = try fixture.replay(on: Editor())
    if observed != fixture.recorded { _ = try fixture.write(into: Support.fixturesSource) }
    #expect(observed == fixture.recorded)
  }
}
