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
    #expect(abs(two.minY - one.minY) < 1 && two.minX > one.maxX, "two words beside one")
    #expect(three.minY > one.maxY && abs(three.minX - one.minX) < 1, "three below one")
    #expect(try caret("after").minY - (try caret("four")).maxY >= PlaceholderView.height, "the embed's room")
  }

  /// A table wider than the text scrolls sideways to show the caret, and
  /// no caret or selection in it is drawn past its edges.
  @Test
  func aWideTableShowsTheCaretAndNothingPastItsEdges() throws {
    let view = try Self.host(TestDocuments.titledTable([Array(repeating: "Wednesday 1 July", count: 5) + ["hidden"]]))
    #expect(view.becomeFirstResponder())
    let text = try Self.text(of: view) as NSString
    let first = text.range(of: "Wednesday").location
    let table = NSRange(location: first, length: NSMaxRange(text.range(of: "hidden")) - first)
    let width = view.textInputView.bounds.width
    func shows(_ rect: CGRect) -> Bool { rect == .zero || (rect.minX >= 0 && rect.minX <= width) }

    let end = try #require(view.position(from: view.beginningOfDocument, offset: NSMaxRange(table)))
    #expect(view.caretRect(for: end) == .zero, "the last cell starts out of sight")
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
    #expect(abs(try caret(0).minX - layout.list.padding * em) < 0.5)
    #expect(abs(try caret(2).minX - (2 * layout.list.padding + layout.list.checklistPadding) * em) < 0.5)
    #expect(abs(try caret(2).midY - (try caret(0)).midY - TypographyTests.paragraphLine * em - layout.list.itemSpacing * em) < 1)
    #expect(abs(try caret(4).minX - 2 * layout.indentWidth) < 0.5)
    try Self.expectEveryCaretToLandOnItself(view)
  }

  /// An indented quote's indent takes the place of its padding, as the
  /// `padding-inline-start` Lexical indents with does, and leaves its border.
  @Test
  func anIndentedQuoteKeepsItsBorder() throws {
    let view = try Self.host(
      LexicalJSON.document([LexicalJSON.element("quote", [LexicalJSON.text("q")], ["indent": 2])]))

    let caret = view.caretRect(for: view.beginningOfDocument)
    let start = DocumentTypography.web.quote.borderWidth + 2 * ListAndIndentLayout.indentWidth
    #expect(abs(caret.minX - start) < 0.5, "\(caret.minX), not \(start)")
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
  /// list's start and styled by how deep it is, or in a checklist a box.
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
  }

  /// A checked item's text is struck through, across the space between its
  /// words too, and drawn in the theme's colour for done items, light and
  /// dark; an unchecked item's isn't.
  @Test(arguments: [UIUserInterfaceStyle.light, .dark])
  func aCheckedItemIsStruckThroughInTheThemesColour(_ style: UIUserInterfaceStyle) throws {
    let view = try Self.host(
      LexicalJSON.document([
        LexicalJSON.list(
          .check, [.item([LexicalJSON.text("ll ll")], checked: true), .item([LexicalJSON.text("ll ll")])])
      ]))
    view.overrideUserInterfaceStyle = style
    view.layoutIfNeeded()
    func caret(_ offset: Int) throws -> CGRect {
      view.caretRect(for: try #require(view.position(from: view.beginningOfDocument, offset: offset)))
    }
    func space(after start: Int) throws -> ClosedRange<CGFloat> {
      (try caret(start + 2).minX + 1)...(try caret(start + 3).minX - 1)
    }
    func line(_ start: Int) throws -> ClosedRange<CGFloat> { (try caret(start).minY)...(try caret(start).maxY) }

    #expect(TypographyTests.ink(of: view.textInputView, across: try space(after: 0), rows: try line(0)) != nil)
    #expect(TypographyTests.ink(of: view.textInputView, across: try space(after: 6), rows: try line(6)) == nil)
    let drawn = try #require(
      TypographyTests.inkColor(
        of: view.textInputView, across: (try caret(0).minX)...(try caret(2).minX), rows: try line(0)))
    let theme = DocumentTypography.web.list.doneColor
    let expected = style == .dark ? theme.dark : theme.light
    #expect(zip(drawn, [expected.red, expected.green, expected.blue]).allSatisfy { abs($0 - $1) < 0.01 }, "\(drawn)")
  }

  /// A column is as wide as its text on one line, with the web's padding
  /// and border, while the table fits: a short column's text never wraps,
  /// and another column is at least 7.5rem wide.
  @Test
  func columnsAreAsWideAsTheirText() throws {
    let view = try Self.host(TestDocuments.titledTable([["a", "i i i i i i i i i", "end"]]))
    let a = try caret(view, "a\n")
    let narrow = try caret(view, "i i")
    let end = try caret(view, "end")
    let font = try #require(EditorView.defaultStyle("table", [])[.font] as? UIFont)
    let aWide = ceil(NSAttributedString(string: "a", attributes: [.font: font]).size().width)
    #expect(abs(narrow.minX - a.minX - (aWide + 2 * 12 + 1)) < 1, "\(narrow.minX - a.minX)")
    #expect(abs(end.minX - narrow.minX - 120) < 1, "\(end.minX - narrow.minX)")
  }

  /// A column of sentences wraps within the text's width rather than
  /// making the table scroll, and a short column beside it stays whole.
  @Test
  func aLongColumnWrapsWithinTheTextsWidth() throws {
    let sentence = Array(repeating: "words that wrap", count: 12).joined(separator: " ")
    let view = try Self.host(TestDocuments.titledTable([["Wednesday 1 July", sentence]]))
    let width = view.textInputView.bounds.width
    let text = try Self.text(of: view) as NSString
    let cell = text.range(of: sentence)
    let start = try position(view, cell.location)
    let finish = try position(view, NSMaxRange(cell))
    #expect(view.caretRect(for: finish).minY > view.caretRect(for: start).maxY, "the sentence wraps")
    for offset in cell.location...NSMaxRange(cell) {
      let caret = view.caretRect(for: try position(view, offset))
      #expect(caret.minX >= 0 && caret.maxX <= width, "caret at \(offset): \(caret)")
    }
    let short = text.range(of: "Wednesday 1 July")
    #expect(
      abs(view.caretRect(for: try position(view, NSMaxRange(short))).minY - view.caretRect(for: try position(view, short.location)).minY) < 1,
      "the short column stays on one line")
  }

  /// A table set to column widths takes them.
  @Test
  func aTableSetToWidthsTakesThem() throws {
    var table = LexicalJSON.table([["a", "b", "c"]])
    if case .object(var fields) = table {
      fields["colWidths"] = [200, 80, 90]
      table = .object(fields)
    }
    let view = try Self.host(LexicalJSON.document([table]))
    #expect(abs(try caret(view, "b").minX - (try caret(view, "a")).minX - 200) < 1)
    #expect(abs(try caret(view, "c").minX - (try caret(view, "b")).minX - 80) < 1)
  }

  /// A merged cell spans the columns and rows it takes in, and the cells
  /// after it go past them.
  @Test
  func aMergedCellSpansItsColumnsAndRows() throws {
    func cell(_ text: String, colSpan: Int = 1, rowSpan: Int = 1) -> JSONValue {
      LexicalJSON.element(
        "tablecell", [LexicalJSON.paragraph([LexicalJSON.text(text)])],
        [
          "backgroundColor": nil, "colSpan": .number(Double(colSpan)), "headerState": 0,
          "rowSpan": .number(Double(rowSpan)),
        ])
    }
    let view = try Self.host(
      LexicalJSON.document([
        LexicalJSON.element(
          "table",
          [
            LexicalJSON.element("tablerow", [cell("tall", rowSpan: 2), cell("wide", colSpan: 2)]),
            LexicalJSON.element("tablerow", [cell("b"), cell("c")]),
          ])
      ]))
    let tall = try caret(view, "tall")
    let wide = try caret(view, "wide")
    let b = try caret(view, "b")
    let c = try caret(view, "c")
    #expect(abs(b.minX - wide.minX) < 1 && b.minY > wide.maxY, "b under the start of wide")
    #expect(c.minX > b.maxX && abs(c.minY - b.minY) < 1, "c beside b")
    #expect(b.minX > tall.maxX, "b past tall, which takes its row too")
    try Self.expectEveryCaretToLandOnItself(view)
  }

  /// Cells selected as a table selection are tinted as the web tints them,
  /// with the theme's primary colour at 10%, and no text is highlighted.
  @Test
  func aTableSelectionTintsItsCells() throws {
    let view = try Self.host(Self.editableTable)
    view.window?.overrideUserInterfaceStyle = .light
    #expect(view.becomeFirstResponder())
    let text = try Self.text(of: view) as NSString
    let one = text.range(of: "one")
    let two = text.range(of: "two words")
    let range = try #require(
      view.textRange(from: try position(view, one.location), to: try position(view, NSMaxRange(two))))
    view.selectedTextRange = range
    view.layoutIfNeeded()

    #expect(view.selectionRects(for: range).isEmpty)
    let image = UIGraphicsImageRenderer(bounds: view.bounds).image { view.layer.render(in: $0.cgContext) }
    /// A point in the cell's padding before `word`, where the image has it.
    func padding(_ word: String) throws -> CGPoint {
      let caret = try caret(view, word)
      let point = view.convert(CGPoint(x: caret.minX - 6, y: caret.minY - 3), from: view.textInputView)
      return CGPoint(x: point.x - view.bounds.minX, y: point.y - view.bounds.minY)
    }
    let tinted = try pixel(image, at: padding("two words"))
    let plain = try pixel(image, at: padding("three"))
    let primary = (red: 115.0, green: 72.0, blue: 226.0)
    let expected = (red: 255 * 0.9 + primary.red * 0.1, green: 255 * 0.9 + primary.green * 0.1, blue: 255 * 0.9 + primary.blue * 0.1)
    #expect(abs(tinted.red - expected.red) < 3 && abs(tinted.green - expected.green) < 3 && abs(tinted.blue - expected.blue) < 3, "\(tinted)")
    #expect(plain.red > 250 && plain.green > 250 && plain.blue > 250, "\(plain)")
  }

  @Test
  func typingAfterTypingOverCellsTypesWhereTheSelectionEnded() throws {
    let model = Editor()
    let view = try Self.host(Self.editableTable, model: model)
    #expect(view.becomeFirstResponder())
    let text = try Self.text(of: view) as NSString
    view.selectedTextRange = view.textRange(
      from: try position(view, text.range(of: "one").location), to: try position(view, text.range(of: "four").location))

    view.insertText("x")
    view.insertText("y")

    #expect(try Self.text(of: view).contains("one\ntwo words\nthree\nyfour"))
  }

  private func position(_ view: EditorView, _ offset: Int) throws -> UITextPosition {
    try #require(view.position(from: view.beginningOfDocument, offset: offset))
  }

  private func caret(_ view: EditorView, _ word: String) throws -> CGRect {
    let text = try Self.text(of: view) as NSString
    return view.caretRect(for: try position(view, text.range(of: word).location))
  }

  private func pixel(_ image: UIImage, at point: CGPoint) throws -> (red: Double, green: Double, blue: Double) {
    let cgImage = try #require(image.cgImage)
    let scale = image.scale
    var data = [UInt8](repeating: 0, count: 4)
    let context = try #require(
      CGContext(
        data: &data, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.draw(
      cgImage,
      in: CGRect(
        x: -point.x * scale, y: -(CGFloat(cgImage.height) - point.y * scale - 1), width: CGFloat(cgImage.width),
        height: CGFloat(cgImage.height)))
    return (Double(data[0]), Double(data[1]), Double(data[2]))
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

  static func host(_ document: JSONValue, model: Editor = Editor(), width: CGFloat = 390) throws -> EditorView {
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
  /// A table among only what LexicalSwift edits so far.
  static let editableTable = LexicalJSON.document([
    LexicalJSON.paragraph([LexicalJSON.text("before")]), LexicalJSON.table([["one", "two words"], ["three", "four"]]),
    LexicalJSON.paragraph([LexicalJSON.text("after")]),
  ])
}
#endif
