#if canImport(UIKit)
import UIKit

/// A table laid out as the web lays out a document's table
/// (`.document-table` in `document.css`, and the columns
/// `DocumentTablesPlugin` keeps whole): columns as wide as their text asks,
/// within the text's width where that fits, or at the widths the table is
/// set to; wider than its frame, it scrolls sideways. Cell geometry is in
/// the table's own frame, where it is seen, rather than in its scrolled
/// content.
///
/// Its pan begins only on a sideways drag that starts over it, wherever
/// the pan is (`TableHolder`).
@MainActor final class TableView: UIScrollView {
  struct Cell {
    var text: NSAttributedString
    var colSpan = 1
    var rowSpan = 1
    var isHeader = false
  }

  /// `document.css`'s measures, a CSS pixel to a point.
  enum Measure {
    static let paddingX: CGFloat = 12
    static let paddingY: CGFloat = 8
    static let border: CGFloat = 1
    static let cornerRadius: CGFloat = 6
    /// A cell's least width, 7.5rem, unless its column is short; at most
    /// 40vw.
    static let minimumWidth: CGFloat = 120
    /// An empty cell's, 6rem.
    static let emptyWidth: CGFloat = 96
    /// The scroll shadows' width.
    static let shadowWidth: CGFloat = 10
  }

  /// `DocumentTablesPlugin`'s `SHORT_COLUMNS`: a column no wider than this
  /// in Latin letters keeps each cell on one line.
  static let shortColumns = 16
  /// Its `SCROLLING_COLUMNS`: a table this many columns wide keeps its short
  /// columns whole even where that makes it scroll.
  static let scrollingColumns = 5

  private(set) var boxes: [[TextBox]] = []
  /// Each cell's box, borders included, by row and by its index in the row,
  /// in the content.
  private(set) var cellFrames: [[CGRect]] = []
  /// Where each row starts, and the table's inner bottom last.
  private(set) var rowTops: [CGFloat] = [0]
  private var cells: [[Cell]] = []
  private var tableSize: CGSize = .zero
  private let grid = GridView()
  private let shadows = ShadowView()
  /// The cells a table selection has, by row and index in the row.
  var selectedCells: Set<CellIndex> = [] {
    didSet { if selectedCells != oldValue { grid.setNeedsDisplay() } }
  }
  var onScroll: (() -> Void)?
  private var shownX: CGFloat = 0

  struct CellIndex: Hashable {
    var row: Int
    var index: Int
  }

  init(cells: [[Cell]], columnWidths: [Double]?, width: CGFloat) {
    super.init(frame: .zero)
    showsVerticalScrollIndicator = false
    alwaysBounceHorizontal = false
    addSubview(grid)
    grid.table = self
    shadows.table = self
    set(cells: cells, columnWidths: columnWidths, width: width)
  }

  required init?(coder: NSCoder) { fatalError("TableView is made in code") }

  /// What goes behind the table where it is drawn: the scroll shadows and
  /// the frame of a table that scrolls, which stay put as it does.
  var overlay: UIView { shadows }

  var height: CGFloat { tableSize.height }

