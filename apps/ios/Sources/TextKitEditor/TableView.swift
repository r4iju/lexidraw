#if canImport(UIKit)
import CSSValues
import UIKit

/// A table laid out as the web lays out a document's table
/// (`.document-table` in `document.css`, and the columns
/// `DocumentTablesPlugin` keeps whole): columns as wide as their text asks,
/// within the text's width where that fits, or at the widths the table is
/// set to; wider than its frame, it scrolls sideways, and on a narrow
/// screen a table of many columns pins its first as it does. Cell geometry
/// is in the table's own frame, where it is seen, rather than in its
/// scrolled content.
///
/// Its pan begins only on a sideways drag that starts over it, wherever
/// the pan is (`TableHolder`).
@MainActor final class TableView: UIScrollView {
  struct Cell {
    var text: NSAttributedString
    var colSpan = 1
    var rowSpan = 1
    var isHeader = false
    /// The colour the cell is filled with.
    var background: UIColor?
    /// The width the cell is set to, borders included, as the web's
    /// `border-box` sizes it.
    var width: CGFloat?
    var verticalAlign = DocumentText.Table.VerticalAlign.top
  }

  private var boxes: [[TextBox]] = []
  /// Each cell's box, borders included, by row and by its index in the row,
  /// in the content.
  private var cellFrames: [[CGRect]] = []
  /// Where each row starts, and the table's inner bottom last.
  private var rowTops: [CGFloat] = [0]
  private var cells: [[Cell]] = []
  private var tableSize: CGSize = .zero
  private let grid = GridView()
  private let pinned = PinnedView()
  private let shadows = ScrollEdgeView(.shadows)
  private let scrollingFrame = ScrollEdgeView(.frame)
  /// Whether the cell first in each row stays at the table's start as the
  /// table scrolls.
  private var pinsFirstCells = false
  /// The cells a table selection has, by row and index in the row.
  var selectedCells: Set<CellIndex> = [] {
    didSet { if selectedCells != oldValue { grid.setNeedsDisplay() } }
  }
  /// The offsets in each cell's text of the attachments to outline.
  var selectedCharacters: [CellIndex: [Int]] = [:] {
    didSet {
      guard selectedCharacters != oldValue else { return }
      grid.setNeedsDisplay()
      pinned.setNeedsDisplay()
    }
  }
  var onScroll: (() -> Void)?
  private var shownX: CGFloat = 0

  struct CellIndex: Hashable {
    var row: Int
    var index: Int
  }

  /// `.document-table`'s measures and colours, a CSS pixel to a point.
  let style: DocumentTypography.Table
  /// Around a node selected whole.
  private let selectedOutline: DocumentTypography.Outline
  private var paddingX: CGFloat { style.paddingX }
  private var paddingY: CGFloat { style.paddingY }
  private var border: CGFloat { style.border }

  init(
    cells: [[Cell]], columnWidths: [Double]?, width: CGFloat, style: DocumentTypography.Table,
    selectedOutline: DocumentTypography.Outline
  ) {
    self.style = style
    self.selectedOutline = selectedOutline
    super.init(frame: .zero)
    showsVerticalScrollIndicator = false
    alwaysBounceHorizontal = false
    addSubview(grid)
    addSubview(pinned)
    grid.table = self
    pinned.table = self
    shadows.table = self
    scrollingFrame.table = self
    set(cells: cells, columnWidths: columnWidths, width: width)
  }

  required init?(coder: NSCoder) { fatalError("TableView is made in code") }

  /// What goes behind the table where it is drawn, as the web's region's
  /// background: the scroll shadows, which stay put as it scrolls.
  var underlay: UIView { shadows }
  /// What goes over it, as the region's outline: the frame of a table that
  /// scrolls.
  var overlay: UIView { scrollingFrame }

  var height: CGFloat { tableSize.height }

