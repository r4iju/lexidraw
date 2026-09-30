import Foundation
import LexicalSwift
import Testing
@testable import TextKitEditor

@Suite struct MediaBlockTests {
  @Test func imageOnlyParagraphRendersAsAMediaBlockWithoutChangingStoredShape() throws {
    let editor = Editor()
    let image: JSONValue = ["type": "image", "version": 1, "src": "https://example.com/a.png", "width": 640, "height": 320]
    try editor.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": [image]]]]])
    let before = try editor.serializedState()
    let rendered = DocumentText(model: editor, style: { _, _ in [:] })
    try rendered.reload(NSMutableAttributedString())
    #expect(rendered.kind(ofBlock: 0) == .embedded(type: "image"))
    #expect(rendered.payload(ofBlock: 0)?["type"] == "image")
    #expect(try editor.serializedState() == before)
  }
}
