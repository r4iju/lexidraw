#if canImport(UIKit)
import EditorModelInterface
import UIKit

/// Lays out, draws and hit-tests the document's text for `EditorView`, which
/// keeps the text and turns input into commands. Offsets are UTF-16 offsets
/// into `DocumentText`'s text; geometry is in `surface`'s coordinates.
///
/// Each block at the root is laid out and drawn on its own: text by a
/// TextKit 2 layout of just that block, a table as a grid of cells that
/// scrolls sideways, an embedded node as a view. Only blocks near the
/// viewport are laid out; the others have estimated heights until they are.
///
/// Blocks are spaced as the web spaces them (`Typesetting`), the space
/// after each block counted in its height.
///
/// Wherever a block's height changes above what is on screen, the view
/// scrolls by as much, so what is on screen stays put.
@MainActor final class BlockLayout {
  /// Around the text, and between it and the edge of the view.
  static let margin: CGFloat = 16

  /// What the text is drawn in, and `EditorView`'s text input view.
  let surface = UIView()
  private let storage: NSTextStorage
  private let document: DocumentText
  private let typesetting: Typesetting
  private weak var scrollView: UIScrollView?
  private var width: CGFloat = 0
  private var heights: [CGFloat] = []
  private var measured: [Bool] = []
  /// Where each block starts, and the height of them all last; valid up to
  /// and including `validTops`.
  private var tops: [CGFloat] = [0]
  private var validTops = 0
  private var laidOut: [Int: any LaidOutBlock] = [:]
  /// Called when a block has scrolled sideways within itself, moving the
  /// text in it.
  var onScrollSideways: (() -> Void)?

  /// Blocks laid out beyond those on screen, kept for geometry and scrolling
  /// back, before the farthest are let go.
  private static let keptBlocks = 120

  init(storage: NSTextStorage, document: DocumentText, typesetting: Typesetting) {
    self.storage = storage
    self.document = document
    self.typesetting = typesetting
  }

  /// A block of its own is a view; only a node inside a line of text stands
  /// in the text, as a placeholder the size of a word.
  nonisolated static func standIn(_ node: JSONValue, isBlock: Bool) -> [NSAttributedString.Key: Any]? {
    guard !isBlock, InlinePlaceholder.isEmbedded(node) else { return nil }
    let type = node["type"]?.stringValue ?? ""
    return [.attachment: InlinePlaceholder.attachment(type: type)]
  }

  // MARK: Edits

  /// Shows an edit of the text. `body` makes it and says which blocks it
  /// replaced, or nil when it can't say.
  func edit(_ body: () -> [DocumentText.Splice]?) {
    guard let splices = body() else {
      reset()
      return
    }
    var respaced: [Int] = []
    for splice in splices {
      if splice.new.lowerBound > 0 { respaced.append(splice.new.lowerBound - 1) }
      let reused = splice.old.count == 1 && splice.new.count == 1 ? laidOut[splice.old.lowerBound] : nil
      for index in splice.old { laidOut.removeValue(forKey: index)?.view.removeFromSuperview() }
      let shift = splice.new.count - splice.old.count
      if shift != 0 {
        laidOut = Dictionary(
          uniqueKeysWithValues: laidOut.map { $0.key >= splice.old.upperBound ? ($0.key + shift, $0.value) : ($0.key, $0.value) })
      }
      replaceHeights(splice.old, with: splice.new.map(estimate))
      measured.replaceSubrange(splice.old, with: repeatElement(false, count: splice.new.count))
      if let reused, reused.canShow(document.kind(ofBlock: splice.new.lowerBound)) {
        reused.set(text: text(ofBlock: splice.new.lowerBound), kind: document.kind(ofBlock: splice.new.lowerBound), width: width)
        laidOut[splice.new.lowerBound] = reused
        measure(splice.new.lowerBound, reused)
      }
    }
    // The space after a block depends on the block after it.
    for index in respaced where heights.indices.contains(index) {
      let height = (laidOut[index]?.height ?? estimatedContent(index)) + spaceAfter(index)
      if heights[index] != height { replaceHeights(index..<(index + 1), with: [height]) }
    }
    scrollView?.setNeedsLayout()
  }

  private func reset() {
    for block in laidOut.values { block.view.removeFromSuperview() }
    laidOut = [:]
    heights = (0..<document.blockCount).map(estimate)
    measured = Array(repeating: false, count: heights.count)
    validTops = 0
    tops = Array(repeating: 0, count: heights.count + 1)
  }