  func set(cells: [[Cell]], columnWidths: [Double]?, width: CGFloat) {
    self.cells = cells
    let placed = Placement(cells)
    let metrics = cells.map { $0.map(TextMetrics.init) }
    let short = shortColumns(cells)
    var whole = short
    var columns = self.columns(placed, metrics, whole: whole, fixed: columnWidths, width: width)
    // Short columns stay whole while the table fits, the widest giving way
    // first (`fitShortColumns`).
    if columnWidths == nil, (cells.first?.count ?? 0) < Self.scrollingColumns {
      while !whole.isEmpty, columns.reduce(0, +) + 2 * Measure.border > width {
        let firstRow = cells.first?.indices.map { placed.width(row: 0, index: $0, columns) } ?? []
        let widest = whole.max { (firstRow[safe: $0] ?? 0) < (firstRow[safe: $1] ?? 0) }!
        whole.remove(widest)
        columns = self.columns(placed, metrics, whole: whole, fixed: nil, width: width)
      }
    }
    let alignment = numericColumns(cells)
    boxes = cells.enumerated().map { row, rowCells in
      rowCells.enumerated().map { index, cell in
        let content = placed.width(row: row, index: index, columns) - 2 * Measure.paddingX - endBorder(row, index)
        return TextBox(Self.styled(cell, alignedRight: alignment.contains(index)), width: max(content, 1))
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
    rowTops = [Measure.border]
    for height in rowHeights { rowTops.append(rowTops[rowTops.count - 1] + height) }
    let lefts = columns.reduce(into: [Measure.border]) { $0.append($0[$0.count - 1] + $1) }
    cellFrames = cells.enumerated().map { row, rowCells in
      rowCells.indices.map { index in
        let column = placed.columns[row][index]
        let rowSpan = placed.rowSpan(row: row, index: index)
        return CGRect(
          x: lefts[column], y: rowTops[row], width: lefts[column + placed.colSpan(row: row, index: index)] - lefts[column],
          height: rowTops[row + rowSpan] - rowTops[row])
      }
    }
    tableSize = CGSize(width: (lefts.last ?? 0) + Measure.border, height: (rowTops.last ?? 0) + Measure.border)
    grid.frame = CGRect(origin: .zero, size: tableSize)
    contentSize = tableSize
    frame.size = CGSize(width: width, height: tableSize.height)
    shadows.frame = CGRect(x: 0, y: 0, width: min(width, tableSize.width), height: tableSize.height)
    grid.setNeedsDisplay()
    shadows.setNeedsDisplay()
  }

  private func cellHeight(_ row: Int, _ index: Int) -> CGFloat {
    let box = boxes[row][index]
    return box.height - box.trailingSpacing + 2 * Measure.paddingY + (row == cells.count - 1 ? 0 : Measure.border)
  }

  /// A row's last cell has no border at its end.
  private func endBorder(_ row: Int, _ index: Int) -> CGFloat {
    index == cells[row].count - 1 ? 0 : Measure.border
  }

  /// The columns' widths, borders included: CSS's automatic table layout,
  /// or the widths the table is set to.
  private func columns(
    _ placed: Placement, _ metrics: [[TextMetrics]], whole: Set<Int>, fixed: [Double]?, width: CGFloat
  ) -> [CGFloat] {
    let count = placed.columnCount
    if let fixed, let last = fixed.last {
      return (0..<count).map { CGFloat(fixed[safe: $0] ?? last) }
    }
    let viewport = (window?.bounds.width ?? width + 2 * BlockLayout.margin)
    var least = [CGFloat](repeating: 0, count: count)
    var most = [CGFloat](repeating: 0, count: count)
    var spanning: [(columns: Range<Int>, least: CGFloat, most: CGFloat)] = []
    let short = shortColumns(cells)
    for (row, rowCells) in metrics.enumerated() {
      for (index, text) in rowCells.enumerated() {
        let floor =
          text.isEmpty ? Measure.emptyWidth : short.contains(index) ? 0 : min(Measure.minimumWidth, 0.4 * viewport)
        let around = 2 * Measure.paddingX + endBorder(row, index)
        let cellMost = max(text.maxContent + around, floor)
        let cellLeast = whole.contains(index) ? cellMost : max(text.minContent + around, floor)
        let start = placed.columns[row][index]
        let span = start..<min(start + placed.colSpan(row: row, index: index), count)
        if span.count == 1 {
          least[start] = max(least[start], cellLeast)
          most[start] = max(most[start], cellMost)
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
    let available = width - 2 * Measure.border
    let (leastTotal, mostTotal) = (least.reduce(0, +), most.reduce(0, +))
    if mostTotal <= available { return most }
    guard leastTotal < available else { return least }
    let share = (available - leastTotal) / (mostTotal - leastTotal)
    return (0..<count).map { least[$0] + (most[$0] - least[$0]) * share }
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
          return Self.columnsWide(Self.plainText(cell)) <= Self.shortColumns
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
        let numbers = body.filter { Self.isNumber(Self.plainText($0)) }
        return !body.isEmpty && Double(numbers.count) / Double(body.count) >= 0.8
      })
  }

  private static func plainText(_ cell: Cell) -> String {
    cell.text.string.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// `DocumentTablesPlugin`'s `number`.
  private static let number = try! NSRegularExpression(
    pattern:
      #"^(?:[+-]?\s*(?:[$€£¥￥]|[A-Z]{3}\s)?\s*\d[\d,]*(?:\.\d+)?\s*(?:%|円)?|\(\s*[$€£¥￥]?\d[\d,]*(?:\.\d+)?\s*\))$"#)

  private static func isNumber(_ text: String) -> Bool {
    number.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil
  }

  /// `columnsWide`: a CJK character counts as two.
  private static func columnsWide(_ text: String) -> Int {
    text.unicodeScalars.reduce(0) { $0 + (TextMetrics.isWide($1) ? 2 : 1) }
  }

  /// A cell's text as the web shows it: a header's semibold, and a number
  /// column's aligned right.
  private static func styled(_ cell: Cell, alignedRight: Bool) -> NSAttributedString {
    guard cell.isHeader || alignedRight else { return cell.text }
    let text = NSMutableAttributedString(attributedString: cell.text)
    let whole = NSRange(location: 0, length: text.length)
    if cell.isHeader {
      text.enumerateAttribute(.font, in: whole) { value, range, _ in
        guard let font = value as? UIFont, !font.fontDescriptor.symbolicTraits.contains(.traitBold) else { return }
        let traits = (font.fontDescriptor.object(forKey: .traits) as? [UIFontDescriptor.TraitKey: Any]) ?? [:]
        let semibold = font.fontDescriptor.addingAttributes([
          .traits: traits.merging([.weight: UIFont.Weight.semibold]) { $1 }
        ])
        text.addAttribute(.font, value: UIFont(descriptor: semibold, size: font.pointSize), range: range)
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

  /// Where the text of the cell at `row` and `index` starts, in the frame.
  func textOrigin(row: Int, index: Int) -> CGPoint {
    let frame = cellFrames[row][index]
    return CGPoint(x: frame.minX + Measure.paddingX - contentOffset.x, y: frame.minY + Measure.paddingY)
  }

  /// The cell a point in the frame is in, or the nearest.
  func cell(at point: CGPoint) -> CellIndex? {
    let content = CGPoint(x: point.x + contentOffset.x, y: point.y)
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
    shadows.setNeedsDisplay()
  }

  /// Scrolls sideways as little as shows the cell at `row` and `index`.
  func scrollToShow(row: Int, index: Int) {
    scrollRectToVisible(cellFrames[row][index], animated: false)
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
      shownX = contentOffset.x
      shadows.setNeedsDisplay()
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
            while map[row][safe: column] != nil { column += 1 }
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

    init(_ cell: Cell) {
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
        } else if let scalar, Self.isWide(scalar) {
          // A line may break either side of a CJK character.
          minContent = max(minContent, width(pieceStart, offset), width(offset, offset + 1))
          pieceStart = offset + 1
        }
      }
    }

    static func isWide(_ scalar: Unicode.Scalar) -> Bool {
      switch scalar.value {
      case 0x3000...0x303F, 0xFF00...0xFFEF: return true
      default:
        return scalar.properties.isIdeographic
          || ["Hiragana", "Katakana", "Hangul"].contains { name in
            scalar.properties.name?.hasPrefix(name.uppercased()) == true
          }
      }
    }
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
      let outline = UIBezierPath(
        roundedRect: bounds.insetBy(dx: Measure.border / 2, dy: Measure.border / 2),
        cornerRadius: Measure.cornerRadius - Measure.border / 2)
      context.saveGState()
      UIBezierPath(roundedRect: bounds, cornerRadius: Measure.cornerRadius).addClip()
      for (row, frames) in table.cellFrames.enumerated() {
        for (index, frame) in frames.enumerated() where frame.intersects(rect) {
          if table.cells[row][index].isHeader {
            TableColors.muted.setFill()
            UIRectFill(frame)
          }
          if table.selectedCells.contains(CellIndex(row: row, index: index)) {
            TableColors.selected.setFill()
            UIRectFill(frame)
          }
        }
      }
      TableColors.border.setFill()
      for (row, frames) in table.cellFrames.enumerated() {
        for (index, frame) in frames.enumerated() where frame.intersects(rect) {
          if table.endBorder(row, index) > 0 {
            UIRectFill(CGRect(x: frame.maxX - Measure.border, y: frame.minY, width: Measure.border, height: frame.height))
          }
          if row + table.cells[row][index].rowSpan < table.cells.count {
            UIRectFill(CGRect(x: frame.minX, y: frame.maxY - Measure.border, width: frame.width, height: Measure.border))
          }
          let box = table.boxes[row][index]
          box.draw(at: CGPoint(x: frame.minX + Measure.paddingX, y: frame.minY + Measure.paddingY), in: context)
        }
      }
      context.restoreGState()
      TableColors.border.setStroke()
      outline.lineWidth = Measure.border
      outline.stroke()
    }
  }

  /// The web's `data-scroll-left` and `data-scroll-right`: a shadow at an
  /// edge the table scrolls past, and a frame while it scrolls either way.
  private final class ShadowView: UIView {
    weak var table: TableView?

    override init(frame: CGRect) {
      super.init(frame: frame)
      backgroundColor = .clear
      isOpaque = false
      isUserInteractionEnabled = false
      contentMode = .redraw
    }

    required init?(coder: NSCoder) { fatalError("ShadowView is made in code") }

    override func draw(_ rect: CGRect) {
      guard let table, let context = UIGraphicsGetCurrentContext() else { return }
      let x = table.contentOffset.x
      let scrollsLeft = x > 1
      let scrollsRight = x + table.bounds.width < table.contentSize.width - 1
      guard scrollsLeft || scrollsRight else { return }
      let colors = [TableColors.shadow.cgColor, TableColors.shadow.withAlphaComponent(0).cgColor] as CFArray
      guard let gradient = CGGradient(colorsSpace: nil, colors: colors, locations: [0, 1]) else { return }
      if scrollsLeft {
        context.drawLinearGradient(
          gradient, start: .zero, end: CGPoint(x: Measure.shadowWidth, y: 0), options: [])
      }
      if scrollsRight {
        context.drawLinearGradient(
          gradient, start: CGPoint(x: bounds.maxX, y: 0), end: CGPoint(x: bounds.maxX - Measure.shadowWidth, y: 0),
          options: [])
      }
      TableColors.border.setStroke()
      let frame = UIBezierPath(
        roundedRect: bounds.insetBy(dx: Measure.border / 2, dy: Measure.border / 2),
        cornerRadius: Measure.cornerRadius - Measure.border / 2)
      frame.lineWidth = Measure.border
      frame.stroke()
    }
  }
}

/// The web theme's colours a table uses (`globals.css`), light and dark.
enum TableColors {
  private static func color(light: (Int, Int, Int), dark: (Int, Int, Int), alpha: CGFloat = 1) -> UIColor {
    UIColor { traits in
      let (red, green, blue) = traits.userInterfaceStyle == .dark ? dark : light
      return UIColor(red: CGFloat(red) / 255, green: CGFloat(green) / 255, blue: CGFloat(blue) / 255, alpha: alpha)
    }
  }

  /// `--border`.
  static let border = color(light: (225, 225, 228), dark: (48, 48, 52))
  /// `--muted`, a header cell's background.
  static let muted = color(light: (238, 238, 241), dark: (42, 43, 49))
  /// `bg-primary/10`, `tableCellSelected`.
  static let selected = color(light: (115, 72, 226), dark: (158, 140, 244), alpha: 0.1)
  /// `--muted-foreground`, the scroll shadows'.
  static let shadow = color(light: (95, 96, 103), dark: (164, 164, 171))
}

/// A table with the room below it, which gives the table's pan to the view
/// it is put in: a view that takes no touches, as a block's doesn't, holds
/// a table that can't be dragged.
@MainActor final class TableHolder: UIView {
  let table: TableView

  init(_ table: TableView) {
    self.table = table
    super.init(frame: .zero)
    // Behind the table, as the web's are the region's background.
    addSubview(table.overlay)
    addSubview(table)
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

extension Array {
  subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
#endif
