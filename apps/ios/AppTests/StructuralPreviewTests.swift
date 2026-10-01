import XCTest
import UIKit
import LexicalSwift
import TextKitEditor
@testable import EditorHarness

@MainActor final class StructuralPreviewTests: XCTestCase {
  private struct Preview {
    let model: Editor
    let owner: EditorView
    let panel: EmbeddedContentView
    let body: EditorView
  }

  private func preview(_ callout: JSONValue) throws -> Preview {
    let model = Editor()
    try model.load(["root": ["type": "root", "version": 1, "children": [callout]]])
    let owner = EditorView(model: model, isEditable: false)
    owner.frame = CGRect(x: 0, y: 0, width: 400, height: 600)
    configureStructuralBlocks(owner)
    let key = try XCTUnwrap(model.childKeys(at: []).first)
    let panel = try XCTUnwrap(owner.embeddedContent?(key, model.node(at: [0])))
    panel.frame = CGRect(origin: .zero, size: panel.contentSize(fitting: 400))
    panel.layoutIfNeeded()
    func body(in view: UIView) -> EditorView? {
      if let editor = view as? EditorView { return editor }
      return view.subviews.lazy.compactMap { body(in: $0) }.first
    }
    let body = try XCTUnwrap(body(in: panel))
    body.layoutIfNeeded()
    return Preview(model: model, owner: owner, panel: panel, body: body)
  }

  func testCalloutPreviewRetainsParentAlignmentDirectionAndIndent() throws {
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "children": [["type": "text", "version": 1, "text": "שלום abc"]]]
    let fixture = try preview(["type": "callout", "version": 1, "kind": "note", "title": "", "format": "center", "direction": "rtl", "indent": 2, "children": [paragraph]])
    let reference = fixture.owner.makeNestedEditor(model: fixture.model, isEditable: false)
    reference.embeddedElementTypes = []
    reference.frame = fixture.body.bounds
    reference.layoutIfNeeded()
    XCTAssertEqual(fixture.body.caretRect(for: fixture.body.beginningOfDocument).minX,
      reference.caretRect(for: reference.beginningOfDocument).minX, accuracy: 1)
  }

  func testParentIndentRemainsOutsideNestedListPadding() throws {
    let item: JSONValue = ["type": "listitem", "version": 1, "value": 1, "children": [["type": "text", "version": 1, "text": "abc"]]]
    let list: JSONValue = ["type": "list", "version": 1, "listType": "bullet", "tag": "ul", "start": 1, "children": [item]]
    let unindented = try preview(["type": "callout", "version": 1, "kind": "note", "title": "", "indent": 0, "children": [list]])
    let indented = try preview(["type": "callout", "version": 1, "kind": "note", "title": "", "indent": 2, "children": [list]])
    XCTAssertEqual(indented.body.caretRect(for: indented.body.beginningOfDocument).minX,
      unindented.body.caretRect(for: unindented.body.beginningOfDocument).minX + 80, accuracy: 1)
  }

  func testLogicalParentAlignmentAndPaddingRespectTheChildDirection() throws {
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "direction": "ltr", "children": [["type": "text", "version": 1, "text": "abc"]]]
    let plain = try preview(["type": "callout", "version": 1, "kind": "note", "title": "", "format": "start", "direction": "ltr", "indent": 0, "children": [paragraph]])
    let mixed = try preview(["type": "callout", "version": 1, "kind": "note", "title": "", "format": "start", "direction": "rtl", "indent": 2, "children": [paragraph]])
    XCTAssertEqual(mixed.body.caretRect(for: mixed.body.beginningOfDocument).minX,
      plain.body.caretRect(for: plain.body.beginningOfDocument).minX, accuracy: 1)
  }
}
