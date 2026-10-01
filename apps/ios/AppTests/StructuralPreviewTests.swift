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

  private func preview(_ callout: JSONValue, wrapper: ((JSONValue) -> JSONValue)? = nil, path: [Int] = [0], width: CGFloat = 400, editable: Bool = false) throws -> Preview {
    let model = Editor()
    try model.load(["root": ["type": "root", "version": 1, "children": [wrapper?(callout) ?? callout]]])
    let owner = EditorView(model: model, isEditable: editable)
    owner.frame = CGRect(x: 0, y: 0, width: width, height: 600)
    configureStructuralBlocks(owner)
    let key = try XCTUnwrap(model.childKeys(at: Array(path.dropLast()))[path.last!])
    let panel = try XCTUnwrap(owner.embeddedContent?(key, model.node(at: path)))
    panel.frame = CGRect(origin: .zero, size: panel.contentSize(fitting: width))
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

  func testEditableColumnBordersAreDashedAndReadersKeepTheirBoxTransparent() throws {
    let item: JSONValue = ["type": "layout-item", "version": 1, "children": [["type": "paragraph", "version": 1, "children": []]]]
    let node: JSONValue = ["type": "layout-container", "version": 1, "templateColumns": "1fr 1fr", "children": [item, item]]
    func stroke(in fixture: Preview) throws -> CAShapeLayer {
      func columns(in view: UIView) -> NativeColumnsView? {
        if let columns = view as? NativeColumnsView { return columns }
        return view.subviews.lazy.compactMap { columns(in: $0) }.first
      }
      let view = try XCTUnwrap(columns(in: fixture.panel))
      let column = try XCTUnwrap(view.subviews.flatMap(\.subviews).compactMap { $0 as? UIStackView }.first)
      return try XCTUnwrap(column.layer.sublayers?.compactMap { $0 as? CAShapeLayer }.first)
    }
    let editing = try preview(node, width: 800, editable: true)
    let reading = try preview(node, width: 800)
    let border = try stroke(in: editing), transparent = try stroke(in: reading)
    XCTAssertEqual(border.lineWidth, 1)
    XCTAssertFalse(try XCTUnwrap(border.lineDashPattern).isEmpty)
    XCTAssertGreaterThan(try XCTUnwrap(border.strokeColor).alpha, 0)
    XCTAssertEqual(try XCTUnwrap(transparent.strokeColor).alpha, 0)
  }

  func testAnExplicitZeroTrackKeepsItsColumnBoxOverflow() throws {
    let view = NativeColumnsView(tracks: try XCTUnwrap(NativeColumnTrack.parse("minmax(0,0fr) 1fr")), gap: 8)
    let first = UIStackView(), second = UIStackView()
    view.addColumn(first); view.addColumn(second)
    view.prepare(width: 400, stacked: false)
    view.frame = CGRect(x: 0, y: 0, width: 400, height: 200)
    view.layoutIfNeeded()
    XCTAssertEqual(first.frame.width, 18, accuracy: 0.01)
    XCTAssertEqual(second.frame.minX, 8, accuracy: 0.01)
    XCTAssertEqual(second.frame.width, 392, accuracy: 0.01)
  }

  func testTheSourceColumnBoxPaddingStaysOutsideTheNestedEditor() throws {
    let item: JSONValue = ["type": "layout-item", "version": 1, "children": [["type": "paragraph", "version": 1, "children": []]]]
    let fixture = try preview(["type": "layout-container", "version": 1, "templateColumns": "100px 1fr", "children": [item, item]], width: 800)
    XCTAssertEqual(fixture.body.frame.minX, 9, accuracy: 0.01)
    XCTAssertEqual(fixture.body.frame.width, 82, accuracy: 0.01)
  }

  func testRTLColumnsFollowTheLiveInheritedDirection() throws {
    let item: JSONValue = ["type": "layout-item", "version": 1, "children": [["type": "paragraph", "version": 1, "children": []]]]
    let fixture = try preview(["type": "layout-container", "version": 1, "templateColumns": "100px 200px", "children": [item, item]], wrapper: { node in
      ["type": "callout", "version": 1, "kind": "note", "title": "", "direction": "rtl", "children": [node]]
    }, path: [0, 0], width: 800)
    func find(_ view: UIView) -> NativeColumnsView? {
      if let columns = view as? NativeColumnsView { return columns }
      return view.subviews.lazy.compactMap { find($0) }.first
    }
    let columns = try XCTUnwrap(find(fixture.panel))
    let stacks = columns.subviews.flatMap(\.subviews).compactMap { $0 as? UIStackView }
    XCTAssertEqual(stacks.count, 2)
    XCTAssertGreaterThan(stacks[0].frame.minX, stacks[1].frame.minX)
    XCTAssertEqual(stacks[0].frame.maxX, columns.bounds.width, accuracy: 1)
  }

  func testRawZeroFractionReservesTheSourceColumnBoxWithoutMeasuringControls() throws {
    let view = NativeColumnsView(tracks: try XCTUnwrap(NativeColumnTrack.parse("0fr 1fr")), gap: 8)
    let first = UIStackView(), second = UIStackView()
    let word = UILabel(); word.text = "UnbreakableLongWord"
    let control = UIButton(type: .system); control.setTitle("An intentionally much wider native editor control", for: .normal)
    first.addArrangedSubview(word); first.addArrangedSubview(control)
    view.addColumn(first); view.addColumn(second)
    view.prepare(width: 400, stacked: false)
    view.frame = CGRect(x: 0, y: 0, width: 400, height: 200)
    view.layoutIfNeeded()
    // Production CSS: min-width:0, inline-size containment, p-2 and a 1px border.
    XCTAssertEqual(first.frame.width, 18, accuracy: 0.01)
    XCTAssertEqual(second.frame.width, 374, accuracy: 0.01)
  }

  func testNestedCalloutRetainsTheNonPanelAncestorFormatting() throws {
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "children": [["type": "text", "version": 1, "text": "abc"]]]
    let callout: JSONValue = ["type": "callout", "version": 1, "kind": "note", "title": "", "children": [paragraph]]
    let plain = try preview(callout)
    let nested = try preview(callout, wrapper: { node in
      ["type": "list", "version": 1, "listType": "bullet", "tag": "ul", "start": 1, "format": "right", "direction": "rtl", "children": [["type": "listitem", "version": 1, "value": 1, "children": [node]]]]
    }, path: [0, 0, 0])
    XCTAssertGreaterThan(nested.body.caretRect(for: nested.body.beginningOfDocument).minX,
      plain.body.caretRect(for: plain.body.beginningOfDocument).minX + 200)
  }

  func testLogicalParentAlignmentAndPaddingRespectTheChildDirection() throws {
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "direction": "ltr", "children": [["type": "text", "version": 1, "text": "abc"]]]
    let plain = try preview(["type": "callout", "version": 1, "kind": "note", "title": "", "format": "start", "direction": "ltr", "indent": 0, "children": [paragraph]])
    let mixed = try preview(["type": "callout", "version": 1, "kind": "note", "title": "", "format": "start", "direction": "rtl", "indent": 2, "children": [paragraph]])
    XCTAssertEqual(mixed.body.caretRect(for: mixed.body.beginningOfDocument).minX,
      plain.body.caretRect(for: plain.body.beginningOfDocument).minX, accuracy: 1)
  }
}