  func set(cells: [[Cell]], columnWidths: [Double]?, width: CGFloat) {
    self.cells = cells
    let placed = Placement(cells)
    let metrics = cells.map { $0.map { TextMetrics($0, style) } }
    let short = shortColumns(cells)
    var whole = short
    var columns = self.columns(placed, metrics, short: short, whole: whole, fixed: columnWidths, width: width)
    // Short columns stay whole while the table fits, the widest giving way
    // first (`fitShortColumns`).
    if columnWidths == nil, (cells.first?.count ?? 0) < style.scrollingColumns {
      while !whole.isEmpty, columns.reduce(0, +) + 2 * border > width {
        let firstRow = cells.first?.indices.map { placed.width(row: 0, index: $0, columns) } ?? []
        let widest = whole.max { (firstRow[safe: $0] ?? 0) < (firstRow[safe: $1] ?? 0) }!
        whole.remove(widest)
        columns = self.columns(placed, metrics, short: short, whole: whole, fixed: nil, width: width)
      }
    }
    let alignment = numericColumns(cells)
    boxes = cells.enumerated().map { row, rowCells in
      rowCells.enumerated().map { index, cell in
        let content = placed.width(row: row, index: index, columns) - 2 * paddingX - endBorder(row, index)
        return TextBox(styled(cell, alignedRight: alignment.contains(index)), width: max(content, 1))
      }
    }
    var rowHeights = [CGFloat](repeating: 0, count: cells.count)
    for (row, rowCells) in cells.enumerated() {
      for index in rowCells.indices where placed.rowSpan(row: row, index: index) == 1 {
        rowHeights[row] = max(rowHeights[row], cellHeight(row, index))
      }
    }
    for (row, rowCells) in cells.enumerated() {
      for index in rowCells.indices where placed.rowSpan(row: row, index: index) > 1 {
        let rows = row..<(row + placed.rowSpan(row: row, index: index))
        let short = cellHeight(row, index) - rows.map { rowHeights[$0] }.reduce(0, +)
        if short > 0 { rowHeights[rows.upperBound - 1] += short }
      }
    }
    rowTops = [border]
    for height in rowHeights { rowTops.append(rowTops[rowTops.count - 1] + height) }
    let lefts = columns.reduce(into: [border]) { $0.append($0[$0.count - 1] + $1) }
    cellFrames = cells.enumerated().map { row, rowCells in
      rowCells.indices.map { index in
        let column = placed.columns[row][index]
        let rowSpan = placed.rowSpan(row: row, index: index)
        return CGRect(
          x: lefts[column], y: rowTops[row], width: lefts[column + placed.colSpan(row: row, index: index)] - lefts[column],
          height: rowTops[row + rowSpan] - rowTops[row])
      }
    }
    tableSize = CGSize(width: (lefts.last ?? 0) + border, height: (rowTops.last ?? 0) + border)
    pinsFirstCells =
      viewportWidth(width) <= style.pinned.width && (cells.first?.count ?? 0) > style.unpinnedColumns
    grid.frame = CGRect(origin: .zero, size: tableSize)
    contentSize = tableSize
    frame.size = CGSize(width: width, height: tableSize.height)
    shadows.frame = CGRect(x: 0, y: 0, width: min(width, tableSize.width), height: tableSize.height)
    scrollingFrame.frame = shadows.frame
    placePinnedCells()
    redraw()
  }

  /// The width of the screen the table is on, as CSS's `vw` and `@media`
  /// measure it.
  private func viewportWidth(_ width: CGFloat) -> CGFloat { window?.bounds.width ?? width + 2 * BlockLayout.margin }

  private var pinnedCells: [CellIndex] {
    pinsFirstCells ? cells.indices.filter { !cells[$0].isEmpty }.map { CellIndex(row: $0, index: 0) } : []
  }

  private func isPinned(_ cell: CellIndex) -> Bool { pinsFirstCells && cell.index == 0 }

