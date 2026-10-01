import XCTest
import UIKit
import LexicalSwift
import LexidrawJSON
import TextKitEditor
@testable import EditorHarness

@MainActor final class MentionPickerTests: XCTestCase {
  func testImageCaptionPickerInsertsSourceMentionAndSavesLiveParent() async throws {
    let model = Editor()
    try model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": [["type": "image", "version": 1, "src": "", "showCaption": true, "caption": ["editorState": ["root": ["type": "root", "version": 1, "children": []]]]]]]]]])
    let parent = EditorView(model: model, isEditable: true)
    let key = try XCTUnwrap(model.childKeys(at: [0]).first)
    let editor = try parent.makeCaptionEditor(key: key)
    let host = NativeEditorHost(editor: editor)
    host.frame = CGRect(x: 0, y: 0, width: 390, height: 600)
    host.layoutIfNeeded()
    editor.layoutIfNeeded()
    var changes = 0
    parent.onChange = { changes += 1 }
    editor.selectedTextRange = editor.textRange(from: editor.beginningOfDocument, to: editor.beginningOfDocument)
    editor.toggleBoldface(nil)
    editor.insertText("hello @Aay")
    func option(in view: UIView) -> UIButton? {
      if let button = view as? UIButton, button.accessibilityIdentifier == "mention-option-Aayla Secura" { return button }
      return view.subviews.lazy.compactMap { option(in: $0) }.first
    }
    let appears = expectation(for: NSPredicate { _, _ in option(in: host) != nil }, evaluatedWith: host)
    await fulfillment(of: [appears], timeout: 2)
    let button = try XCTUnwrap(option(in: host))
    button.sendActions(for: .touchUpInside)
    let root = try XCTUnwrap(model.node(at: [0, 0])["caption"]?["editorState"]?["root"])
    let paragraph = try XCTUnwrap(root["children"]?.arrayValue?.first)
    let children = try XCTUnwrap(paragraph["children"]?.arrayValue)
    XCTAssertEqual(children.last?["type"], "mention")
    XCTAssertEqual(children.last?["text"], "Aayla Secura")
    XCTAssertEqual(children.last?["mode"], "segmented")
    XCTAssertGreaterThan(changes, 1)
    XCTAssertNil(option(in: host))
    editor.insertText("!")
    let latest = try XCTUnwrap(model.node(at: [0, 0])["caption"]?["editorState"]?["root"]?["children"]?.arrayValue?.first?["children"]?.arrayValue?.last)
    XCTAssertEqual(latest["text"], "!")
    XCTAssertEqual(latest["format"], 1)
  }
}
