#if canImport(UIKit)
import UIKit

/// A table's cells in a grid of equal columns, scrolling sideways when wider
/// than its frame. Cell geometry is in the table's own frame, where it is
/// seen, rather than in its scrolled content.
///
/// Its pan begins only on a sideways drag that starts over it, wherever
/// the pan is (`TableHolder`).
@MainActor final class TableView: UIScrollView {
  static let columnWidth: CGFloat = 140
  static let padding: CGFloat = 8

  private(set) var cells: [[TextBox]] = []
  private(set) var cellFrames: [[CGRect]] = []
  private let grid = GridView()
  var onScroll: (() -> Void)?
  private var shownX: CGFloat = 0

  init(cells texts: [[NSAttributedString]]) {
    super.init(frame: .zero)
    showsVerticalScrollIndicator = false
    alwaysBounceHorizontal = false
    addSubview(grid)
    grid.table = self
    set(cells: texts)
  }

  required init?(coder: NSCoder) { fatalError("TableView is made in code") }

  var height: CGFloat { grid.frame.height }

  func set(cells texts: [[NSAttributedString]]) {
    let width = Self.columnWidth - 2 * Self.padding
    cells = texts.map { row in row.map { TextBox($0, width: width) } }
    var y: CGFloat = 0
    cellFrames = cells.map { row in
      let height = (row.map(\.height).max() ?? 0) + 2 * Self.padding
      defer { y += height }
      return row.indices.map { CGRect(x: CGFloat($0) * Self.columnWidth, y: y, width: Self.columnWidth, height: height) }
    }
    let columns = cells.map(\.count).max() ?? 0
    grid.frame = CGRect(x: 0, y: 0, width: CGFloat(columns) * Self.columnWidth + 1, height: y + 1)
    contentSize = grid.frame.size
    grid.setNeedsDisplay()
  }

  /// Where the text of the cell at `row` and `column` starts, in the frame.
  func textOrigin(row: Int, column: Int) -> CGPoint {
    let frame = cellFrames[row][column]
    return CGPoint(x: frame.minX + Self.padding - contentOffset.x, y: frame.minY + Self.padding)
  }

  /// The cell a point in the frame is in, or the nearest.
  func cell(at point: CGPoint) -> (row: Int, column: Int)? {
    guard !cellFrames.isEmpty else { return nil }
    let row = cellFrames.lastIndex { ($0.first?.minY ?? 0) <= point.y } ?? 0
    let frames = cellFrames[row]
    guard !frames.isEmpty else { return nil }
    let x = point.x + contentOffset.x
    return (row, frames.lastIndex { $0.minX <= x } ?? 0)
  }

  func redraw() { grid.setNeedsDisplay() }

  /// Scrolls sideways as little as shows the cell at `row` and `column`.
  func scrollToShow(row: Int, column: Int) {
    scrollRectToVisible(cellFrames[row][column], animated: false)
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
      onScroll?()
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
      UIColor.separator.setStroke()
      for (row, frames) in table.cellFrames.enumerated() {
        for (column, frame) in frames.enumerated() where frame.intersects(rect) {
          let border = UIBezierPath(rect: frame.offsetBy(dx: 0.5, dy: 0.5))
          border.lineWidth = 1
          border.stroke()
          table.cells[row][column].draw(
            at: CGPoint(x: frame.minX + TableView.padding, y: frame.minY + TableView.padding), in: context)
        }
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
#endif