  // MARK: Heights

  private var visibleTop: CGFloat { (scrollView?.contentOffset.y ?? 0) - Self.margin }

  private func top(_ index: Int) -> CGFloat {
    if index > validTops {
      if tops.count != heights.count + 1 {
        tops = Array(repeating: 0, count: heights.count + 1)
        validTops = 0
      }
      for next in (validTops + 1)...index { tops[next] = tops[next - 1] + heights[next - 1] }
      validTops = index
    }
    return tops[index]
  }

  private var totalHeight: CGFloat { top(heights.count) }

  private func replaceHeights(_ range: Range<Int>, with new: [CGFloat]) {
    if heights.isEmpty && range.isEmpty && new.isEmpty { return }
    let above = top(range.lowerBound) + heights[range].reduce(0, +) <= visibleTop
    let change = new.reduce(0, +) - heights[range].reduce(0, +)
    heights.replaceSubrange(range, with: new)
    validTops = min(validTops, range.lowerBound)
    if tops.count != heights.count + 1 { tops = Array(tops.prefix(validTops + 1)) + Array(repeating: 0, count: heights.count - validTops) }
    if above, change != 0, let scrollView { scrollView.contentOffset.y += change }
  }

  private func measure(_ index: Int, _ block: any LaidOutBlock) {
    measured[index] = true
    let height = block.height + spaceAfter(index)
    if heights[index] != height { replaceHeights(index..<(index + 1), with: [height]) }
  }

  private func estimate(_ index: Int) -> CGFloat { estimatedContent(index) + spaceAfter(index) }

  private func estimatedContent(_ index: Int) -> CGFloat {
    let block = styled(index)
    switch document.kind(ofBlock: index) {
    case .embedded where block == .rule: return typesetting.typography.rule.width
    case .embedded: return PlaceholderView.height
    case .table(let cells): return CGFloat(cells.count) * (typesetting.lineHeight(block) + 2 * TableView.padding) + 1
    case .text:
      let characterWidth = typesetting.fontSize(block) * 0.5
      let perLine = max(width / characterWidth, 1)
      let lines = max(ceil(CGFloat(document.range(ofBlock: index).length) / perLine), 1)
      return lines * typesetting.lineHeight(block)
    }
  }

  /// The larger of the block's space after it and the next block's before
  /// it, as CSS collapses margins.
  private func spaceAfter(_ index: Int) -> CGFloat {
    let block = styled(index)
    let after = typesetting.space(block, after: index > 0 ? styled(index - 1) : nil).after
    guard index + 1 < document.blockCount else { return after }
    return max(after, typesetting.space(styled(index + 1), after: block).before)
  }

  private func styled(_ index: Int) -> StyledBlock { StyledBlock(document.type(ofBlock: index)) }

  /// The block at `y`, clamped to the document.
  private func blockIndex(atY y: CGFloat) -> Int {
    heights.indices.lastIndex(bisecting: { top($0) <= y })
  }

  // MARK: Layout

  private func text(ofBlock index: Int) -> NSAttributedString {
    let range = document.range(ofBlock: index)
    return storage.attributedSubstring(from: NSRange(location: range.location, length: range.length + 1))
  }

  private func block(_ index: Int) -> any LaidOutBlock {
    if let block = laidOut[index] { return block }
    let kind = document.kind(ofBlock: index)
    let text = text(ofBlock: index)
    let block: any LaidOutBlock =
      switch kind {
      case .text: TextBlock(text: text, width: width)
      case .table: TableBlock(text: text, kind: kind, width: width) { [weak self] in self?.onScrollSideways?() }
      case .embedded where styled(index) == .rule:
        RuleBlock(
          rule: typesetting.typography.rule, caretHeight: UIFont.preferredFont(forTextStyle: .body).lineHeight, width: width)
      case .embedded(let type): EmbedBlock(type: type, width: width)
      }
    laidOut[index] = block
    measure(index, block)
    return block
  }

