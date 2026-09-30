import Foundation
import LexicalSwift
import Testing
@testable import TextKitEditor

@Suite struct SocialBlockTests {
  @Test func aPollOnlyParagraphRendersAsANativeSocialBlock() throws {
    let model = Editor()
    let poll: JSONValue = ["type": "poll", "version": 1, "question": "Native poll", "options": []]
    try model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": [poll]]]]])
    let text = DocumentText(model: model, style: { _, _ in [:] })
    try text.reload(NSMutableAttributedString())
    #expect(text.kind(ofBlock: 0) == .embedded(type: "poll"))
    #expect(text.payload(ofBlock: 0)?["question"] == "Native poll")
  }
}
