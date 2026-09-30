import EditorModelInterface
import Foundation
import LexicalSwift
import Testing

@Suite struct HTMLBlockTests {
  @Test func savedSourceAndForwardFieldsSurviveNativeEditing() throws {
    let node = try JSONValue(
      parsing:
        #"{"type":"html-block","version":1,"block":{"id":"10000000-0000-4000-8000-000000000001","revision":"abc","html":"<input id='x'>","css":"input{color:red}","javascript":"blockReady()","data":{"n":3},"defaults":{"x":5},"description":"Calculator","height":360,"future":{"v":1}},"futureNodeField":true}"#
    )
    let editor = Editor()
    try editor.load(document(node, paragraph(text("After"))))
    #expect(editor.isEditable)
    try editor.apply(.caret(Point(path: [1, 0], offset: 5, type: .text)))
    try editor.apply(.insertText(" edited"))
    let saved = try editor.snapshot().state
    let reopened = Editor()
    try reopened.load(saved)
    let state = try reopened.snapshot().state
    #expect(state["root"]?["children"]?.arrayValue?.first == node)
    #expect(
      state["root"]?["children"]?.arrayValue?[1]["children"]?.arrayValue?[0]["text"]
        == "After edited")
  }
}
