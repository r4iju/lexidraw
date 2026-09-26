#if canImport(UIKit)
import LexicalFuzz
import LexicalSwift
import Testing
import TextKitEditor
import UIKit

/// What the layout owes text input and scrolling, seen through `UITextInput`
/// and the scroll view as UIKit sees them.
@MainActor @Suite struct LayoutTests {
  /// A tap where the caret for an offset is drawn puts the caret there, in
  /// every block, table cells included.
  @Test
  func aTapOnACaretLandsOnIt() throws {
    try Self.expectEveryCaretToLandOnItself(try Self.host(Self.titledTable))
  }

  static func text(of view: EditorView) throws -> String {
    let whole = try #require(view.textRange(from: view.beginningOfDocument, to: view.endOfDocument))
    return try #require(view.text(in: whole))
  }

  static func expectEveryCaretToLandOnItself(_ view: EditorView) throws {
    let text = try text(of: view)
    for offset in 0...text.utf16.count {
      let position = try #require(view.position(from: view.beginningOfDocument, offset: offset))
      let caret = view.caretRect(for: position)
      let landed = try #require(view.closestPosition(to: CGPoint(x: caret.minX, y: caret.midY)))
      #expect(view.offset(from: view.beginningOfDocument, to: landed) == offset, "\(text.debugDescription) at \(offset)")
    }
  }

  /// Composing in a cell grows and shrinks that cell alone: the cells after
  /// it keep their text, and a tap on any caret still lands on it.
  @Test
  func composingInACellKeepsTheCellsAfterIt() throws {
    let view = try Self.host(Self.titledTable)
    #expect(view.becomeFirstResponder())
    let cell = (try Self.text(of: view) as NSString).range(of: "two words")
    view.selectedTextRange = view.textRange(
      from: try #require(view.position(from: view.beginningOfDocument, offset: cell.location)),
      to: try #require(view.position(from: view.beginningOfDocument, offset: NSMaxRange(cell))))
    for composed in ["t", "two many words"] {
      view.setMarkedText(composed, selectedRange: NSRange(location: composed.utf16.count, length: 0))
      view.layoutIfNeeded()
      let text = try Self.text(of: view)
      #expect(text.contains("one\n\(composed)\nthree\nfour"), "\(text.debugDescription)")
      try Self.expectEveryCaretToLandOnItself(view)
    }
  }

  /// A table's cells sit in rows and columns, and an embedded node takes
  /// room between the text around it.
  @Test
  func aTableIsAGridAndAnEmbedTakesRoom() throws {
    let view = try Self.host(Self.titledTable)
    let whole = try #require(view.textRange(from: view.beginningOfDocument, to: view.endOfDocument))
    let text = try #require(view.text(in: whole)) as NSString
    func caret(_ word: String) throws -> CGRect {
      view.caretRect(for: try #require(view.position(from: view.beginningOfDocument, offset: text.range(of: word).location)))
    }
    let one = try caret("one")
    let two = try caret("two words")
    let three = try caret("three")
    #expect(abs(two.minY - one.minY) < 1 && two.minX > one.minX + 60, "two words beside one")
    #expect(three.minY > one.maxY && abs(three.minX - one.minX) < 1, "three below one")
    #expect(try caret("after").minY - (try caret("four")).maxY > 150, "the embed's room")
  }

  /// A selection from the paragraph before a table to the one after it is
  /// drawn over every caret in between.
  @Test
  func aSelectionAcrossATableCoversIt() throws {
    let view = try Self.host(Self.titledTable)
    let start = try #require(view.position(from: view.beginningOfDocument, offset: 7))
    let end = try #require(view.position(from: view.endOfDocument, offset: 0))
    let range = try #require(view.textRange(from: start, to: end))
    let rects = view.selectionRects(for: range).map(\.rect)
    for offset in 8..<view.offset(from: view.beginningOfDocument, to: end) {
      let caret = view.caretRect(for: try #require(view.position(from: view.beginningOfDocument, offset: offset)))
      #expect(rects.contains { $0.insetBy(dx: -1, dy: 0).intersects(caret.insetBy(dx: 0, dy: 1)) }, "offset \(offset)")
    }
  }

  /// Scrolling up from the middle of a long document, through blocks laid
  /// out for the first time, moves the text exactly as far as the scroll.
  @Test
  func textAboveLayingOutDoesNotMoveWhatIsShown() throws {
    let view = try Self.host(SyntheticDocument.small.state)
    view.contentOffset.y = view.contentSize.height / 2
    view.layoutIfNeeded()
    var jumps: [CGFloat] = []
    while view.contentOffset.y > view.bounds.height {
      let probe = CGPoint(x: 40, y: view.contentOffset.y + view.bounds.height / 3)
      let position = try #require(view.closestPosition(to: view.convert(probe, to: view.textInputView)))
      let before = view.convert(view.caretRect(for: position), from: view.textInputView).minY - view.contentOffset.y
      view.contentOffset.y -= 150
      view.layoutIfNeeded()
      let after = view.convert(view.caretRect(for: position), from: view.textInputView).minY - view.contentOffset.y
      if abs(after - (before + 150)) > 0.5 { jumps.append(after - (before + 150)) }
    }
    #expect(jumps == [])
  }

  static func host(_ document: JSONValue) throws -> EditorView {
    let model = Editor()
    try model.load(document)
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
    let view = EditorView(model: model)
    view.frame = window.bounds
    window.addSubview(view)
    window.makeKeyAndVisible()
    view.layoutIfNeeded()
    return view
  }

  static let titledTable = LexicalJSON.document([
    [
      "children": [LexicalJSON.text("Title")], "direction": nil, "format": "", "indent": 0, "tag": "h2",
      "type": "heading", "version": 1,
    ],
    LexicalJSON.paragraph([LexicalJSON.text("before")]),
    element(
      "table",
      [["one", "two words"], ["three", "four"]].map { row in
        element(
          "tablerow",
          row.map { cell in
            element(
              "tablecell", [LexicalJSON.paragraph([LexicalJSON.text(cell)])],
              ["backgroundColor": nil, "colSpan": 1, "headerState": 0, "rowSpan": 1])
          })
      }),
    ["format": "", "type": "youtube", "version": 1, "videoID": "abc", "width": 0, "height": 0],
    LexicalJSON.paragraph([LexicalJSON.text("after")]),
  ])

  static func element(_ type: String, _ children: [JSONValue], _ fields: JSONObject = [:]) -> JSONValue {
    var node: JSONObject = [
      "children": .array(children), "direction": nil, "format": "", "indent": 0, "type": .string(type), "version": 1,
    ]
    for (key, value) in fields { node[key] = value }
    return .object(node)
  }
}
#endif
