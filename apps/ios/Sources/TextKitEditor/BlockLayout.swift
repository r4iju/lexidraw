#if canImport(UIKit)
import CSSValues
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
  private let tableTextMeasurements: TableView.TextMeasurements
  private weak var scrollView: UIScrollView?
  private var width: CGFloat = 0
  private var heights: [CGFloat] = []
  private var measured: [Bool] = []
  /// Where each block starts, and the height of them all last; valid up to
  /// and including `validTops`.
  private var tops: [CGFloat] = [0]
  private var validTops = 0
  private var laidOut: [Int: any LaidOutBlock] = [:]
  /// One detached table, prepared ahead of the viewport without changing block heights.
  private var preparedTable: (index: Int, block: TableBlock)?
  private var preparationLink: CADisplayLink?
  private var previousTop: CGFloat = 0
  private var scrollingForward = true

  @MainActor private final class PreparationTarget: NSObject {
    weak var layout: BlockLayout?
    init(_ layout: BlockLayout) { self.layout = layout }
    @objc func tick(_ link: CADisplayLink) {
      guard let layout else { link.invalidate(); return }
      guard layout.scrollView?.window != nil else { layout.cancelPreparation(); return }
      if layout.preparedTable?.block.prepareNextCell() != false {
        link.invalidate()
        layout.preparationLink = nil
      }
    }
  }

  private func cancelPreparation() {
    preparationLink?.invalidate()
    preparationLink = nil
    preparedTable = nil
  }

  private func prepareUpcomingTable(_ shown: Range<Int>, in scrollView: UIScrollView) {
    guard let window = scrollView.window else { cancelPreparation(); return }
    let top = visibleTop
    if top != previousTop { scrollingForward = top > previousTop }
    previousTop = top
    let first = blockIndex(atY: top - 3 * scrollView.bounds.height)
    let last = blockIndex(atY: top + 4 * scrollView.bounds.height)
    let candidates = scrollingForward
      ? Array(shown.upperBound..<max(shown.upperBound, last + 1))
      : Array(first..<max(first, shown.lowerBound)).reversed().map { $0 }
    let next = candidates.first { index in
      guard laidOut[index] == nil else { return false }
      if case .table = document.kind(ofBlock: index) { return true }
      return false
    }
    guard let next else { cancelPreparation(); return }
    if preparedTable?.index == next { return }
    cancelPreparation()
    preparedTable = (next, makeTable(next, incrementally: true))
    let link = CADisplayLink(target: PreparationTarget(self), selector: #selector(PreparationTarget.tick(_:)))
    let rate = Float(window.screen.maximumFramesPerSecond)
    link.preferredFrameRateRange = CAFrameRateRange(minimum: min(60, rate), maximum: rate, preferred: rate)
    preparationLink = link
    link.add(to: .main, forMode: .common)
  }

  private func makeTable(_ index: Int, incrementally: Bool) -> TableBlock {
    TableBlock(
      text: text(ofBlock: index), kind: document.kind(ofBlock: index), width: width,
      style: typesetting.typography.table, selectedOutline: typesetting.typography.rule.selected,
      textMeasurements: tableTextMeasurements, prepareIncrementally: incrementally
    ) { [weak self] in self?.onScrollSideways?() }
  }
  /// Called when a block has scrolled sideways within itself, moving the
  /// text in it.
  var embeddedContent: ((String, JSONValue) -> EmbeddedContentView?)?

  var mediaImageLoader: MediaImageLoader?
  var onScrollSideways: (() -> Void)?

  /// Blocks laid out beyond those on screen, kept for geometry and scrolling
  /// back, before the farthest are let go.
  private static let keptBlocks = 120

  init(storage: NSTextStorage, document: DocumentText, typesetting: Typesetting) {
    self.storage = storage
    self.document = document
    self.typesetting = typesetting
    tableTextMeasurements = TableView.TextMeasurements(typesetting.typography.table)
  }

  /// A block of its own is a view; only a node inside a line of text stands
  /// in the text, as a placeholder the size of a word.
  nonisolated static func standIn(_ node: JSONValue, isBlock: Bool) -> [NSAttributedString.Key: Any]? {
    guard !isBlock, InlinePlaceholder.isEmbedded(node) else { return nil }
    if let media = MediaPayload(node) { return [.attachment: MediaAttachment(media)] }
    let type = node["type"]?.stringValue ?? ""
    return [.attachment: InlinePlaceholder.attachment(type: type)]
  }

  // MARK: Edits

  /// Shows an edit of the text. `body` makes it and says which blocks it
  /// replaced, or nil when it can't say.
  func edit(_ body: () -> [DocumentText.Splice]?) {
    cancelPreparation()
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
    cancelPreparation()
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
    case .embedded:
      if let node = document.payload(ofBlock: index), let media = MediaPayload(node) { return MediaView.height(media, width: width) }
      return PlaceholderView.height
    case .table(let table):
      let style = typesetting.typography.table
      return CGFloat(table.rows.count) * (typesetting.lineHeight(block) + 2 * style.paddingY + style.border) + style.border
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
    let isNote = document.type(ofBlock: index) == "footnote-definition"
    let nextIsNote = index + 1 < document.blockCount && document.type(ofBlock: index + 1) == "footnote-definition"
    let em = typesetting.fontSize(.other)
    if nextIsNote && !isNote { return em * WebFootnoteStyle.definitionFontScale * WebFootnoteStyle.sectionMargin }
    if isNote { return nextIsNote || index + 1 == document.blockCount ? em * WebFootnoteStyle.definitionFontScale * WebFootnoteStyle.definitionAfter : em * WebFootnoteStyle.followingMargin }
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
    if let preparedTable, preparedTable.index == index {
      preparedTable.block.finishPreparation()
      let block = preparedTable.block
      cancelPreparation()
      laidOut[index] = block
      showTableSelection(in: block, at: index)
      showSelectedCharacters(in: block, at: index)
      measure(index, block)
      return block
    }
    let kind = document.kind(ofBlock: index)
    let text = text(ofBlock: index)
    let block: any LaidOutBlock =
      switch kind {
      case .text: TextBlock(text: text, width: width, selectedOutline: typesetting.typography.rule.selected)
      case .table: makeTable(index, incrementally: false)
      case .embedded where styled(index) == .rule:
        RuleBlock(
          rule: typesetting.typography.rule, caretHeight: UIFont.preferredFont(forTextStyle: .body).lineHeight, width: width)
      case .embedded(let type):
        if let embedded = document.embeddedNode(at: index), let view = embeddedContent?(embedded.key, embedded.node) {
          ContentBlock(view: view, node: embedded.node, type: type, width: width)
        } else { EmbedBlock(type: type, payload: document.payload(ofBlock: index), width: width, style: { [typesetting] in typesetting.attributes(StyledBlock($0), $1) }, imageLoader: mediaImageLoader) }
      }
    laidOut[index] = block
    (block as? TextBlock)?.onGeometryChange = { [weak self, weak blockView = block.view] in
      guard let self, let blockView, let current = self.laidOut[index], current.view === blockView else { return }
      self.measure(index, current)
      if let scrollView = self.scrollView { self.layoutViewport(of: scrollView) }
    }
    (block as? TableBlock)?.onGeometryChange = { [weak self, weak blockView = block.view] in
      guard let self, let blockView, let current = self.laidOut[index], current.view === blockView else { return }
      self.measure(index, current)
      if let scrollView = self.scrollView { self.layoutViewport(of: scrollView) }
    }
    (block as? EmbedBlock)?.onGeometryChange = { [weak self, weak blockView = block.view] in
      guard let self, let blockView, let current = self.laidOut[index], current.view === blockView else { return }
      self.measure(index, current)
      if let scrollView = self.scrollView { self.layoutViewport(of: scrollView) }
    }
    showTableSelection(in: block, at: index)
    showRuleSelection(in: block, at: index)
    showSelectedCharacters(in: block, at: index)
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
      cancelPreparation()
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
    prepareUpcomingTable(shown, in: scrollView)
    for index in shown {
      let block = block(index)
      let frame = CGRect(x: 0, y: top(index), width: width, height: heights[index])
      if block.view.frame != frame { block.view.frame = frame }
      if block.view.superview !== surface {
        // Touches go to the surface, whose text interaction places the caret.
        block.view.isUserInteractionEnabled = block is ContentBlock || block is EmbedBlock
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

  /// The cells of the table block a table selection has, drawn as the web
  /// draws them.
  var tableSelection: (block: Int, cells: Set<TableView.CellIndex>)? {
    didSet {
      for (index, block) in laidOut { showTableSelection(in: block, at: index) }
    }
  }

  private func showTableSelection(in block: any LaidOutBlock, at index: Int) {
    guard let table = block as? TableBlock else { return }
    table.selectedCells = tableSelection?.block == index ? tableSelection?.cells ?? [] : []
  }

  /// The rule blocks selected whole, outlined as the web outlines them.
  var selectedRules: Set<Int> = [] {
    didSet {
      guard selectedRules != oldValue else { return }
      for (index, block) in laidOut { showRuleSelection(in: block, at: index) }
    }
  }

  private func showRuleSelection(in block: any LaidOutBlock, at index: Int) {
    (block as? RuleBlock)?.isSelected = selectedRules.contains(index)
  }

  /// Where nodes selected whole stand in a line of text, outlined as the web
  /// outlines a selected rule.
  var selectedCharacters: Set<Int> = [] {
    didSet {
      guard selectedCharacters != oldValue else { return }
      for (index, block) in laidOut { showSelectedCharacters(in: block, at: index) }
    }
  }

  private func showSelectedCharacters(in block: any LaidOutBlock, at index: Int) {
    let range = document.range(ofBlock: index)
    let offsets = selectedCharacters.filter { NSLocationInRange($0, range) }.map { $0 - range.location }
    (block as? TextBlock)?.selectedCharacters = offsets
    (block as? TableBlock)?.selectedCharacters = offsets
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

  func writingDirection(at offset: Int) -> NSWritingDirection {
    guard document.blockCount > 0 else { return .leftToRight }
    let (_, block, _, local) = locate(offset)
    return block.writingDirection(at: local)
  }

  func lineBoundary(at offset: Int, backward: Bool) -> Int? {
    guard document.blockCount > 0 else { return nil }
    let (_, block, start, local) = locate(offset)
    return start + block.lineBoundary(at: local, backward: backward)
  }

  func footnoteBacklink(at point: CGPoint) -> String? {
    guard document.blockCount > 0 else { return nil }
    let index = blockIndex(atY: point.y)
    return block(index).footnoteBacklink(at: CGPoint(x: point.x, y: point.y - top(index)))
  }

  /// The path of the checklist item whose box a tap at `point` toggles.
  func checklistItem(at point: CGPoint) -> [Int]? {
    guard document.blockCount > 0 else { return nil }
    let index = blockIndex(atY: point.y)
    return block(index).checklistItem(at: CGPoint(x: point.x, y: point.y - top(index))).map { [index] + $0.path }
  }

  /// Whether `offset` is on the first line of its table cell, going up, or
  /// on the last, going down. Outside a table it isn't.
  func isAtCellEdge(_ offset: Int, _ direction: NSTextSelectionNavigation.Direction) -> Bool {
    guard document.blockCount > 0 else { return false }
    let (_, block, _, local) = locate(offset)
    return (block as? TableBlock)?.isAtCellEdge(local, direction) ?? false
  }

  /// A caret at the root before the block at `index`, where a table is
  /// beside it: under the table before it, else over the one after it. It
  /// lies flat, as the block cursor of Lexical's playground does, since the
  /// document's theme gives it none (`blockCursor`); nil beside no table.
  func caret(beforeBlock index: Int) -> CGRect? {
    let isTable = { (index: Int) in
      guard (0..<self.document.blockCount).contains(index), case .table = self.document.kind(ofBlock: index) else {
        return false
      }
      return true
    }
    let gap = index > 0 ? spaceAfter(index - 1) : 0
    let y: CGFloat
    if isTable(index - 1) {
      y = top(index - 1) + block(index - 1).height + gap / 2 - Self.flatCaretHeight / 2
    } else if isTable(index) {
      y = top(index) - gap / 2 - Self.flatCaretHeight / 2
    } else {
      return nil
    }
    return CGRect(x: 0, y: y, width: Self.flatCaretWidth, height: Self.flatCaretHeight)
  }

  /// The web draws no caret beside a table or rule, so this is the
  /// playground's block cursor, 20px wide and a caret thick.
  private static let flatCaretWidth: CGFloat = 20
  private static let flatCaretHeight: CGFloat = 2
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
  func writingDirection(at offset: Int) -> NSWritingDirection
  /// Scrolls within the block, where it can, to show `offset`.
  func reveal(_ offset: Int)
  func footnoteBacklink(at point: CGPoint) -> String?
  func checklistItem(at point: CGPoint) -> DocumentText.ListItem?
}

extension LaidOutBlock {
  func writingDirection(at offset: Int) -> NSWritingDirection { .leftToRight }
  func reveal(_ offset: Int) {}
  func footnoteBacklink(at point: CGPoint) -> String? { nil }
  func checklistItem(at point: CGPoint) -> DocumentText.ListItem? { nil }
}

private final class TextBlock: LaidOutBlock {
  private let box: TextBox
  private let drawing = BoxView()
  var onGeometryChange: (() -> Void)?
  private let selectedOutline: DocumentTypography.Outline
  private var outlines: [OutlineView] = []

  init(text: NSAttributedString, width: CGFloat, selectedOutline: DocumentTypography.Outline) {
    box = TextBox(text, width: width)
    self.selectedOutline = selectedOutline
    drawing.box = box
    box.onRedraw = { [weak self] in self?.drawing.setNeedsDisplay(); self?.onGeometryChange?() }
    drawing.border = Self.border(text)
  }

  /// The offsets of the attachments to outline.
  var selectedCharacters: [Int] = [] {
    didSet { placeOutlines() }
  }

  private func placeOutlines() {
    let frames = selectedCharacters.sorted().compactMap(box.attachmentFrame)
    while outlines.count < frames.count {
      let outline = OutlineView(selectedOutline)
      drawing.addSubview(outline)
      outlines.append(outline)
    }
    while outlines.count > frames.count { outlines.removeLast().removeFromSuperview() }
    for (outline, frame) in zip(outlines, frames) { outline.surround(frame) }
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
    placeOutlines()
  }

  private static func border(_ text: NSAttributedString) -> LeadingBorder? {
    text.length > 0 ? text.attribute(.leadingBorder, at: 0, effectiveRange: nil) as? LeadingBorder : nil
  }

  func redraw() {
    drawing.setNeedsDisplay()
    for outline in outlines { outline.redraw() }
  }

  func segments(_ range: NSRange) -> [CGRect] { box.segments(range) }
  func offset(closestTo point: CGPoint) -> Int { box.offset(closestTo: point) }
  func offset(movingVerticallyFrom offset: Int, _ direction: NSTextSelectionNavigation.Direction, x: CGFloat) -> Int? {
    box.offset(movingVerticallyFrom: offset, direction, x: x)
  }
  func writingDirection(at offset: Int) -> NSWritingDirection { box.writingDirection(at: offset) }
  func lineBoundary(at offset: Int, backward: Bool) -> Int { box.lineBoundary(at: offset, backward: backward) }
  func footnoteBacklink(at point: CGPoint) -> String? { box.footnoteBacklink(at: point) }
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
  var onGeometryChange: (() -> Void)? { didSet { table.onGeometryChange = onGeometryChange } }

  init(
    text: NSAttributedString, kind: DocumentText.BlockKind, width: CGFloat, style: DocumentTypography.Table,
    selectedOutline: DocumentTypography.Outline, textMeasurements: TableView.TextMeasurements, prepareIncrementally: Bool = false, onScroll: @escaping () -> Void
  ) {
    self.kind = kind
    table = TableView(
      cells: Self.cells(text, kind), columnWidths: Self.table(kind)?.columnWidths, width: width, style: style,
      selectedOutline: selectedOutline, textMeasurements: textMeasurements, prepareIncrementally: prepareIncrementally)
    table.onScroll = onScroll
    holder = TableHolder(table)
  }

  func prepareNextCell() -> Bool { table.prepareNextCell() }
  func finishPreparation() { table.finishPreparation() }

  private static func table(_ kind: DocumentText.BlockKind) -> DocumentText.Table? {
    if case .table(let table) = kind { table } else { nil }
  }

  private var rows: [[DocumentText.Table.Cell]] { Self.table(kind)?.rows ?? [] }

  private static func cells(_ text: NSAttributedString, _ kind: DocumentText.BlockKind) -> [[TableView.Cell]] {
    (table(kind)?.rows ?? []).map { row in
      row.map { cell in
        let range = NSRange(location: cell.range.location, length: min(cell.range.length + 1, text.length - cell.range.location))
        return TableView.Cell(
          text: text.attributedSubstring(from: range), colSpan: cell.colSpan, rowSpan: cell.rowSpan,
          isHeader: cell.isHeader, background: cell.backgroundColor.flatMap(CSSColor.init).map { UIColor(css: $0) },
          width: cell.width.map { CGFloat($0) }, verticalAlign: cell.verticalAlign)
      }
    }
  }

  var view: UIView { holder }
  var height: CGFloat { table.height }
  func canShow(_ kind: DocumentText.BlockKind) -> Bool { if case .table = kind { true } else { false } }

  func set(text: NSAttributedString, kind: DocumentText.BlockKind, width: CGFloat) {
    self.kind = kind
    table.set(cells: Self.cells(text, kind), columnWidths: Self.table(kind)?.columnWidths, width: width)
    showSelectedCharacters()
  }

  func redraw() { table.redraw() }

  var selectedCells: Set<TableView.CellIndex> {
    get { table.selectedCells }
    set { table.selectedCells = newValue }
  }

  /// The offsets of the attachments to outline.
  var selectedCharacters: [Int] = [] {
    didSet { showSelectedCharacters() }
  }

  private func showSelectedCharacters() {
    var inCells: [TableView.CellIndex: [Int]] = [:]
    for offset in selectedCharacters {
      guard let (cell, local) = cell(at: offset) else { continue }
      inCells[cell, default: []].append(local)
    }
    table.selectedCharacters = inCells
  }

  /// The cell `offset` is in, the end of each cell included in it, and the
  /// offset in its text.
  private func cell(at offset: Int) -> (cell: TableView.CellIndex, local: Int)? {
    for (row, cells) in rows.enumerated() {
      for (index, cell) in cells.enumerated() where offset <= NSMaxRange(cell.range) {
        return (TableView.CellIndex(row: row, index: index), offset - cell.range.location)
      }
    }
    guard let row = rows.lastIndex(where: { !$0.isEmpty }), let last = rows[row].last else { return nil }
    return (TableView.CellIndex(row: row, index: rows[row].count - 1), offset - last.range.location)
  }

  private func range(of cell: TableView.CellIndex) -> NSRange { rows[cell.row][cell.index].range }

  func segments(_ range: NSRange) -> [CGRect] {
    var frames: [CGRect] = []
    let caretCell = range.length == 0 ? cell(at: range.location)?.cell : nil
    for (row, cells) in rows.enumerated() {
      for (index, cell) in cells.enumerated() {
        let start = max(range.location, cell.range.location)
        let end = min(NSMaxRange(range), NSMaxRange(cell.range))
        let at = TableView.CellIndex(row: row, index: index)
        guard start < end || caretCell == at else { continue }
        let local = NSRange(location: start - cell.range.location, length: max(end - start, 0))
        frames += table.segments(local, in: at)
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
    guard let (cell, _) = cell(at: offset) else { return }
    table.scrollToShow(cell)
  }

  func offset(closestTo point: CGPoint) -> Int {
    guard let (cell, local) = table.offset(closestTo: point) else { return 0 }
    return range(of: cell).location + local
  }

  /// Up and down move through a cell's lines, then to the cell above or
  /// below, then out of the table.
  func offset(movingVerticallyFrom offset: Int, _ direction: NSTextSelectionNavigation.Direction, x: CGFloat) -> Int? {
    guard let (cell, local) = cell(at: offset),
      let (moved, movedLocal) = table.offset(movingVerticallyFrom: local, in: cell, direction, x: x)
    else { return nil }
    return range(of: moved).location + movedLocal
  }

  func writingDirection(at offset: Int) -> NSWritingDirection {
    guard let (cell, local) = cell(at: offset) else { return .leftToRight }
    return table.writingDirection(at: local, in: cell)
  }

  func isAtCellEdge(_ offset: Int, _ direction: NSTextSelectionNavigation.Direction) -> Bool {
    guard let (cell, local) = cell(at: offset) else { return false }
    return table.isOnEdgeLine(local, of: cell, direction)
  }

  func lineBoundary(at offset: Int, backward: Bool) -> Int {
    guard let (cell, local) = cell(at: offset) else { return offset }
    return range(of: cell).location + table.lineBoundary(at: local, in: cell, backward: backward)
  }
}

/// An embedded node, the caret before it or after it.
private final class ContentBlock: LaidOutBlock {
  private let container = UIView()
  private let content: EmbeddedContentView
  private let type: String
  private var size: CGSize = .zero
  init(view: EmbeddedContentView, node: JSONValue, type: String, width: CGFloat) {
    content = view
    self.type = type
    container.addSubview(view)
    content.show(node)
    fit(width)
  }
  private func fit(_ width: CGFloat) {
    size = content.contentSize(fitting: width)
    content.frame = CGRect(x: max((width - size.width) / 2, 0), y: 0, width: size.width, height: size.height)
  }
  var view: UIView { container }
  var kind: DocumentText.BlockKind { .embedded(type: type) }
  var height: CGFloat { size.height }
  func canShow(_ kind: DocumentText.BlockKind) -> Bool { false }
  func set(text: NSAttributedString, kind: DocumentText.BlockKind, width: CGFloat) { fit(width) }
  func redraw() { content.setNeedsDisplay() }
  func segments(_ range: NSRange) -> [CGRect] {
    if range.length > 0 { return range.location == 0 ? [content.frame] : [] }
    return [CGRect(x: range.location == 0 ? content.frame.minX : content.frame.maxX, y: 0, width: 0, height: size.height)]
  }
  func offset(closestTo point: CGPoint) -> Int { point.x < content.frame.midX ? 0 : 1 }
  func offset(movingVerticallyFrom offset: Int, _ direction: NSTextSelectionNavigation.Direction, x: CGFloat) -> Int? { nil }
  func lineBoundary(at offset: Int, backward: Bool) -> Int { backward ? 0 : 1 }
}

private final class EmbedBlock: LaidOutBlock {

  private let container = UIView()
  private let placeholder: UIView
  private let media: MediaPayload?
  private let type: String
  var onGeometryChange: (() -> Void)?

  init(type: String, payload: JSONValue?, width: CGFloat, style: @escaping DocumentText.Style, imageLoader: MediaImageLoader?) {
    self.type = type
    media = payload.flatMap(MediaPayload.init)
    if let media { placeholder = MediaView(media, style: style, imageLoader: imageLoader) }
    else if type == "poll", let payload { placeholder = NativePollView(payload) }
    else { placeholder = PlaceholderView(type: type) }
    container.addSubview(placeholder)
    (placeholder as? MediaView)?.onGeometryChange = { [weak self] in
      guard let self, let mediaView = self.placeholder as? MediaView else { return }
      self.placeholder.frame.size.height = mediaView.fittingHeight(self.placeholder.frame.width)
      self.onGeometryChange?()
    }
    placeholder.frame = CGRect(x: 0, y: 0, width: width, height: fittingHeight(width))
  }

  var view: UIView { container }
  var kind: DocumentText.BlockKind { .embedded(type: type) }
  var height: CGFloat { placeholder.frame.height }
  func canShow(_ kind: DocumentText.BlockKind) -> Bool { media == nil && type != "poll" && kind == self.kind }

  private func fittingHeight(_ width: CGFloat) -> CGFloat {
    if let media = placeholder as? MediaView { return media.fittingHeight(width) }
    if let embedded = placeholder as? EmbeddedContentView { return embedded.contentSize(fitting: width).height }
    return PlaceholderView.height
  }

  func set(text: NSAttributedString, kind: DocumentText.BlockKind, width: CGFloat) {
    placeholder.frame = CGRect(x: 0, y: 0, width: width, height: fittingHeight(width))
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
/// text, outlined where it's selected.
private final class RuleBlock: LaidOutBlock {
  private let container = UIView()
  private let line = UIView()
  private let outline: OutlineView
  private let caretHeight: CGFloat

  init(rule: DocumentTypography.Rule, caretHeight: CGFloat, width: CGFloat) {
    self.caretHeight = caretHeight
    outline = OutlineView(rule.selected)
    line.backgroundColor = rule.color.color
    line.frame = CGRect(x: 0, y: 0, width: width, height: rule.width)
    container.addSubview(line)
    outline.isHidden = true
    container.addSubview(outline)
    outline.surround(line.frame)
  }

  var isSelected = false {
    didSet {
      outline.isHidden = !isSelected
      redraw()
    }
  }

  var view: UIView { container }
  var kind: DocumentText.BlockKind { .embedded(type: StyledBlock.ruleType) }
  var height: CGFloat { line.frame.height }
  func canShow(_ kind: DocumentText.BlockKind) -> Bool { kind == self.kind }

  func set(text: NSAttributedString, kind: DocumentText.BlockKind, width: CGFloat) {
    line.frame.size.width = width
    outline.surround(line.frame)
  }

  func redraw() { outline.redraw() }

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
/// The web's outline around a node selected whole.
private final class OutlineView: UIView {
  private let outline: DocumentTypography.Outline

  init(_ outline: DocumentTypography.Outline) {
    self.outline = outline
    super.init(frame: .zero)
    isUserInteractionEnabled = false
    layer.borderWidth = outline.width
    redraw()
  }

  required init?(coder: NSCoder) { fatalError("OutlineView is made in code") }

  /// Outlines `frame`, as far out from it as the web's `outline-offset`.
  func surround(_ frame: CGRect) {
    let reach = outline.offset + outline.width
    self.frame = frame.insetBy(dx: -reach, dy: -reach)
  }

  /// A layer's border takes a colour for one appearance.
  func redraw() {
    layer.borderColor = outline.color.color.resolvedColor(with: traitCollection).cgColor
  }
}
#endif