  /// Lays out what `scrollView` shows, sizing its content and placing
  /// `surface` in it.
  func layoutViewport(of scrollView: UIScrollView) {
    self.scrollView = scrollView
    if surface.superview !== scrollView { scrollView.addSubview(surface) }
    if heights.count != document.blockCount { reset() }
    let width = max(scrollView.bounds.width - 2 * Self.margin, 0)
    if width != self.width {
      // What is at the top stays there, as far into its block as it was.
      let anchor = heights.isEmpty ? 0 : blockIndex(atY: visibleTop)
      let within = heights.isEmpty ? 0 : (visibleTop - top(anchor)) / max(heights[anchor], 1)
      self.width = width
      for (index, block) in laidOut { block.set(text: text(ofBlock: index), kind: block.kind, width: width) }
      heights = heights.indices.map { index in laidOut[index].map { $0.height + spaceAfter(index) } ?? estimate(index) }
      measured = heights.indices.map { laidOut[$0] != nil }
      validTops = 0
      if !heights.isEmpty { scrollView.contentOffset.y = top(anchor) + within * heights[anchor] + Self.margin }
    }
    guard !heights.isEmpty else { return }
    // Laying out blocks can bring more into the viewport.
    var shown = 0..<0
    for _ in 0..<8 {
      let reach = scrollView.bounds.height / 2
      let first = blockIndex(atY: visibleTop - reach)
      let last = blockIndex(atY: visibleTop + scrollView.bounds.height + reach)
      shown = first..<(last + 1)
      let unmeasured = shown.filter { !measured[$0] || laidOut[$0] == nil }
      if unmeasured.isEmpty { break }
      for index in unmeasured { _ = block(index) }
    }
    for index in shown {
      let block = block(index)
      let frame = CGRect(x: 0, y: top(index), width: width, height: heights[index])
      if block.view.frame != frame { block.view.frame = frame }
      if block.view.superview !== surface {
        // Touches go to the surface, whose text interaction places the caret.
        block.view.isUserInteractionEnabled = false
        surface.insertSubview(block.view, at: 0)
      }
    }
    for (index, block) in laidOut where !shown.contains(index) { block.view.removeFromSuperview() }
    if laidOut.count > shown.count + Self.keptBlocks {
      let far = laidOut.keys.sorted { abs($0 - shown.lowerBound) > abs($1 - shown.lowerBound) }
      for index in far.prefix(laidOut.count - shown.count - Self.keptBlocks) where !shown.contains(index) {
        laidOut[index] = nil
      }
    }
    let margin = Self.margin
    let visible = scrollView.bounds.height - scrollView.adjustedContentInset.top - scrollView.adjustedContentInset.bottom
    // A tap anywhere below the text lands on the surface and puts the caret
    // at the end.
    let surfaceHeight = max(totalHeight, visible - 2 * margin)
    let frame = CGRect(x: margin, y: margin, width: width, height: surfaceHeight)
    if surface.frame != frame { surface.frame = frame }
    let size = CGSize(width: scrollView.bounds.width, height: surfaceHeight + 2 * margin)
    if scrollView.contentSize != size { scrollView.contentSize = size }
  }

  func redraw() {
    for block in laidOut.values { block.redraw() }
  }

  // MARK: Geometry

  private func locate(_ offset: Int) -> (index: Int, block: any LaidOutBlock, start: Int, local: Int) {
    let index = document.blockIndex(at: offset)
    let start = document.range(ofBlock: index).location
    return (index, block(index), start, offset - start)
  }

  /// Where `range` is drawn, a line at a time; an empty range gives its caret.
  func segments(_ range: NSRange) -> [CGRect] {
    guard document.blockCount > 0 else { return [] }
    let first = document.blockIndex(at: range.location)
    let last = document.blockIndex(at: NSMaxRange(range))
    // Blocks far off screen in a long selection are only estimated.
    let near = scrollView.map { blockIndex(atY: visibleTop - $0.bounds.height)...blockIndex(atY: visibleTop + 2 * $0.bounds.height) }
    var frames: [CGRect] = []
    for index in first...last {
      let blockRange = document.range(ofBlock: index)
      let start = max(range.location, blockRange.location) - blockRange.location
      let end = min(NSMaxRange(range), NSMaxRange(blockRange) + 1) - blockRange.location
      let local = NSRange(location: start, length: max(end - start, 0))
      if first == last || laidOut[index] != nil || near?.contains(index) != false {
        let block = block(index)
        frames += block.segments(local).map { $0.offsetBy(dx: 0, dy: top(index)) }
      } else {
        frames.append(CGRect(x: 0, y: top(index), width: width, height: heights[index]))
      }
    }
    return frames
  }