  /// Where `cell` is drawn in the content: where it is laid out, unless
  /// it's pinned, as `position: sticky` keeps it `inset` past the start of
  /// what is shown.
  private func shownFrame(_ cell: CellIndex) -> CGRect {
    var frame = cellFrames[cell.row][cell.index]
    if isPinned(cell) {
      frame.origin.x = min(max(frame.minX, contentOffset.x + style.pinned.inset), tableSize.width - border - frame.width)
    }
    return frame
  }

  /// Where in the content a cell that isn't pinned starts to be seen,
  /// past the pinned cells beside it.
  private func shownStart(_ cell: CellIndex) -> CGFloat {
    let frame = cellFrames[cell.row][cell.index]
    return pinnedCells.map(shownFrame).filter { $0.minY < frame.maxY && $0.maxY > frame.minY }.map(\.maxX)
      .reduce(frame.minX, max)
  }

  /// Whether the table is scrolled past its start, the web's
  /// `data-scroll-left`.
  fileprivate var scrollsLeft: Bool { contentOffset.x > 1 }

  /// Puts the view that draws the pinned cells where they are, over what
  /// scrolls under them.
  private func placePinnedCells() {
    pinned.isHidden = !pinsFirstCells
    guard pinsFirstCells else { return }
    let x = max(contentOffset.x, 0)
    let reach = pinnedCells.map { shownFrame($0).maxX }.max() ?? x
    let shadow = style.pinned.shadowX + style.pinned.shadowBlur
    pinned.frame = CGRect(x: x, y: 0, width: max(reach - x + shadow, 0), height: tableSize.height)
  }

  private func cellHeight(_ row: Int, _ index: Int) -> CGFloat {
    let box = boxes[row][index]
    return box.height - box.trailingSpacing + 2 * paddingY + (row == cells.count - 1 ? 0 : border)
  }

  /// A row's last cell has no border at its end.
  private func endBorder(_ row: Int, _ index: Int) -> CGFloat {
    index == cells[row].count - 1 ? 0 : border
  }

  /// The columns' widths, borders included: CSS's automatic table layout,
  /// or the widths the table is set to.
  private func columns(
    _ placed: Placement, _ metrics: [[TextMetrics]], short: Set<Int>, whole: Set<Int>, fixed: [Double]?,
    width: CGFloat
  ) -> [CGFloat] {
    let count = placed.columnCount
    if let fixed, let last = fixed.last {
      return (0..<count).map { CGFloat(fixed[safe: $0] ?? last) }
    }
    let viewport = viewportWidth(width)
    var least = [CGFloat](repeating: 0, count: count)
    var most = [CGFloat](repeating: 0, count: count)
    /// The columns a cell of their own sets to a width.
    var isSet = [Bool](repeating: false, count: count)
    var spanning: [(columns: Range<Int>, least: CGFloat, most: CGFloat)] = []
    for (row, rowCells) in metrics.enumerated() {
      for (index, text) in rowCells.enumerated() {
        let floor =
          text.isEmpty
          ? style.emptyWidth
          : short.contains(index) ? 0 : min(style.minimumWidth, style.minimumViewportShare * viewport)
        let around = 2 * paddingX + endBorder(row, index)
        let cellLeast = max((whole.contains(index) ? text.maxContent : text.minContent) + around, floor)
        let setWidth = cells[row][index].width
        let cellMost = setWidth.map { max($0, cellLeast) } ?? max(text.maxContent + around, floor)
        let start = placed.columns[row][index]
        let span = start..<min(start + placed.colSpan(row: row, index: index), count)
        if span.count == 1 {
          least[start] = max(least[start], cellLeast)
          most[start] = max(most[start], cellMost)
          if setWidth != nil { isSet[start] = true }
        } else {
          spanning.append((span, cellLeast, cellMost))
        }
      }
    }
    for (span, cellLeast, cellMost) in spanning {
      let lacking = cellLeast - span.map { least[$0] }.reduce(0, +)
      if lacking > 0 { for column in span { least[column] += lacking / CGFloat(span.count) } }
      let lackingMost = cellMost - span.map { most[$0] }.reduce(0, +)
      if lackingMost > 0 { for column in span { most[column] += lackingMost / CGFloat(span.count) } }
    }
    for column in 0..<count { most[column] = max(most[column], least[column]) }
    let available = width - 2 * border
    let (leastTotal, mostTotal) = (least.reduce(0, +), most.reduce(0, +))
    if mostTotal <= available { return most }
    guard leastTotal < available else { return least }
    // A browser gives the columns set to a width theirs first, and the
    // others what's left; only once the others are at their least do the
    // set ones give way.
    let room = available - leastTotal
    let setRoom = (0..<count).filter { isSet[$0] }.map { most[$0] - least[$0] }.reduce(0, +)
    let setShare = setRoom > room ? room / setRoom : 1
    let otherRoom = mostTotal - leastTotal - setRoom
    let otherShare = otherRoom > 0 ? max(room - setRoom, 0) / otherRoom : 0
    return (0..<count).map { least[$0] + (most[$0] - least[$0]) * (isSet[$0] ? setShare : otherShare) }
  }

