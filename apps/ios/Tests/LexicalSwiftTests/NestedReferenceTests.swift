import LexicalSwift
import LexidrawJSON
import Testing

@Suite struct NestedReferenceTests {
  @Test func delegatedCaptionCommandsObserveTheActualParentEditor() throws {
    var image = try #require(JSONValue(parsing: MediaImages.insertionNodeJSON).objectValue)
    image["caption"] = ["editorState": document(paragraph(text("Disposable caption")))]
    let parent = document(paragraph(text("Disposable parent text")), .object(image))
    let reference = try Support.referenceEditor(editorContext: .imageCaption)
    try reference.loadNested(parent: parent, ownerPath: [1, 0])
    try reference.applyToParent(.caret(.text([0, 0], 0)))
    try reference.apply(.caret(.text([0, 0], 0)))
    let before = try reference.snapshot()
    try reference.apply(.insertList(.bullet))
    #expect(try reference.snapshot() == before)
    #expect(try reference.parentSnapshot().state["root"]?["children"]?.arrayValue?[0]["type"] == "list")
  }
  @Test func captionPluginTransformsDoNotLeakIntoTheParentRegistry() throws {
    let video: JSONValue = ["type": "video", "version": 1, "src": "", "caption": document(paragraph(text("Caption")))]
    let reference = try Support.referenceEditor(editorContext: .videoCaption)
    try reference.loadNested(parent: document(paragraph(text("Before ")), video), ownerPath: [1])
    try reference.applyToParent(.caret(.text([0, 0], 7)))
    try reference.applyToParent(.insertText("#native "))
    let parent = try reference.parentSnapshot().state
    #expect(parent["root"]?["children"]?.arrayValue?[0]["children"]?.arrayValue?.count == 1)
    #expect(parent["root"]?["children"]?.arrayValue?[0]["children"]?.arrayValue?[0]["type"] == "text")
  }
}


extension NestedReferenceTests {
  @Test func stickyCaptionEnterUsesItsActualPlainTextMount() throws {
    let json = try #require(StructuralBlockConfiguration.insertionNodes["sticky"])
    var sticky = try #require(JSONValue(parsing: json).objectValue)
    sticky["caption"] = ["editorState": document(paragraph(text("one")))]
    let reference = try Support.referenceEditor(editorContext: .stickyCaption)
    try reference.loadNested(parent: document(paragraph(.object(sticky))), ownerPath: [0, 0])
    try reference.apply(.caret(.text([0, 0], 3)))
    try reference.apply(.insertParagraph)
    let children = try #require(reference.snapshot().state["root"]?["children"]?.arrayValue)
    #expect(children.count == 1)
    #expect(children[0]["children"]?.arrayValue?.last?["type"] == "linebreak")
  }
}

extension NestedReferenceTests {
  @Test func videoOwnerClonesItsCaptionEditorWhenTheOwnerChanges() throws {
    let video: JSONValue = ["type": "video", "version": 1, "src": "", "showCaption": true,
      "caption": document(paragraph(text("Caption")))]
    let reference = try Support.referenceEditor(editorContext: .videoCaption)
    try reference.loadNested(parent: document(paragraph(text("Parent")), video), ownerPath: [1])
    try reference.apply(.caret(.text([0, 0], 7)))
    try reference.apply(.insertText("!"))
    let before = try reference.snapshot()
    try reference.setCaptionVisibility(false)
    #expect(try reference.captionOwnerSnapshot() == before)
    try reference.apply(.insertText("stale"))
    #expect(try reference.captionOwnerSnapshot() == before)
    #expect(try reference.snapshot() != before)
  }
}

extension NestedReferenceTests {
  @Test func remountedCaptionHistoryStartsAtItsRetainedState() throws {
    var image = try #require(JSONValue(parsing: MediaImages.insertionNodeJSON).objectValue)
    image["showCaption"] = true
    image["caption"] = ["editorState": document(paragraph(text("Caption")))]
    let source = try Support.referenceEditor(editorContext: .imageCaption)
    try source.loadNested(parent: document(paragraph(text("Parent")), .object(image)), ownerPath: [1, 0])
    try source.apply(.caret(.text([0, 0], 7)))
    try source.apply(.insertText("!"))
    let before = try source.snapshot()
    try source.setCaptionVisibility(false)
    try source.setCaptionVisibility(true)
    try source.remountCaption()
    try source.apply(.undo)
    #expect(try source.snapshot() == before)
  }
}