  func offset(closestTo point: CGPoint) -> Int? {
    guard document.blockCount > 0 else { return nil }
    let index = blockIndex(atY: point.y)
    let block = block(index)
    let local = block.offset(closestTo: CGPoint(x: point.x, y: point.y - top(index)))
    return document.range(ofBlock: index).location + local
  }

  /// Scrolls the block `offset` is in, where it scrolls within itself, to
  /// show `offset`.
  func scrollToShow(_ offset: Int) {
    guard document.blockCount > 0 else { return }
    let (_, block, _, local) = locate(offset)
    block.reveal(local)
  }

  /// The offset a line up or down from `offset`, keeping its place across
  /// the line, or nil where there is no line that way.
  func offset(movingVerticallyFrom offset: Int, _ direction: NSTextSelectionNavigation.Direction) -> Int? {
    guard document.blockCount > 0 else { return nil }
    let (index, block, start, local) = locate(offset)
    let x = block.segments(NSRange(location: local, length: 0)).first?.minX ?? 0
    if let moved = block.offset(movingVerticallyFrom: local, direction, x: x) { return start + moved }
    let next = direction == .up ? index - 1 : index + 1
    guard heights.indices.contains(next) else { return nil }
    let target = self.block(next)
    let landed = target.offset(closestTo: CGPoint(x: x, y: direction == .up ? target.height - 1 : 1))
    return document.range(ofBlock: next).location + landed
  }

  func lineBoundary(at offset: Int, backward: Bool) -> Int? {
    guard document.blockCount > 0 else { return nil }
    let (_, block, start, local) = locate(offset)
    return start + block.lineBoundary(at: local, backward: backward)
  }

  /// The path of the checklist item whose box a tap at `point` toggles.
  func checklistItem(at point: CGPoint) -> [Int]? {
    guard document.blockCount > 0 else { return nil }
    let index = blockIndex(atY: point.y)
    return block(index).checklistItem(at: CGPoint(x: point.x, y: point.y - top(index))).map { [index] + $0.path }
  }
}

/// A block laid out, with its view. Offsets are into the block; geometry is
/// from the block's top left.
@MainActor private protocol LaidOutBlock: AnyObject {
  var view: UIView { get }
  var kind: DocumentText.BlockKind { get }
  /// Without the space after it.
  var height: CGFloat { get }
  /// Whether this can show a block of `kind` once given its text.
  func canShow(_ kind: DocumentText.BlockKind) -> Bool
  func set(text: NSAttributedString, kind: DocumentText.BlockKind, width: CGFloat)
  func redraw()
  func segments(_ range: NSRange) -> [CGRect]
  func offset(closestTo point: CGPoint) -> Int
  func offset(movingVerticallyFrom offset: Int, _ direction: NSTextSelectionNavigation.Direction, x: CGFloat) -> Int?
  func lineBoundary(at offset: Int, backward: Bool) -> Int
  /// Scrolls within the block, where it can, to show `offset`.
  func reveal(_ offset: Int)
  func checklistItem(at point: CGPoint) -> DocumentText.ListItem?
}

extension LaidOutBlock {
  func reveal(_ offset: Int) {}
  func checklistItem(at point: CGPoint) -> DocumentText.ListItem? { nil }
}

private final class TextBlock: LaidOutBlock {
  private let box: TextBox
  private let drawing = BoxView()

  init(text: NSAttributedString, width: CGFloat) {
    box = TextBox(text, width: width)
    drawing.box = box
    drawing.border = Self.border(text)
  }

  var view: UIView { drawing }
  var kind: DocumentText.BlockKind { .text }
  var height: CGFloat { box.height - box.spacingAfter }
  func canShow(_ kind: DocumentText.BlockKind) -> Bool { kind == .text }

  func set(text: NSAttributedString, kind: DocumentText.BlockKind, width: CGFloat) {
    box.set(width: width)
    box.set(text)
    drawing.border = Self.border(text)
    drawing.setNeedsDisplay()
  }

  private static func border(_ text: NSAttributedString) -> LeadingBorder? {
    text.length > 0 ? text.attribute(.leadingBorder, at: 0, effectiveRange: nil) as? LeadingBorder : nil
  }

  func redraw() { drawing.setNeedsDisplay() }
  func segments(_ range: NSRange) -> [CGRect] { box.segments(range) }
  func offset(closestTo point: CGPoint) -> Int { box.offset(closestTo: point) }
  func offset(movingVerticallyFrom offset: Int, _ direction: NSTextSelectionNavigation.Direction, x: CGFloat) -> Int? {
    box.offset(movingVerticallyFrom: offset, direction, x: x)
  }
  func lineBoundary(at offset: Int, backward: Bool) -> Int { box.lineBoundary(at: offset, backward: backward) }
  func checklistItem(at point: CGPoint) -> DocumentText.ListItem? { box.checklistItem(at: point) }

