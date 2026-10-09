import Foundation
import LexicalSwift
import Testing
@testable import TextKitEditor

@Suite struct MediaBlockTests {
  @Test(arguments: ["image", "inline-image"]) func imageOnlyParagraphRendersAsAMediaBlockWithoutChangingStoredShape(_ type: String) throws {
    let editor = Editor()
    let image: JSONValue = ["type": .string(type), "version": 1, "src": "https://example.com/a.png", "width": 0, "height": 0]
    try editor.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": [image]]]]])
    let before = try editor.serializedState()
    let rendered = DocumentText(model: editor, style: { _, _ in [:] })
    try rendered.reload(NSMutableAttributedString())
    #expect(rendered.kind(ofBlock: 0) == .embedded(type: type))
    #expect(rendered.payload(ofBlock: 0)?["type"] == .string(type))
    #expect(try editor.serializedState() == before)
  }
}
