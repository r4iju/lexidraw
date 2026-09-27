#if canImport(UIKit)
import LexicalFuzz
import LexicalSwift
import Testing
@testable import TextKitEditor
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
    #expect(abs(two.minY - one.minY) < 1 && abs(two.minX - one.minX - TableView.columnWidth) < 1, "two words beside one")
    #expect(three.minY > one.maxY && abs(three.minX - one.minX) < 1, "three below one")
    #expect(try caret("after").minY - (try caret("four")).maxY >= PlaceholderView.height, "the embed's room")
  }

  /// A table wider than the text scrolls sideways to show the caret, and
  /// no caret or selection in it is drawn past its edges.
  @Test
  func aWideTableShowsTheCaretAndNothingPastItsEdges() throws {
    let view = try Self.host(TestDocuments.titledTable([["a", "b", "c", "hidden"]]))
    #expect(view.becomeFirstResponder())
    let text = try Self.text(of: view) as NSString
    let table = NSRange(location: text.range(of: "a\n").location, length: NSMaxRange(text.range(of: "hidden")) - text.range(of: "a\n").location)
    let width = view.textInputView.bounds.width
    func shows(_ rect: CGRect) -> Bool { rect == .zero || (rect.minX >= 0 && rect.minX <= width) }

    let end = try #require(view.position(from: view.beginningOfDocument, offset: NSMaxRange(table)))
    view.selectedTextRange = view.textRange(from: end, to: end)
    view.layoutIfNeeded()

    let caret = view.caretRect(for: end)
    #expect(caret != .zero && shows(caret), "\(caret) in a table \(width) wide")
    let landed = try #require(view.closestPosition(to: CGPoint(x: caret.minX, y: caret.midY)))
    #expect(view.offset(from: view.beginningOfDocument, to: landed) == NSMaxRange(table))
    for offset in table.location...NSMaxRange(table) {
      let position = try #require(view.position(from: view.beginningOfDocument, offset: offset))
      #expect(shows(view.caretRect(for: position)), "caret at \(offset): \(view.caretRect(for: position))")
    }
    let start = try #require(view.position(from: view.beginningOfDocument, offset: table.location))
    let rects = view.selectionRects(for: try #require(view.textRange(from: start, to: end))).map(\.rect)
    #expect(!rects.isEmpty && rects.allSatisfy { $0.minX >= 0 && $0.maxX <= width }, "\(rects)")
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

  /// A list item's text starts past the marker of each list around it and
  /// the box of each checklist, and an indented paragraph a level of indent
  /// in for each level.
  @Test
  func itemsAndIndentedBlocksStartAsFarInAsOnTheWeb() throws {
    let view = try Self.host(
      LexicalJSON.document([
        LexicalJSON.list(
          .bullet, [.item([LexicalJSON.text("a")]), .nested(.check, [.item([LexicalJSON.text("b")])])]),
        LexicalJSON.paragraph([LexicalJSON.text("c")], indent: 2),
      ]))
    let em = UIFont.preferredFont(forTextStyle: .body).pointSize
    func caret(_ offset: Int) throws -> CGRect {
      view.caretRect(for: try #require(view.position(from: view.beginningOfDocument, offset: offset)))
    }

    #expect(try Self.text(of: view) == "a\nb\nc")
    let layout = ListAndIndentLayout.self
    #expect(abs(try caret(0).minX - layout.listPadding * em) < 0.5)
    #expect(abs(try caret(2).minX - (2 * layout.listPadding + layout.checklistPadding) * em) < 0.5)
    #expect(abs(try caret(2).midY - (try caret(0)).midY - TypographyTests.paragraphLine * em - layout.itemSpacing * em) < 1)
    #expect(abs(try caret(4).minX - 2 * layout.indentWidth) < 0.5)
    try Self.expectEveryCaretToLandOnItself(view)
  }

  /// A marker is set as high on its line as the item's text: an item whose
  /// text is its own marker shows the two alike.
  @Test
  func aMarkerSitsAsHighAsItsItemsText() throws {
    let view = try Self.host(LexicalJSON.document([LexicalJSON.list(.number, [.item([LexicalJSON.text("1.")])])]))
    let textStart = view.caretRect(for: view.beginningOfDocument).minX
    let canvas = view.textInputView
    let image = UIGraphicsImageRenderer(bounds: canvas.bounds).image { context in
      UIColor.white.setFill()
      context.fill(canvas.bounds)
      canvas.layer.render(in: context.cgContext)
    }

    let marker = try #require(Self.inkedRows(image, from: 0, to: textStart))
    let text = try #require(Self.inkedRows(image, from: textStart, to: canvas.bounds.width))
    #expect(abs(marker.lowerBound - text.lowerBound) < 0.5 && abs(marker.upperBound - text.upperBound) < 0.5, "\(marker), \(text)")
  }

  /// The top and bottom, in points, of what is drawn darker than a white
  /// background between `minX` and `maxX`.
  static func inkedRows(_ image: UIImage, from minX: CGFloat, to maxX: CGFloat) -> ClosedRange<CGFloat>? {
    guard let cgImage = image.cgImage else { return nil }
    let (width, height) = (cgImage.width, cgImage.height)
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let drawn = pixels.withUnsafeMutableBytes { buffer in
      let context = CGContext(
        data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      context?.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
      return context != nil
    }
    guard drawn else { return nil }
    let scale = image.scale
    let columns = max(Int(minX * scale), 0)..<min(Int(maxX * scale), width)
    let rows = (0..<height).filter { row in
      columns.contains { column in
        let pixel = (row * width + column) * 4
        return pixels[pixel..<pixel + 3].contains { $0 < 200 }
      }
    }
    guard let top = rows.first, let bottom = rows.last else { return nil }
    return CGFloat(top) / scale...CGFloat(bottom + 1) / scale
  }

  /// Each item shows the marker the web's theme gives it, numbered from its
  /// list's start and styled by how deep it is, or in a checklist a box, its
  /// text struck through once checked.
  @Test
  func itemsShowTheirMarkersAndBoxes() throws {
    let model = Editor()
    try model.load(
      LexicalJSON.document([
        LexicalJSON.list(
          .number,
          [
            .item([LexicalJSON.text("a")]),
            .nested(.number, [.item([LexicalJSON.text("b")]), .nested(.bullet, [.item([LexicalJSON.text("c")])])]),
          ], start: 3),
        LexicalJSON.list(.check, [.item([LexicalJSON.text("d")], checked: true), .item([LexicalJSON.text("e")])]),
      ]))
    let body = UIFont.preferredFont(forTextStyle: .body)
    let storage = NSMutableAttributedString()
    try DocumentText(model: model, style: { _, _ in [.font: body] }).reload(storage)

    let (styled, layout) = ListAndIndentLayout.styled(storage)

    #expect(styled.string == "a\nb\nc\nd\ne\n")
    #expect(layout.items.map(\.marker) == ["3. ", "a. ", "\u{25AA} ", nil, nil])
    #expect(layout.items.map(\.isChecklistItem) == [false, false, false, true, true])
    func isStruckThrough(_ offset: Int) -> Bool {
      styled.attribute(.strikethroughStyle, at: offset, effectiveRange: nil) != nil
    }
    #expect([6, 8].map(isStruckThrough) == [true, false])
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

  static func host(_ document: JSONValue, width: CGFloat = 390) throws -> EditorView {
    let model = Editor()
    try model.load(document)
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 600))
    let view = EditorView(model: model)
    view.frame = window.bounds
    window.addSubview(view)
    window.makeKeyAndVisible()
    view.layoutIfNeeded()
    return view
  }

  static let titledTable = TestDocuments.titledTable([["one", "two words"], ["three", "four"]])
}
#endif
