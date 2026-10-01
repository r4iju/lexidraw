import XCTest
import UIKit
import LexicalSwift
import LexidrawJSON
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

  func testStickyBodyTypingKeepsCaptionLiveAcrossParentUndo() throws {
    let encoded = try XCTUnwrap(StructuralBlockConfiguration.insertionNodes["sticky"])
    let node = try JSONValue(parsing: encoded)
    let fixture = try preview(node, wrapper: { ["type": "paragraph", "version": 1, "children": [$0]] }, path: [0, 0], editable: true)
    let key = try XCTUnwrap(fixture.model.childKeys(at: [0]).first)
    var autosaves = 0
    fixture.owner.onChange = { autosaves += 1 }
    fixture.body.selectedTextRange = fixture.body.textRange(from: fixture.body.beginningOfDocument, to: fixture.body.beginningOfDocument)
    fixture.body.insertText("Live sticky text")
    let edited = try XCTUnwrap(fixture.model.node(at: [0, 0])["caption"]?["editorState"])
    let current = try fixture.model.node(at: [0, 0])
    var changed = try XCTUnwrap(current.objectValue)
    changed["color"] = "pink"
    try fixture.owner.replaceEmbeddedNode(key: key, expected: current, replacement: .object(changed))
    let undo = try XCTUnwrap(fixture.owner.undoManager)
    undo.undo()
    undo.undo()
    XCTAssertEqual(try fixture.model.node(at: [0, 0])["caption"]?["editorState"], edited)
    XCTAssertGreaterThan(autosaves, 0)
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

  func testCalloutTintFollowsDarkTraitsAfterThePanelWasCreated() throws {
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "children": []]
    let fixture = try preview(["type": "callout", "version": 1, "kind": "note", "title": "", "children": [paragraph]])
    fixture.panel.overrideUserInterfaceStyle = .dark
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    try XCTUnwrap(fixture.panel.backgroundColor).resolvedColor(with: UITraitCollection(userInterfaceStyle: .dark)).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    XCTAssertEqual(alpha, 0.14, accuracy: 0.0001) // Source .dark --callout-tint:14%.
  }

  func testRegisteredStickyInsertionShowsItsSourceBackgroundColor() throws {
    let node = try JSONValue(parsing: XCTUnwrap(StructuralBlockConfiguration.insertionNodes["sticky"]))
    let fixture = try preview(node, path: [0, 0]) // Sticky is an inline isolated decorator.
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    try XCTUnwrap(fixture.panel.backgroundColor).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    XCTAssertEqual(alpha, 1)
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

  func testImportedIntrinsicAndBoundedTracksMatchContainedBrowserColumns() throws {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "contained-grid-browser", withExtension: "json"))
    let fixture = try JSONValue(parsing: String(decoding: Data(contentsOf: url), as: UTF8.self))
    for record in fixture["unsupportedCases"]?.arrayValue ?? [] {
      let template = try XCTUnwrap(record["template"]?.stringValue)
      let tracks = try XCTUnwrap(NativeColumnTrack.parse(template))
      XCTAssertNil(NativeColumnTrack.resolve(tracks, width: 400, gap: 8, occupied: 2), template)
    }
    for record in try XCTUnwrap(fixture["cases"]?.arrayValue) {
      let template = try XCTUnwrap(record["template"]?.stringValue)
      let tracks = try XCTUnwrap(NativeColumnTrack.parse(template), template)
      let view = NativeColumnsView(tracks: tracks, gap: 8)
      let expectedFrames = try XCTUnwrap(record["frames"]?.arrayValue)
      let width = try XCTUnwrap(record["width"]?.numberValue)
      let columns = expectedFrames.map { _ in UIStackView() }
      columns.forEach(view.addColumn)
      view.prepare(width: width, stacked: false)
      view.frame = CGRect(x: 0, y: 0, width: width, height: 200)
      view.layoutIfNeeded()
      for (column, expected) in zip(columns, expectedFrames) {
        XCTAssertEqual(column.frame.minX, try XCTUnwrap(expected["x"]?.numberValue), accuracy: 0.05, template)
        XCTAssertEqual(column.frame.width, try XCTUnwrap(expected["width"]?.numberValue), accuracy: 0.05, template)
      }
    }
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

  private func section(open: Bool, title: String = "Adidas Checked Wide Pants / JF5016", lines: Int = 1) -> JSONValue {
    func paragraph(_ text: String) -> JSONValue {
      ["type": "paragraph", "version": 1, "children": [["type": "text", "version": 1, "text": .string(text)]]]
    }
    return ["type": "collapsible-container", "version": 1, "open": .bool(open), "children": [
      ["type": "collapsible-title", "version": 1, "children": [paragraph(title)]],
      ["type": "collapsible-content", "version": 1, "children": .array((0..<lines).map { paragraph("Line \($0)") })],
    ]]
  }
  private func disclosure(in view: UIView) -> UIControl? {
    if let control = view as? UIControl, control.accessibilityTraits.contains(.button), control.accessibilityValue != nil { return control }
    return view.subviews.lazy.compactMap { self.disclosure(in: $0) }.first
  }

  // "Shopping - Clothing" at 704px: a closed item is a 46px bordered row, its
  // title after a 16px chevron, and no other controls. Text is in ems of the
  // body font, 16px on the web: the title's 1.5em line and 0.75em margin.
  private var sectionRow: CGFloat { 2 * 4 + 2.25 * UIFont.preferredFont(forTextStyle: .body).pointSize }
  func testAClosedSectionIsTheWebsBorderedDisclosureRow() throws {
    let fixture = try preview(section(open: false), width: 704)
    XCTAssertEqual(fixture.panel.frame.height, 2 + sectionRow, accuracy: 1)
    XCTAssertEqual(fixture.panel.layer.borderWidth, 1)
    XCTAssertEqual(fixture.panel.layer.cornerRadius, 10)
    let title = fixture.body.textInputView.convert(fixture.body.caretRect(for: fixture.body.beginningOfDocument), to: fixture.panel)
    XCTAssertEqual(title.minX, 41, accuracy: 1)
    let visibleButtons = fixture.panel.subviews.flatMap { [$0] + $0.subviews }.compactMap { $0 as? UIButton }.filter { !$0.isHidden }
    XCTAssertEqual(visibleButtons.compactMap { $0.title(for: .normal) }, [])
    let control = try XCTUnwrap(disclosure(in: fixture.panel))
    XCTAssertEqual(control.accessibilityLabel, "Adidas Checked Wide Pants / JF5016")
    XCTAssertEqual(control.accessibilityValue, "Collapsed")
  }

  func testAnOpenSectionShowsAllOfItsContentBelowTheRow() throws {
    let fixture = try preview(section(open: true, lines: 40), width: 704)
    func editors(in view: UIView) -> [EditorView] {
      if let editor = view as? EditorView { return [editor] }
      return view.subviews.flatMap(editors)
    }
    let content = try XCTUnwrap(editors(in: fixture.panel).max { $0.frame.maxY < $1.frame.maxY })
    // Nothing of the content is scrolled away inside a fixed-height box.
    XCTAssertGreaterThanOrEqual(content.frame.height, content.contentSize.height - 1)
    XCTAssertGreaterThan(fixture.panel.frame.height, 40 * 20)
    let first = content.textInputView.convert(content.caretRect(for: content.beginningOfDocument), to: fixture.panel)
    XCTAssertEqual(first.minX, 17, accuracy: 1)
    XCTAssertEqual(first.minY, 1 + sectionRow, accuracy: 4)
  }

  // Between two items the web keeps the item's 0.75em block margin and the
  // empty paragraph the document stores there, a 1.6em line and its 0.75em.
  func testSectionsKeepTheWebsSpacingAroundTheEmptyParagraphBetweenThem() throws {
    let model = Editor()
    try model.load(["root": ["type": "root", "version": 1, "children": [
      section(open: false), ["type": "paragraph", "version": 1, "children": []], section(open: false, title: "Second"),
      ["type": "paragraph", "version": 1, "children": [["type": "text", "version": 1, "text": "after"]]],
    ]]])
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 736, height: 1000))
    let owner = EditorView(model: model, isEditable: false)
    configureStructuralBlocks(owner)
    owner.frame = window.bounds
    window.addSubview(owner)
    window.makeKeyAndVisible()
    owner.layoutIfNeeded()
    func panels(in view: UIView) -> [UIView] {
      if view.layer.borderWidth > 0, view !== owner { return [view] }
      return view.subviews.flatMap(panels)
    }
    let boxes = panels(in: owner).map { $0.convert($0.bounds, to: owner) }.sorted { $0.minY < $1.minY }
    XCTAssertEqual(boxes.count, 2)
    guard boxes.count == 2 else { return }
    let em = UIFont.preferredFont(forTextStyle: .body).pointSize
    XCTAssertEqual(boxes[1].minY - boxes[0].maxY, (0.75 + 1.6 + 0.75) * em, accuracy: 1.5)
  }

  func testTheDisclosureRowTogglesAReadOnlySectionWithoutEditingIt() throws {
    let fixture = try preview(section(open: false), width: 704)
    let node = try fixture.model.node(at: [0])
    let control = try XCTUnwrap(disclosure(in: fixture.panel))
    control.sendActions(for: .primaryActionTriggered)
    XCTAssertEqual(disclosure(in: fixture.panel)?.accessibilityValue, "Expanded")
    XCTAssertGreaterThan(fixture.panel.contentSize(fitting: 704).height, 60)
    XCTAssertEqual(try fixture.model.node(at: [0]), node)
  }

  func testLogicalParentAlignmentAndPaddingRespectTheChildDirection() throws {
    let paragraph: JSONValue = ["type": "paragraph", "version": 1, "direction": "ltr", "children": [["type": "text", "version": 1, "text": "abc"]]]
    let plain = try preview(["type": "callout", "version": 1, "kind": "note", "title": "", "format": "start", "direction": "ltr", "indent": 0, "children": [paragraph]])
    let mixed = try preview(["type": "callout", "version": 1, "kind": "note", "title": "", "format": "start", "direction": "rtl", "indent": 2, "children": [paragraph]])
    XCTAssertEqual(mixed.body.caretRect(for: mixed.body.beginningOfDocument).minX,
      plain.body.caretRect(for: plain.body.beginningOfDocument).minX, accuracy: 1)
  }
}
