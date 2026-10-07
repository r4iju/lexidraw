#if canImport(UIKit)
import CSSValues
import UIKit

/// A table laid out as the web lays out a document's table
/// (`.document-table` in `document.css`, and the columns
/// `DocumentTablesPlugin` keeps whole): columns as wide as their text asks,
/// within the text's width where that fits, or at the widths the table is
/// set to; wider than its frame, it scrolls sideways, and on a narrow
/// screen a table of many columns pins its first as it does, as any width
/// does a table that freezes its first column. Cell geometry
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

  /// What a table's node sets on how it is drawn, beside its cells.
  struct Presentation: Equatable {
    var rowStriping = false
    var freezesFirstColumn = false
  }

  private var boxes: [[TextBox]] = []
  override func didMoveToWindow() {
    super.didMoveToWindow()
    for box in boxes.joined() { box.setAnimationVisible(window != nil) }
  }
  /// Each cell's box, borders included, by row and by its index in the row,
  /// in the content.
  private var cellFrames: [[CGRect]] = []
  /// Where each row starts, and the table's inner bottom last.
  private var rowTops: [CGFloat] = [0]
  private var cells: [[Cell]] = []
  private var tableSize: CGSize = .zero
  private let grid = GridView()
  private let pinned = PinnedView()
  private let scrollingFrame = ScrollingFrameView()
  /// The web's mask over an edge the table scrolls towards, for its holder.
  fileprivate let fade = CAGradientLayer()
  private var presentation = Presentation()
  /// The rows a striped table shades: every second of those with a cell
  /// that isn't a header, as `:nth-child(even of :has(> td))` counts them.
  private var stripedRows: Set<Int> = []
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
  private let textMeasurements: TextMeasurements
  private var paddingX: CGFloat { style.paddingX }
  private var paddingY: CGFloat { style.paddingY }
  private var border: CGFloat { style.border }

  init(
    cells: [[Cell]], columnWidths: [Double]?, presentation: Presentation = Presentation(), width: CGFloat,
    style: DocumentTypography.Table,
    selectedOutline: DocumentTypography.Outline, textMeasurements: TextMeasurements? = nil, prepareIncrementally: Bool = false
  ) {
    self.style = style
    self.selectedOutline = selectedOutline
    self.textMeasurements = textMeasurements ?? TextMeasurements(style)
    super.init(frame: .zero)
    showsVerticalScrollIndicator = false
    alwaysBounceHorizontal = false
    addSubview(grid)
    addSubview(pinned)
    grid.table = self
    pinned.table = self
    scrollingFrame.table = self
    fade.startPoint = CGPoint(x: 0, y: 0.5)
    fade.endPoint = CGPoint(x: 1, y: 0.5)
    fade.colors = [UIColor.clear, .black, .black, .clear].map(\.cgColor)
    self.presentation = presentation
    beginPreparation(cells: cells, columnWidths: columnWidths, width: width)
    if !prepareIncrementally { finishPreparation() }
  }

  required init?(coder: NSCoder) { fatalError("TableView is made in code") }

  /// What goes over it, as the region's outline: the frame of a table that
  /// scrolls.
  var overlay: UIView { scrollingFrame }

  var height: CGFloat { tableSize.height }
  var onGeometryChange: (() -> Void)?

  private final class Preparation {
    let placed: Placement
    let indices: [CellIndex]
    let columnWidths: [Double]?
    let width: CGFloat
    var metrics: [[TextMetrics?]]
    var short: Set<Int>
    var body: [Int]
    var numbers: [Int]
    var columns: [CGFloat]?
    var alignment: Set<Int> = []
    var cursor = 0

    init(_ cells: [[Cell]], columnWidths: [Double]?, width: CGFloat) {
      placed = Placement(cells)
      indices = cells.enumerated().flatMap { row, cells in cells.indices.map { CellIndex(row: row, index: $0) } }
      self.columnWidths = columnWidths
      self.width = width
      metrics = cells.map { Array(repeating: nil, count: $0.count) }
      short = Set(0..<(cells.first?.count ?? 0))
      body = Array(repeating: 0, count: cells.first?.count ?? 0)
      numbers = body
    }
  }
  private var preparation: Preparation?

  func set(cells: [[Cell]], columnWidths: [Double]?, presentation: Presentation = Presentation(), width: CGFloat) {
    self.presentation = presentation
    beginPreparation(cells: cells, columnWidths: columnWidths, width: width)
    finishPreparation()
  }

  private func beginPreparation(cells: [[Cell]], columnWidths: [Double]?, width: CGFloat) {
    self.cells = cells
    boxes = cells.map { _ in [] }
    let body = cells.indices.filter { row in cells[row].contains { !$0.isHeader } }
    stripedRows = presentation.rowStriping ? Set(body.enumerated().filter { $0.offset % 2 == 1 }.map(\.element)) : []
    preparation = Preparation(cells, columnWidths: columnWidths, width: width)
  }

  /// Measures one cell per call. No partial geometry is exposed to the editor.
  @discardableResult func prepareNextCell() -> Bool {
    guard let preparation else { return true }
    if preparation.columns == nil, preparation.cursor < preparation.indices.count {
      let at = preparation.indices[preparation.cursor]
      let cell = cells[at.row][at.index]
      preparation.metrics[at.row][at.index] = textMeasurements.metrics(cell)
      let plain = Self.plainText(cell)
      if preparation.short.contains(at.index), Self.columnsWide(plain, isWide: textMeasurements.isWide) > style.shortColumns {
        preparation.short.remove(at.index)
      }
      if preparation.body.indices.contains(at.index), !cell.isHeader {
        preparation.body[at.index] += 1
        if style.number.firstMatch(in: plain) != nil { preparation.numbers[at.index] += 1 }
      }
      preparation.cursor += 1
      return false
    }
    if preparation.columns == nil {
      let placed = preparation.placed
      let metrics = preparation.metrics.map { $0.map { $0! } }
      let short = preparation.short
      var whole = short
      var columns = self.columns(placed, metrics, short: short, whole: whole, fixed: preparation.columnWidths, width: preparation.width)
      // Short columns stay whole while the table fits, the widest giving way
      // first (`fitShortColumns`).
      if preparation.columnWidths == nil, (cells.first?.count ?? 0) < style.scrollingColumns {
        while !whole.isEmpty, columns.reduce(0, +) + 2 * border > preparation.width {
          let firstRow = cells.first?.indices.map { placed.width(row: 0, index: $0, columns) } ?? []
          let widest = whole.max { (firstRow[safe: $0] ?? 0) < (firstRow[safe: $1] ?? 0) }!
          whole.remove(widest)
          columns = self.columns(placed, metrics, short: short, whole: whole, fixed: nil, width: preparation.width)
        }
      }
      preparation.columns = columns
      preparation.alignment = Set(preparation.body.indices.filter {
        preparation.body[$0] > 0 && Double(preparation.numbers[$0]) / Double(preparation.body[$0]) >= 0.8
      })
      preparation.cursor = 0
    }
    if preparation.cursor < preparation.indices.count {
      let at = preparation.indices[preparation.cursor]
      let content = preparation.placed.width(row: at.row, index: at.index, preparation.columns!) - 2 * paddingX - endBorder(at.row, at.index)
      let box = TextBox(styled(cells[at.row][at.index], alignedRight: preparation.alignment.contains(at.index)), width: max(content, 1))
      box.onRedraw = { [weak self] in
        guard let self else { return }
        // Cells prepared on later frames do not have TextBoxes yet. Their
        // final geometry pass will include the freshly measured attachment.
        guard self.preparation == nil else { self.redraw(); return }
        self.finishGeometry(preparation)
        self.onGeometryChange?()
      }
      box.setAnimationVisible(window != nil)
      boxes[at.row].append(box)
      preparation.cursor += 1
      return false
    }
    finishGeometry(preparation)
    self.preparation = nil
    return true
  }

  func finishPreparation() {
    while !prepareNextCell() {}
  }

  private func finishGeometry(_ preparation: Preparation) {
    let placed = preparation.placed
    let columns = preparation.columns!
    let width = preparation.width
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
      presentation.freezesFirstColumn
      || viewportWidth(width) <= style.pinned.width && (cells.first?.count ?? 0) > style.unpinnedColumns
    grid.frame = CGRect(origin: .zero, size: tableSize)
    contentSize = tableSize
    frame.size = CGSize(width: width, height: tableSize.height)
    scrollingFrame.frame = CGRect(x: 0, y: 0, width: min(width, tableSize.width), height: tableSize.height)
    placePinnedCells()
    (superview as? TableHolder)?.setNeedsLayout()
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

  private static func plainText(_ cell: Cell) -> String {
    cell.text.string.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// `columnsWide`: a wide character counts as two.
  private static func columnsWide(_ text: String, isWide: (Unicode.Scalar) -> Bool) -> Int {
    text.unicodeScalars.reduce(0) { $0 + (isWide($1) ? 2 : 1) }
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
    scrollingFrame.setNeedsDisplay()
  }

  /// Where the holder's mask fades what the table shows, in `width`: an
  /// edge it scrolls towards, but not a pinned column's, or nil while the
  /// table shows all it holds.
  fileprivate func fadeLocations(in width: CGFloat) -> [NSNumber]? {
    let x = contentOffset.x
    let start = x > 1 && !pinsFirstCells ? style.fadeWidth : 0
    let end = x + bounds.width < contentSize.width - 1 ? style.fadeWidth : 0
    guard start > 0 || end > 0, width > 0 else { return nil }
    return [0, start / width, 1 - end / width, 1].map { NSNumber(value: Double($0)) }
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
      scrollingFrame.setNeedsDisplay()
      (superview as? TableHolder)?.setNeedsLayout()
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
  final class TextMeasurements {
    private let style: DocumentTypography.Table
    private var wideScalars: [Unicode.Scalar: Bool] = [:]
    private let widths = NSCache<NSAttributedString, StoredMetrics>()

    init(_ style: DocumentTypography.Table) {
      self.style = style
      widths.countLimit = 256
      widths.totalCostLimit = 2_000_000
    }

    func isWide(_ scalar: Unicode.Scalar) -> Bool {
      if let result = wideScalars[scalar] { return result }
      let result = style.isWide(scalar)
      if wideScalars.count == 512 { wideScalars.removeAll(keepingCapacity: true) }
      wideScalars[scalar] = result
      return result
    }

    fileprivate func metrics(_ cell: Cell) -> TextMetrics {
      var cacheable = true
      let whole = NSRange(location: 0, length: cell.text.length)
      cell.text.enumerateAttributes(in: whole) { attributes, _, stop in
        for value in attributes.values {
          guard value is NSParagraphStyle || value is UIFont || value is UIColor || value is NSNumber
            || (value is NSString && !(value is NSMutableString)) || value is NSURL
          else { cacheable = false; stop.pointee = true; return }
        }
      }
      if cacheable, let stored = widths.object(forKey: cell.text) { return stored.value }
      let value = TextMetrics(cell, isWide: isWide)
      if cacheable {
        let key = NSMutableAttributedString(attributedString: cell.text)
        key.enumerateAttribute(.paragraphStyle, in: whole) { value, range, _ in
          if let paragraph = value as? NSParagraphStyle { key.addAttribute(.paragraphStyle, value: paragraph.copy(), range: range) }
        }
        widths.setObject(StoredMetrics(value), forKey: NSAttributedString(attributedString: key), cost: cell.text.length * 2)
      }
      return value
    }

    private final class StoredMetrics {
      let value: TextMetrics
      init(_ value: TextMetrics) { self.value = value }
    }
  }

  fileprivate struct TextMetrics {
    var minContent: CGFloat = 0
    var maxContent: CGFloat = 0
    var isEmpty: Bool

    init(_ cell: Cell, isWide: (Unicode.Scalar) -> Bool) {
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
        } else if let scalar, isWide(scalar) {
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
    let stripe = !cell.isHeader && stripedRows.contains(index.row) ? style.stripe.color : nil
    let fill =
      cell.background.map(inTheme) ?? (cell.isHeader ? header.color : nil)
      ?? (pinned ? stripe ?? style.pinned.background.color : nil)
      ?? (selectedCells.contains(index) ? style.selection.color : nil) ?? stripe
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

  /// A cell's own colour as the theme shows it: as set in the light theme;
  /// in the dark one, at `darkFill`'s luminosity with the colour's hue and
  /// saturation, as `background-blend-mode: luminosity` mixes them.
  private func inTheme(_ color: UIColor) -> UIColor {
    let luminosity = Self.luminosity(style.darkFill.dark)
    return UIColor { traits in
      guard traits.userInterfaceStyle == .dark else { return color }
      var (red, green, blue, alpha): (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
      color.resolvedColor(with: traits).getRed(&red, green: &green, blue: &blue, alpha: &alpha)
      let shift = luminosity - Self.luminosity(RGBA(red, green, blue, alpha))
      let (r, g, b) = Self.clipped(red + shift, green + shift, blue + shift)
      return UIColor(red: r, green: g, blue: b, alpha: alpha)
    }
  }

  /// The compositing spec's `Lum`.
  private static func luminosity(_ color: RGBA) -> CGFloat {
    0.3 * color.red + 0.59 * color.green + 0.11 * color.blue
  }

  /// The compositing spec's `ClipColor`: back within 0 to 1 at the same
  /// luminosity and hue.
  private static func clipped(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat) -> (CGFloat, CGFloat, CGFloat) {
    let l = luminosity(RGBA(red, green, blue, 1))
    let (low, high) = (min(red, green, blue), max(red, green, blue))
    func clip(_ c: CGFloat) -> CGFloat {
      var c = c
      if low < 0 { c = l + (c - l) * l / (l - low) }
      if high > 1 { c = l + (c - l) * (1 - l) / (high - l) }
      return c
    }
    return (clip(red), clip(green), clip(blue))
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

  /// The web's frame on the region of a table that scrolls either way.
  private final class ScrollingFrameView: UIView {
    weak var table: TableView?

    override init(frame: CGRect) {
      super.init(frame: frame)
      backgroundColor = .clear
      isOpaque = false
      isUserInteractionEnabled = false
      contentMode = .redraw
    }

    required init?(coder: NSCoder) { fatalError("ScrollingFrameView is made in code") }

    override func draw(_ rect: CGRect) {
      guard let table else { return }
      let x = table.contentOffset.x
      guard x > 1 || x + table.bounds.width < table.contentSize.width - 1 else { return }
      table.strokeFrame(in: bounds)
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
    addSubview(table)
    addSubview(table.overlay)
  }

  /// Fades what lies past an edge the table scrolls towards, its frame
  /// included, as the web masks the table's region.
  override func layoutSubviews() {
    super.layoutSubviews()
    let width = table.overlay.frame.width
    guard let locations = table.fadeLocations(in: width) else {
      layer.mask = nil
      return
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    table.fade.frame = CGRect(x: 0, y: 0, width: width, height: bounds.height)
    table.fade.locations = locations
    CATransaction.commit()
    layer.mask = table.fade
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