  final class BoxView: UIView {
    var box: TextBox?
    var border: LeadingBorder?

    override init(frame: CGRect) {
      super.init(frame: frame)
      isOpaque = false
      backgroundColor = nil
      contentMode = .redraw
    }

    required init?(coder: NSCoder) { fatalError("BoxView is made in code") }

    override func draw(_ rect: CGRect) {
      guard let box, let context = UIGraphicsGetCurrentContext() else { return }
      if let border {
        border.color.setFill()
        context.fill(CGRect(x: 0, y: 0, width: border.width, height: box.height - box.spacingAfter))
      }
      box.draw(at: .zero, in: context)
    }
  }
}

private final class TableBlock: LaidOutBlock {
  private(set) var kind: DocumentText.BlockKind
  private let table: TableView
  private let holder: TableHolder

  init(text: NSAttributedString, kind: DocumentText.BlockKind, width: CGFloat, onScroll: @escaping () -> Void) {
    self.kind = kind
    table = TableView(cells: Self.cells(text, kind))
    table.onScroll = onScroll
    holder = TableHolder(table)
    table.frame = CGRect(x: 0, y: 0, width: width, height: table.height)
  }

  private var ranges: [[NSRange]] {
    if case .table(let cells) = kind { cells } else { [] }
  }

  private static func cells(_ text: NSAttributedString, _ kind: DocumentText.BlockKind) -> [[NSAttributedString]] {
    guard case .table(let cells) = kind else { return [] }
    return cells.map { row in
      row.map { text.attributedSubstring(from: NSRange(location: $0.location, length: min($0.length + 1, text.length - $0.location))) }
    }
  }

  var view: UIView { holder }
  var height: CGFloat { table.height }
  func canShow(_ kind: DocumentText.BlockKind) -> Bool { if case .table = kind { true } else { false } }

  func set(text: NSAttributedString, kind: DocumentText.BlockKind, width: CGFloat) {
    self.kind = kind
    table.set(cells: Self.cells(text, kind))
    table.frame = CGRect(x: 0, y: 0, width: width, height: table.height)
  }

  func redraw() { table.redraw() }

  /// The cell `offset` is in, the end of each cell included in it.
  private func cell(at offset: Int) -> (row: Int, column: Int, range: NSRange)? {
    for (row, cells) in ranges.enumerated() {
      for (column, range) in cells.enumerated() where offset <= NSMaxRange(range) { return (row, column, range) }
    }
    guard let row = ranges.indices.last, let column = ranges[row].indices.last else { return nil }
    return (row, column, ranges[row][column])
  }

  func segments(_ range: NSRange) -> [CGRect] {
    var frames: [CGRect] = []
    for (row, cells) in ranges.enumerated() {
      for (column, cell) in cells.enumerated() {
        let start = max(range.location, cell.location)
        let end = min(NSMaxRange(range), NSMaxRange(cell))
        guard start < end || (range.length == 0 && self.cell(at: range.location).map({ $0.row == row && $0.column == column }) == true)
        else { continue }
        let origin = table.textOrigin(row: row, column: column)
        let local = NSRange(location: start - cell.location, length: max(end - start, 0))
        frames += table.cells[row][column].segments(local).map { $0.offsetBy(dx: origin.x, dy: origin.y) }
      }
    }
    // A caret or selection shows only where the table does.
    let shown = CGRect(x: 0, y: 0, width: table.bounds.width, height: table.height)
    return frames.compactMap {
      let clipped = $0.intersection(shown)
      return clipped.isNull || (clipped.width == 0 && range.length > 0) ? nil : clipped
    }
  }

  func reveal(_ offset: Int) {
    guard let (row, column, _) = cell(at: offset) else { return }
    table.scrollToShow(row: row, column: column)
  }

  func offset(closestTo point: CGPoint) -> Int {
    guard let (row, column) = table.cell(at: point) else { return 0 }
    let origin = table.textOrigin(row: row, column: column)
    let local = table.cells[row][column].offset(closestTo: CGPoint(x: point.x - origin.x, y: point.y - origin.y))
    return ranges[row][column].location + local
  }