  /// The cells' indexes in their rows whose every cell is short, as
  /// `DocumentTablesPlugin` counts columns: by index in the row, with the
  /// first row's length.
  private func shortColumns(_ cells: [[Cell]]) -> Set<Int> {
    let count = cells.first?.count ?? 0
    return Set(
      (0..<count).filter { index in
        cells.allSatisfy { row in
          guard let cell = row[safe: index] else { return true }
          return columnsWide(Self.plainText(cell)) <= style.shortColumns
        }
      })
  }

  /// The columns mostly of numbers, which the web aligns right: at least
  /// 80% of their cells other than headers.
  private func numericColumns(_ cells: [[Cell]]) -> Set<Int> {
    let count = cells.first?.count ?? 0
    return Set(
      (0..<count).filter { index in
        let body = cells.compactMap { $0[safe: index] }.filter { !$0.isHeader }
        let numbers = body.filter { style.number.firstMatch(in: Self.plainText($0)) != nil }
        return !body.isEmpty && Double(numbers.count) / Double(body.count) >= 0.8
      })
  }

  private static func plainText(_ cell: Cell) -> String {
    cell.text.string.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// `columnsWide`: a wide character counts as two.
  private func columnsWide(_ text: String) -> Int {
    text.unicodeScalars.reduce(0) { $0 + (style.isWide($1) ? 2 : 1) }
  }

  /// A cell's text as the web shows it: a header's in the header weight,
  /// and a number column's aligned right.
  private func styled(_ cell: Cell, alignedRight: Bool) -> NSAttributedString {
    guard cell.isHeader || alignedRight else { return cell.text }
    let text = NSMutableAttributedString(attributedString: cell.text)
    let whole = NSRange(location: 0, length: text.length)
    if cell.isHeader {
      text.enumerateAttribute(.font, in: whole) { value, range, _ in
        guard let font = value as? UIFont, !font.fontDescriptor.symbolicTraits.contains(.traitBold) else { return }
        let traits = (font.fontDescriptor.object(forKey: .traits) as? [UIFontDescriptor.TraitKey: Any]) ?? [:]
        let weight = Typesetting.weight(style.headerWeight)
        let header = font.fontDescriptor.addingAttributes([.traits: traits.merging([.weight: weight]) { $1 }])
        text.addAttribute(.font, value: UIFont(descriptor: header, size: font.pointSize), range: range)
      }
    }
    if alignedRight {
      text.enumerateAttribute(.paragraphStyle, in: whole) { value, range, _ in
        let style = ((value as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle) ?? NSMutableParagraphStyle()
        style.alignment = .right
        text.addAttribute(.paragraphStyle, value: style, range: range)
      }
    }
    return text
  }

  /// Where the text of `cell` starts, in the frame.
  private func textOrigin(_ cell: CellIndex) -> CGPoint {
    let frame = shownFrame(cell)
    return CGPoint(x: frame.minX + paddingX - contentOffset.x, y: frame.minY + textTop(cell))
  }

  /// How far down its cell the text of `cell` starts: past the padding,
  /// and down the height its rows have past its own as far as its vertical
  /// alignment says.
  private func textTop(_ cell: CellIndex) -> CGFloat {
    let slack = cellFrames[cell.row][cell.index].height - cellHeight(cell.row, cell.index)
    return switch cells[cell.row][cell.index].verticalAlign {
    case .top: paddingY
    case .middle: paddingY + slack / 2
    case .bottom: paddingY + slack
    }
  }

  func writingDirection(at offset: Int, in cell: CellIndex) -> NSWritingDirection { box(cell).writingDirection(at: offset) }

  private func box(_ cell: CellIndex) -> TextBox { boxes[cell.row][cell.index] }

  /// Where `range` of the text of `cell` is drawn, a line at a time, in the
  /// frame.
  func segments(_ range: NSRange, in cell: CellIndex) -> [CGRect] {
    let origin = textOrigin(cell)
    let segments = box(cell).segments(range).map { $0.offsetBy(dx: origin.x, dy: origin.y) }
    guard pinsFirstCells, !isPinned(cell) else { return segments }
    let start = shownStart(cell) - contentOffset.x
    return segments.compactMap { segment in
      guard segment.minX >= start else { return nil }
      return segment
    }
  }

  /// The cell a point in the frame is in, or the nearest, and the offset in
  /// its text closest to the point.
  func offset(closestTo point: CGPoint) -> (cell: CellIndex, offset: Int)? {
    guard let cell = cell(at: point) else { return nil }
    let origin = textOrigin(cell)
    return (cell, box(cell).offset(closestTo: CGPoint(x: point.x - origin.x, y: point.y - origin.y)))
  }

  /// The offset a line up or down from `offset` in the text of `cell`, at
  /// `x` in the frame: in the cell, else in the cell above or below, else
  /// nil.
  func offset(
    movingVerticallyFrom offset: Int, in cell: CellIndex, _ direction: NSTextSelectionNavigation.Direction, x: CGFloat
  ) -> (cell: CellIndex, offset: Int)? {
    if let moved = box(cell).offset(movingVerticallyFrom: offset, direction, x: x - textOrigin(cell).x) {
      return (cell, moved)
    }
    let frame = cellFrames[cell.row][cell.index]
    let y = direction == .up ? frame.minY - paddingY : frame.maxY + paddingY
    guard y > rowTops[0], y < rowTops[rowTops.count - 1] else { return nil }
    return self.offset(closestTo: CGPoint(x: x, y: y))
  }

  /// Whether `offset` in the text of `cell` is on its first line, going up,
  /// or its last, going down.
  func isOnEdgeLine(_ offset: Int, of cell: CellIndex, _ direction: NSTextSelectionNavigation.Direction) -> Bool {
    box(cell).offset(movingVerticallyFrom: offset, direction, x: 0) == nil
  }

  func lineBoundary(at offset: Int, in cell: CellIndex, backward: Bool) -> Int {
    box(cell).lineBoundary(at: offset, backward: backward)
  }

  /// The cell a point in the frame is in, or the nearest.
  private func cell(at point: CGPoint) -> CellIndex? {
    let content = CGPoint(x: point.x + contentOffset.x, y: point.y)
    if let pinned = pinnedCells.first(where: { shownFrame($0).contains(content) }) { return pinned }
    var nearest: (cell: CellIndex, distance: CGFloat)?
    for (row, frames) in cellFrames.enumerated() {
      for (index, frame) in frames.enumerated() {
        let dx = max(frame.minX - content.x, content.x - frame.maxX, 0)
        let dy = max(frame.minY - content.y, content.y - frame.maxY, 0)
        let distance = dx * dx + dy * dy
        if distance < nearest?.distance ?? .infinity { nearest = (CellIndex(row: row, index: index), distance) }
      }
    }
    return nearest?.cell
  }

  func redraw() {
    grid.setNeedsDisplay()
    pinned.setNeedsDisplay()
    shadows.setNeedsDisplay()
    scrollingFrame.setNeedsDisplay()
  }

  /// Scrolls sideways as little as shows `cell`, clear of the pinned cells.
  func scrollToShow(_ cell: CellIndex) {
    var frame = cellFrames[cell.row][cell.index]
    if pinsFirstCells, !isPinned(cell) {
      let cover = pinnedCells.map { cellFrames[$0.row][$0.index] }
        .filter { $0.minY < frame.maxY && $0.maxY > frame.minY }.map { $0.width + style.pinned.inset }.max() ?? 0
      frame = CGRect(x: frame.minX - cover, y: frame.minY, width: frame.width + cover, height: frame.height)
    }
    scrollRectToVisible(frame, animated: false)
  }

  override func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
    guard recognizer === panGestureRecognizer else { return super.gestureRecognizerShouldBegin(recognizer) }
    let velocity = panGestureRecognizer.velocity(in: self)
    return contentSize.width > bounds.width && bounds.contains(recognizer.location(in: self))
      && abs(velocity.x) > abs(velocity.y) && super.gestureRecognizerShouldBegin(recognizer)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if contentOffset.x != shownX {
      let scrolledLeft = shownX > 1
      shownX = contentOffset.x
      shadows.setNeedsDisplay()
    scrollingFrame.setNeedsDisplay()
      placePinnedCells()
      if scrollsLeft != scrolledLeft || pinnedCells.contains(where: { cellFrames[$0.row][$0.index].minX > border }) {
        pinned.setNeedsDisplay()
      }
      onScroll?()
    }
  }

  /// Where each cell sits: its first column, found as the web's table
  /// places cells, past the columns rows above take up.
  fileprivate struct Placement {
    var columns: [[Int]] = []
    var columnCount = 0
    /// The cell at each row and column, where one is.
    var map: [[CellIndex?]] = []
    private let spans: [[(colSpan: Int, rowSpan: Int)]]

    init(_ cells: [[Cell]]) {
      let spans = cells.map { $0.map { (colSpan: $0.colSpan, rowSpan: $0.rowSpan) } }
      self.spans = spans
      map = spans.map { _ in [] }
      for (row, rowCells) in spans.enumerated() {
        var column = 0
        columns.append(
          rowCells.enumerated().map { index, span in
            while let taken = map[row][safe: column], taken != nil { column += 1 }
            let start = column
            for spanned in row..<min(row + span.rowSpan, spans.count) {
              while map[spanned].count < start + span.colSpan { map[spanned].append(nil) }
              for column in start..<(start + span.colSpan) { map[spanned][column] = CellIndex(row: row, index: index) }
            }
            column += span.colSpan
            return start
          })
      }
      columnCount = map.map(\.count).max() ?? 0
    }

    func colSpan(row: Int, index: Int) -> Int { spans[row][index].colSpan }
    func rowSpan(row: Int, index: Int) -> Int { min(spans[row][index].rowSpan, spans.count - row) }

    func width(row: Int, index: Int, _ widths: [CGFloat]) -> CGFloat {
      let start = columns[row][index]
      return widths[start..<min(start + colSpan(row: row, index: index), widths.count)].reduce(0, +)
    }
  }

  /// How wide a cell's text is on one line, and its widest word.
  private struct TextMetrics {
    var minContent: CGFloat = 0
    var maxContent: CGFloat = 0
    var isEmpty: Bool

    init(_ cell: Cell, _ style: DocumentTypography.Table) {
      let text = cell.text
      let string = text.string as NSString
      isEmpty = string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      var lineStart = 0
      var pieceStart = 0
      func width(_ start: Int, _ end: Int) -> CGFloat {
        end > start ? ceil(text.attributedSubstring(from: NSRange(location: start, length: end - start)).size().width) : 0
      }
      for offset in 0...string.length {
        let character = offset < string.length ? string.character(at: offset) : 0x0A
        let scalar = Unicode.Scalar(character)
        if character == 0x0A || character == 0x2028 {
          maxContent = max(maxContent, width(lineStart, offset))
          minContent = max(minContent, width(pieceStart, offset))
          lineStart = offset + 1
          pieceStart = offset + 1
        } else if character == 0x20 || character == 0x09 {
          minContent = max(minContent, width(pieceStart, offset))
          pieceStart = offset + 1
        } else if let scalar, style.isWide(scalar) {
          // A line may break either side of a CJK character.
          minContent = max(minContent, width(pieceStart, offset), width(offset, offset + 1))
          pieceStart = offset + 1
        }
      }
    }

  }

  /// Draws `cell` in `frame`: its fill, the borders at its end and bottom,
  /// its text, and the outlines of its selected attachments. A fill set on the cell, a header's, and a pinned
  /// cell's each win over a selected cell's tint, as on the web.
  fileprivate func draw(_ index: CellIndex, in frame: CGRect, _ context: CGContext) {
    let cell = cells[index.row][index.index]
    let pinned = isPinned(index)
    let header = pinned ? style.pinned.headerBackground : style.headerBackground
    let fill =
      cell.background ?? (cell.isHeader ? header.color : nil) ?? (pinned ? style.pinned.background.color : nil)
      ?? (selectedCells.contains(index) ? style.selection.color : nil)
    if let fill {
      fill.setFill()
      UIRectFill(frame)
    }
    style.borderColor.color.setFill()
    if endBorder(index.row, index.index) > 0 {
      UIRectFill(CGRect(x: frame.maxX - border, y: frame.minY, width: border, height: frame.height))
    }
    if index.row < cells.count - 1 {
      UIRectFill(CGRect(x: frame.minX, y: frame.maxY - border, width: frame.width, height: border))
    }
    let origin = CGPoint(x: frame.minX + paddingX, y: frame.minY + textTop(index))
    box(index).draw(at: origin, in: context)
    for offset in selectedCharacters[index] ?? [] {
      guard let attachment = box(index).attachmentFrame(at: offset) else { continue }
      let reach = selectedOutline.offset + selectedOutline.width / 2
      let outline = UIBezierPath(rect: attachment.offsetBy(dx: origin.x, dy: origin.y).insetBy(dx: -reach, dy: -reach))
      outline.lineWidth = selectedOutline.width
      selectedOutline.color.color.setStroke()
      outline.stroke()
    }
  }

  /// The table's rounded frame, drawn inside `bounds`.
  fileprivate func strokeFrame(in bounds: CGRect) {
    style.borderColor.color.setStroke()
    let frame = UIBezierPath(
      roundedRect: bounds.insetBy(dx: border / 2, dy: border / 2), cornerRadius: style.cornerRadius - border / 2)
    frame.lineWidth = border
    frame.stroke()
  }

  private final class GridView: UIView {
    weak var table: TableView?

    override init(frame: CGRect) {
      super.init(frame: frame)
      backgroundColor = .clear
      contentMode = .redraw
    }

    required init?(coder: NSCoder) { fatalError("GridView is made in code") }

    override func draw(_ rect: CGRect) {
      guard let table, let context = UIGraphicsGetCurrentContext() else { return }
      context.saveGState()
      UIBezierPath(roundedRect: bounds, cornerRadius: table.style.cornerRadius).addClip()
      for (row, frames) in table.cellFrames.enumerated() {
        for (index, frame) in frames.enumerated() where frame.intersects(rect) {
          let cell = CellIndex(row: row, index: index)
          if !table.isPinned(cell) { table.draw(cell, in: frame, context) }
        }
      }
      context.restoreGState()
      table.strokeFrame(in: bounds)
    }
  }

  /// The cells pinned at the table's start, drawn over what scrolls under
  /// them, with the web's shadow beside them once it does.
  private final class PinnedView: UIView {
    weak var table: TableView?

    override init(frame: CGRect) {
      super.init(frame: frame)
      backgroundColor = .clear
      isOpaque = false
      isUserInteractionEnabled = false
      contentMode = .redraw
    }

    required init?(coder: NSCoder) { fatalError("PinnedView is made in code") }

    override func draw(_ rect: CGRect) {
      guard let table, let context = UIGraphicsGetCurrentContext() else { return }
      let style = table.style
      let inner = style.cornerRadius - table.border
      context.translateBy(x: -frame.minX, y: 0)
      let frames = table.pinnedCells.map { ($0, table.shownFrame($0)) }
      if table.scrollsLeft {
        context.saveGState()
        context.setShadow(
          offset: CGSize(width: style.pinned.shadowX, height: 0), blur: style.pinned.shadowBlur,
          color: style.shadowColor.color.cgColor)
        UIColor.black.setFill()
        for (_, frame) in frames { UIRectFill(frame.insetBy(dx: -style.pinned.shadowSpread, dy: -style.pinned.shadowSpread)) }
        context.restoreGState()
      }
      let inside = CGRect(
        x: frame.minX, y: table.border, width: frame.width, height: table.tableSize.height - 2 * table.border)
      UIBezierPath(roundedRect: inside, byRoundingCorners: [.topLeft, .bottomLeft], cornerRadii: CGSize(width: inner, height: inner))
        .addClip()
      for (cell, frame) in frames { table.draw(cell, in: frame, context) }
    }
  }

  /// The web's `data-scroll-left` and `data-scroll-right`: a shadow at an
  /// edge the table scrolls past, or a frame while it scrolls either way.
  private final class ScrollEdgeView: UIView {
    enum Part { case shadows, frame }

    weak var table: TableView?
    let part: Part

    init(_ part: Part) {
      self.part = part
      super.init(frame: .zero)
      backgroundColor = .clear
      isOpaque = false
      isUserInteractionEnabled = false
      contentMode = .redraw
    }

    required init?(coder: NSCoder) { fatalError("ScrollEdgeView is made in code") }

    override func draw(_ rect: CGRect) {
      guard let table, let context = UIGraphicsGetCurrentContext() else { return }
      let x = table.contentOffset.x
      let scrollsLeft = x > 1
      let scrollsRight = x + table.bounds.width < table.contentSize.width - 1
      guard scrollsLeft || scrollsRight else { return }
      guard part == .shadows else { return table.strokeFrame(in: bounds) }
      let shadow = table.style.shadowColor.color
      let colors = [shadow.cgColor, shadow.withAlphaComponent(0).cgColor] as CFArray
      guard let gradient = CGGradient(colorsSpace: nil, colors: colors, locations: [0, 1]) else { return }
      if scrollsLeft {
        context.drawLinearGradient(
          gradient, start: .zero, end: CGPoint(x: table.style.shadowWidth, y: 0), options: [])
      }
      if scrollsRight {
        context.drawLinearGradient(
          gradient, start: CGPoint(x: bounds.maxX, y: 0), end: CGPoint(x: bounds.maxX - table.style.shadowWidth, y: 0),
          options: [])
      }
    }
  }
}

/// A table with the room below it, which gives the table's pan to the view
/// it is put in: a view that takes no touches, as a block's doesn't, holds
/// a table that can't be dragged.
@MainActor final class TableHolder: UIView {
  let table: TableView

  init(_ table: TableView) {
    self.table = table
    super.init(frame: .zero)
    addSubview(table.underlay)
    addSubview(table)
    addSubview(table.overlay)
  }

  required init?(coder: NSCoder) { fatalError("TableHolder is made in code") }

  override func willMove(toSuperview newSuperview: UIView?) {
    super.willMove(toSuperview: newSuperview)
    if let newSuperview {
      newSuperview.addGestureRecognizer(table.panGestureRecognizer)
    } else {
      superview?.removeGestureRecognizer(table.panGestureRecognizer)
    }
  }
}

extension UIColor {
  convenience init(css color: CSSColor) {
    self.init(red: color.red, green: color.green, blue: color.blue, alpha: color.alpha)
  }
}
#endif
