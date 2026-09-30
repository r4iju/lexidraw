import Foundation
import LexicalSwift
import Testing
@testable import TextKitEditor

@Suite struct RenderedBlockTests {
  @Test func diagramOnlyParagraphUsesItsDecoratorKeyAndPayload() throws {
    let editor = Editor()
    let diagram: JSONValue = ["type": "mermaid", "version": 1, "schema": "graph TD; A-->B", "width": "inherit", "height": "inherit"]
    try editor.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": [diagram]]]]])
    let before = try editor.serializedState()
    let rendered = DocumentText(model: editor, style: { _, _ in [:] })
    try rendered.reload(NSMutableAttributedString())
    #expect(rendered.kind(ofBlock: 0) == .embedded(type: "mermaid"))
    #expect(rendered.payload(ofBlock: 0)?["type"] == "mermaid")
    #expect(rendered.embeddedNode(at: 0)?.key == (try editor.childKeys(at: [0]).first))
    #expect(try editor.serializedState() == before)
  }
}