  /// Up and down move through a cell's lines, then to the cell above or
  /// below, then out of the table.
  func offset(movingVerticallyFrom offset: Int, _ direction: NSTextSelectionNavigation.Direction, x: CGFloat) -> Int? {
    guard let (row, column, range) = cell(at: offset) else { return nil }
    let origin = table.textOrigin(row: row, column: column)
    if let moved = table.cells[row][column].offset(movingVerticallyFrom: offset - range.location, direction, x: x - origin.x) {
      return range.location + moved
    }
    let next = direction == .up ? row - 1 : row + 1
    guard table.cellFrames.indices.contains(next), let frame = table.cellFrames[next].first else { return nil }
    return self.offset(closestTo: CGPoint(x: x, y: direction == .up ? frame.maxY - TableView.padding - 1 : frame.minY + TableView.padding + 1))
  }

  func lineBoundary(at offset: Int, backward: Bool) -> Int {
    guard let (row, column, range) = cell(at: offset) else { return offset }
    return range.location + table.cells[row][column].lineBoundary(at: offset - range.location, backward: backward)
  }
}

/// An embedded node, the caret before it or after it.
private final class EmbedBlock: LaidOutBlock {

  private let container = UIView()
  private let placeholder: PlaceholderView
  private let type: String

  init(type: String, width: CGFloat) {
    self.type = type
    placeholder = PlaceholderView(type: type)
    container.addSubview(placeholder)
    placeholder.frame = CGRect(x: 0, y: 0, width: width, height: PlaceholderView.height)
  }

  var view: UIView { container }
  var kind: DocumentText.BlockKind { .embedded(type: type) }
  var height: CGFloat { PlaceholderView.height }
  func canShow(_ kind: DocumentText.BlockKind) -> Bool { kind == self.kind }

  func set(text: NSAttributedString, kind: DocumentText.BlockKind, width: CGFloat) {
    placeholder.frame = CGRect(x: 0, y: 0, width: width, height: PlaceholderView.height)
  }

  func redraw() {}

  func segments(_ range: NSRange) -> [CGRect] {
    let frame = placeholder.frame
    if range.length > 0 { return range.location == 0 ? [frame] : [] }
    return [CGRect(x: range.location == 0 ? frame.minX : frame.maxX, y: frame.minY, width: 0, height: frame.height)]
  }

  func offset(closestTo point: CGPoint) -> Int { point.x < placeholder.frame.midX ? 0 : 1 }
  func offset(movingVerticallyFrom offset: Int, _ direction: NSTextSelectionNavigation.Direction, x: CGFloat) -> Int? {
    nil
  }
  func lineBoundary(at offset: Int, backward: Bool) -> Int { backward ? 0 : 1 }
}

/// A horizontal rule, the caret before it or after it as tall as a line of
/// text.
private final class RuleBlock: LaidOutBlock {
  private let container = UIView()
  private let line = UIView()
  private let caretHeight: CGFloat

  init(rule: DocumentTypography.Rule, caretHeight: CGFloat, width: CGFloat) {
    self.caretHeight = caretHeight
    line.backgroundColor = rule.color.color
    line.frame = CGRect(x: 0, y: 0, width: width, height: rule.width)
    container.addSubview(line)
  }

  var view: UIView { container }
  var kind: DocumentText.BlockKind { .embedded(type: StyledBlock.ruleType) }
  var height: CGFloat { line.frame.height }
  func canShow(_ kind: DocumentText.BlockKind) -> Bool { kind == self.kind }

  func set(text: NSAttributedString, kind: DocumentText.BlockKind, width: CGFloat) {
    line.frame.size.width = width
  }

  func redraw() {}

  func segments(_ range: NSRange) -> [CGRect] {
    let frame = line.frame.insetBy(dx: 0, dy: (line.frame.height - caretHeight) / 2)
    if range.length > 0 { return range.location == 0 ? [frame] : [] }
    return [CGRect(x: range.location == 0 ? frame.minX : frame.maxX, y: frame.minY, width: 0, height: frame.height)]
  }

  func offset(closestTo point: CGPoint) -> Int { point.x < line.frame.midX ? 0 : 1 }
  func offset(movingVerticallyFrom offset: Int, _ direction: NSTextSelectionNavigation.Direction, x: CGFloat) -> Int? {
    nil
  }
  func lineBoundary(at offset: Int, backward: Bool) -> Int { backward ? 0 : 1 }
}
#endif
