#if canImport(UIKit)
import LexicalSwift
import Testing
@testable import TextKitEditor
import UIKit

@MainActor @Suite struct CommentInteractionTests {
  @Test func hiddenCommentMetadataDoesNotAddParagraphSpacing() throws {
    func secondParagraphY(markerCount: Int) throws -> CGFloat {
      let model = Editor()
      let paragraph: JSONValue = ["type": "paragraph", "version": 1, "children": [["type": "text", "version": 1, "text": "Body"]]]
      let marker: JSONValue = ["type": "paragraph", "version": 1, "children": [["type": "thread", "version": 1,
        "thread": ["type": "thread", "id": "thread", "quote": "Body", "comments": []]]]]
      try model.load(["root": ["type": "root", "version": 1, "children": .array([paragraph] + Array(repeating: marker, count: markerCount) + [paragraph])]])
      try model.apply(.caret(.text([markerCount + 1, 0], 0)))
      let view = EditorView(model: model)
      view.frame = CGRect(x: 0, y: 0, width: 390, height: 500)
      let window = UIWindow(frame: view.frame)
      window.addSubview(view); window.makeKeyAndVisible(); view.layoutIfNeeded()
      defer { window.isHidden = true }
      let position = try #require(view.position(from: view.beginningOfDocument, offset: 5 + markerCount * 2))
      return view.caretRect(for: position).minY
    }
    #expect(abs(try secondParagraphY(markerCount: 1) - secondParagraphY(markerCount: 0)) < 0.5)
    #expect(abs(try secondParagraphY(markerCount: 2) - secondParagraphY(markerCount: 0)) < 0.5)
  }

  @Test func deletingAReplyRemovesItAndClonesTheWebThread() throws {
    let model = Editor()
    let first: JSONValue = ["type": "comment", "id": "first", "author": "Reader", "content": "First", "deleted": false, "timeStamp": 0]
    let second: JSONValue = ["type": "comment", "id": "second", "author": "Reader", "content": "Second", "deleted": false, "timeStamp": 0]
    try model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1,
      "children": [["type": "thread", "version": 1, "thread": ["type": "thread", "id": "thread", "quote": "Body", "comments": [first, second], "resolved": true]]]]]]])
    let view = EditorView(model: model)
    #expect(view.deleteCommentReply(threadID: "thread", commentID: "first"))
    let updated = try #require(model.node(at: [0, 0])["thread"])
    #expect(updated["comments"] == .array([second]))
    #expect(updated["resolved"] == nil)
  }

  @Test func resolvingAThreadSchedulesOneContentChange() throws {
    let model = Editor()
    try model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1,
      "children": [["type": "thread", "version": 1, "thread": ["type": "thread", "id": "thread", "quote": "Body", "comments": []]]]]]]])
    let view = EditorView(model: model)
    var saved = 0; view.onChange = { saved += 1 }
    #expect(view.setCommentThreadResolved(id: "thread", resolved: true))
    #expect(try model.node(at: [0, 0])["thread"]?["resolved"] == true)
    #expect(saved == 1)
  }

  @Test func replyingKeepsExistingCommentsAndUsesTheWebThreadClone() throws {
    let model = Editor()
    let first: JSONValue = ["type": "comment", "id": "first", "author": "Original", "content": "First comment", "deleted": false, "timeStamp": 0]
    let thread: JSONValue = ["type": "thread", "version": 1, "thread": ["type": "thread", "id": "thread-one", "quote": "Body", "comments": [first], "resolved": false]]
    try model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": [thread]]]]])
    let view = EditorView(model: model)
    view.configureSocialNodes(userID: "reader", author: "Reader")
    var saved = 0; view.onChange = { saved += 1 }
    #expect(!view.replyToCommentThread(id: "thread-one", content: " "))
    #expect(view.replyToCommentThread(id: "thread-one", content: "Reply"))
    let updated = try #require(model.node(at: [0, 0])["thread"])
    let comments = try #require(updated["comments"]?.arrayValue)
    #expect(comments.count == 2 && comments[0] == first)
    #expect(comments[1]["author"] == "Reader" && comments[1]["content"] == "Reply")
    #expect(updated["resolved"] == nil)
    #expect(saved == 1)
  }

  @Test func creatingACommentAnchorsTheThreadAndSchedulesAutosave() throws {
    let model = Editor()
    let body = String(repeating: "x", count: 110)
    try model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1,
      "children": [["type": "text", "version": 1, "text": .string(body)]]]]]])
    try model.apply(.setSelection(anchor: .text([0, 0], 0), focus: .text([0, 0], 110)))
    let view = EditorView(model: model)
    view.configureSocialNodes(userID: "reader", author: "Reader")
    var saved = 0
    view.onChange = { saved += 1 }
    #expect(!view.insertComment(content: " \t"))
    #expect(view.insertComment(content: "Native comment"))
    let mark = try model.node(at: [0, 0])
    let thread = try #require(model.node(at: [1, 0])["thread"])
    #expect(mark["type"] == "mark")
    #expect(mark["ids"] == .array([try #require(thread["id"])]))
    #expect(thread["quote"] == .string(String(repeating: "x", count: 99) + "…"))
    let comment = try #require(thread["comments"]?.arrayValue?.first)
    #expect(comment["author"] == "Reader" && comment["content"] == "Native comment" && comment["deleted"] == false)
    #expect(saved == 2)
  }
}
#endif
