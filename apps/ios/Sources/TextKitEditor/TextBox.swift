#if canImport(UIKit)
import UIKit

/// Text laid out whole by TextKit 2 at a width, for a block or a table cell.
/// Offsets are into the text; geometry is from the box's top left. The text
/// keeps the newline that follows it in the document, so an empty block
/// still has a line to put the caret on. List items and indented blocks
/// are laid out and drawn as their lines say (`ListAndIndentLayout`).
@MainActor final class TextBox {
  private let storage = NSTextStorage()
  private let contentStorage = NSTextContentStorage()
  private let layoutManager = WebLinkLayoutManager()
  private let container = NSTextContainer(size: .zero)
  private(set) var height: CGFloat = 0
  var onRedraw: (() -> Void)?
  /// The lines as laid out, the extra one TextKit adds after a final newline
  /// left out.
  private var lines: [Line] = []
  private var listLayout = ListAndIndentLayout()

  private struct Line {
    var frame: CGRect
    var range: NSRange
    var inset: CGFloat
    /// Where the line's text sits as drawn, raised as `placement` says.
    var baseline: CGFloat
  }

  init(_ text: NSAttributedString, width: CGFloat) {
    contentStorage.textStorage = storage
    contentStorage.addTextLayoutManager(layoutManager)
    container.lineFragmentPadding = 0
    container.size = CGSize(width: width, height: 0)
    layoutManager.textContainer = container
    set(text)
  }

  var width: CGFloat { container.size.width }

  func writingDirection(at offset: Int) -> NSWritingDirection {
    guard let location = location(offset) else { return .leftToRight }
    return layoutManager.baseWritingDirection(at: location) == .rightToLeft ? .rightToLeft : .leftToRight
  }

  /// The space after the last paragraph, which `height` counts and a table
  /// cell leaves out, as the web leaves out its last paragraph's margin.
  var trailingSpacing: CGFloat {
    guard storage.length > 0 else { return 0 }
    let style = storage.attribute(.paragraphStyle, at: storage.length - 1, effectiveRange: nil) as? NSParagraphStyle
    return style?.paragraphSpacing ?? 0
  }

  /// The text's length, without the final newline.
  var length: Int { max(storage.length - 1, 0) }

  func set(_ text: NSAttributedString) {
    let (styled, listLayout) = ListAndIndentLayout.styled(text)
    self.listLayout = listLayout
    contentStorage.performEditingTransaction { storage.setAttributedString(styled) }
    measure()
    storage.enumerateAttribute(.attachment, in: NSRange(location: 0, length: storage.length)) { value, _, _ in
      (value as? any LazyTextAttachment)?.load { [weak self] in
        guard let self else { return }
        let text = NSAttributedString(attributedString: self.storage)
        self.set(text)
        self.onRedraw?()
      }
    }
  }

  func set(width: CGFloat) {
    guard width != container.size.width else { return }
    container.size = CGSize(width: width, height: 0)
    measure()
  }

  private func measure() {
    lines = []
    layoutManager.enumerateTextLayoutFragments(from: layoutManager.documentRange.location, options: [.ensuresLayout]) {
      fragment in
      let origin = fragment.layoutFragmentFrame.origin
      let start = self.offset(fragment.rangeInElement.location)
      for line in fragment.textLineFragments {
        let range = NSRange(location: start + line.characterRange.location, length: line.characterRange.length)
        guard range.length > 0 || self.lines.isEmpty else { continue }
        let placement = self.placement(of: line, at: start)
        self.lines.append(
          Line(
            frame: line.typographicBounds.offsetBy(dx: origin.x, dy: origin.y), range: range,
            inset: placement.inset,
            baseline: origin.y + line.typographicBounds.minY + line.glyphOrigin.y - placement.raise))
      }
      return true
    }
    var bottom: CGFloat = 0
    layoutManager.enumerateTextLayoutFragments(from: layoutManager.documentRange.endLocation, options: [.reverse]) {
      fragment in
      // The last paragraph's frame counts the extra line after its newline.
      let lines = fragment.textLineFragments
      let extra = lines.count > 1 && lines.last?.characterRange.length == 0 ? lines.last?.typographicBounds.height : nil
      bottom = fragment.layoutFragmentFrame.maxY - (extra ?? 0)
      return false
    }
    height = ceil(bottom)
  }

  func draw(at origin: CGPoint, in context: CGContext) {
    layoutManager.enumerateTextLayoutFragments(from: layoutManager.documentRange.location, options: []) { fragment in
      let frame = fragment.layoutFragmentFrame
      let start = self.offset(fragment.rangeInElement.location)
      for line in fragment.textLineFragments {
        let at = line.typographicBounds.origin
        let raise = self.placement(of: line, at: start).raise
        let lineOrigin = CGPoint(x: origin.x + frame.minX + at.x, y: origin.y + frame.minY + at.y - raise)
        line.draw(at: lineOrigin, in: context)
        if let em = self.blockFont(at: start)?.pointSize {
          self.drawLinkUnderlines(line, at: lineOrigin, em: em, in: context)
        }
      }
      return true
    }
    for item in listLayout.items {
      guard let line = lines.first(where: { $0.range.location >= item.range.location }) else { continue }
      if item.isChecklistItem {
        drawBox(item, at: CGPoint(x: origin.x, y: origin.y + line.frame.minY), in: context)
      } else if let marker = item.marker {
        let text = NSAttributedString(
          string: marker, attributes: [.font: item.font, .foregroundColor: ListAndIndentLayout.list.markerColor.color])
        let size = text.size()
        let markerX = writingDirection(at: item.range.location) == .rightToLeft
          ? width - item.textStart : item.textStart - size.width
        text.draw(at: CGPoint(x: origin.x + markerX, y: origin.y + line.baseline - item.font.ascender))
      }
    }
  }

  /// Each link's underline in `line`, drawn from `origin`, as a browser
  /// draws document.css's: it skips ink, broken a thickness either side of
  /// where the link's own glyphs cross it.
  private func drawLinkUnderlines(_ line: NSTextLineFragment, at origin: CGPoint, em: CGFloat, in context: CGContext) {
    let theme = WebLinkLayoutManager.link
    let scale = UITraitCollection.current.displayScale
    let baseline = origin.y + line.glyphOrigin.y
    let top = ((baseline + theme.underlineOffset * em) * scale).rounded() / scale
    let thickness = theme.underlineThickness
    let text = line.attributedString
    var typeset: CTLine?
    text.enumerateAttribute(.link, in: line.characterRange) { link, range, _ in
      guard link != nil else { return }
      let from = origin.x + line.locationForCharacter(at: range.location).x
      let to = origin.x + line.locationForCharacter(at: NSMaxRange(range)).x
      let band = CGRect(x: from, y: top, width: to - from, height: thickness)
      let laidOut = typeset ?? CTLineCreateWithAttributedString(text.attributedSubstring(from: line.characterRange))
      typeset = laidOut
      let linkRange = NSRange(location: range.location - line.characterRange.location, length: range.length)
      let dx = from - CTLineGetOffsetForStringIndex(laidOut, linkRange.location, nil)
      let gaps = Self.inkCrossings(laidOut, in: linkRange, at: CGPoint(x: dx, y: baseline), band: band)
        .map { ($0.lowerBound - thickness)...($0.upperBound + thickness) }
        .sorted { $0.lowerBound < $1.lowerBound }
      var segments: [CGRect] = []
      var start = from
      for gap in gaps {
        if gap.lowerBound > start {
          segments.append(CGRect(x: start, y: top, width: gap.lowerBound - start, height: thickness))
        }
        start = max(start, gap.upperBound)
      }
      if to > start { segments.append(CGRect(x: start, y: top, width: to - start, height: thickness)) }
      context.setFillColor(theme.color.color.withAlphaComponent(theme.underlineOpacity).cgColor)
      context.fill(segments)
    }
  }

  /// The spans across which the outlines of `line`'s glyphs for `range`
  /// cross `band`, `line` set with its origin at `origin`.
  private static func inkCrossings(_ line: CTLine, in range: NSRange, at origin: CGPoint, band: CGRect)
    -> [ClosedRange<CGFloat>]
  {
    let bandPath = CGPath(rect: band, transform: nil)
    var crossings: [ClosedRange<CGFloat>] = []
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
      let count = CTRunGetGlyphCount(run)
      let attributes = CTRunGetAttributes(run) as NSDictionary
      guard count > 0, let font = attributes[kCTFontAttributeName] else { continue }
      var glyphs = [CGGlyph](repeating: 0, count: count)
      var positions = [CGPoint](repeating: .zero, count: count)
      var indices = [CFIndex](repeating: 0, count: count)
      CTRunGetGlyphs(run, CFRange(), &glyphs)
      CTRunGetPositions(run, CFRange(), &positions)
      CTRunGetStringIndices(run, CFRange(), &indices)
      for index in 0..<count where NSLocationInRange(indices[index], range) {
        let position = positions[index]
        var placed = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: origin.x + position.x, ty: origin.y - position.y)
        guard let outline = CTFontCreatePathForGlyph(font as! CTFont, glyphs[index], &placed) else { continue }
        let crossing = outline.intersection(bandPath).boundingBoxOfPath
        if !crossing.isNull, crossing.width > 0 { crossings.append(crossing.minX...crossing.maxX) }
      }
    }
    return crossings
  }

  /// A checklist item's box as the web's theme draws it: outlined, or when
  /// checked filled and ticked.
  private func drawBox(_ item: ListAndIndentLayout.Item, at origin: CGPoint, in context: CGContext) {
    let theme = ListAndIndentLayout.list.box
    let rtl = writingDirection(at: item.range.location) == .rightToLeft
    var box = item.box
    if rtl { box.origin.x = width - box.maxX }
    box = box.offsetBy(dx: origin.x, dy: origin.y)
    let border = theme.borderWidth
    let outline = UIBezierPath(roundedRect: box.insetBy(dx: border / 2, dy: border / 2), cornerRadius: theme.cornerRadius)
    outline.lineWidth = border
    if item.item.checked {
      theme.checkedColor.color.setFill()
      theme.checkedColor.color.setStroke()
      outline.fill()
      outline.stroke()
      let tick = theme.tick
      let bounds = CGRect(
        x: rtl ? box.maxX - (tick.start + tick.width) * item.em : box.minX + tick.start * item.em, y: box.minY + (tick.top - theme.top) * item.em, width: tick.width * item.em,
        height: tick.height * item.em)
      let line = tick.lineWidth
      context.saveGState()
      context.translateBy(x: bounds.midX, y: bounds.midY)
      context.rotate(by: .pi / 4)
      let mark = UIBezierPath()
      mark.move(to: CGPoint(x: bounds.width / 2 - line / 2, y: -bounds.height / 2))
      mark.addLine(to: CGPoint(x: bounds.width / 2 - line / 2, y: bounds.height / 2 - line / 2))
      mark.addLine(to: CGPoint(x: -bounds.width / 2, y: bounds.height / 2 - line / 2))
      mark.lineWidth = line
      tick.color.color.setStroke()
      mark.stroke()
      context.restoreGState()
    } else {
      theme.borderColor.color.setStroke()
      outline.stroke()
    }
  }

  /// The checklist item whose box a tap at `point` toggles.
  func checklistItem(at point: CGPoint) -> DocumentText.ListItem? {
    for item in listLayout.items where item.isChecklistItem {
      let itemLines = lines.filter { NSLocationInRange($0.range.location, item.range) || $0.range.location == item.range.location }
      guard let first = itemLines.first, let last = itemLines.last else { continue }
      var area = item.toggleArea(height: last.frame.maxY - first.frame.minY).offsetBy(dx: 0, dy: first.frame.minY)
      if writingDirection(at: item.range.location) == .rightToLeft { area.origin.x = width - area.maxX }
      if area.contains(point) { return item.item }
    }
    return nil
  }

  /// Where a line of the paragraph at `offset` has its text, as CSS sets
  /// it: the block's own text centred in the line, and other text on its
  /// baseline. TextKit sets text at the foot of a line taller than it, and
  /// higher where smaller text reaches lower, so each line is drawn raised
  /// by `raise`. The block's own text is the paragraph's end's, the newline
  /// DocumentText gives the block's style; `inset` is between it and the
  /// line's top and foot.
  private func placement(of line: NSTextLineFragment, at offset: Int) -> (inset: CGFloat, raise: CGFloat) {
    guard let end = blockEnd(at: offset),
      let style = storage.attribute(.paragraphStyle, at: end, effectiveRange: nil) as? NSParagraphStyle,
      let font = blockFont(at: offset), style.maximumLineHeight > 0
    else { return (0, 0) }
    let inset = max(line.typographicBounds.height - font.lineHeight, 0) / 2
    return (inset, line.glyphOrigin.y - inset - font.ascender)
  }

  /// Where the paragraph at `offset` ends, which has the block's own style.
  private func blockEnd(at offset: Int) -> Int? {
    guard storage.length > 0 else { return nil }
    let paragraph = (storage.string as NSString).paragraphRange(
      for: NSRange(location: min(offset, storage.length - 1), length: 0))
    return max(NSMaxRange(paragraph) - 1, paragraph.location)
  }

  private func blockFont(at offset: Int) -> UIFont? {
    blockEnd(at: offset).flatMap { storage.attribute(.font, at: $0, effectiveRange: nil) as? UIFont }
  }

  /// The space after the last paragraph, which ends the text.
  var spacingAfter: CGFloat {
    guard storage.length > 0 else { return 0 }
    return (storage.attribute(.paragraphStyle, at: storage.length - 1, effectiveRange: nil) as? NSParagraphStyle)?
      .paragraphSpacing ?? 0
  }

  /// A caret or a selection spans the block's own text in each line.
  func segments(_ range: NSRange) -> [CGRect] {
    lineSegments(range).map { frame in
      let inset = lines.last { $0.frame.minY <= frame.midY }?.inset ?? 0
      return frame.insetBy(dx: 0, dy: min(inset, frame.height / 2))
    }
  }

  /// Where the attachment at `offset` is drawn, if there's one there.
  func attachmentFrame(at offset: Int) -> CGRect? {
    guard let location = location(offset), let fragment = layoutManager.textLayoutFragment(for: location) else {
      return nil
    }
    let frame = fragment.frameForTextAttachment(at: location)
    guard !frame.isEmpty else { return nil }
    let start = self.offset(fragment.rangeInElement.location)
    let line = fragment.textLineFragments.first { $0.characterRange.contains(offset - start) }
    let raise = line.map { placement(of: $0, at: start).raise } ?? 0
    return frame.offsetBy(dx: fragment.layoutFragmentFrame.minX, dy: fragment.layoutFragmentFrame.minY - raise)
  }

  private func lineSegments(_ range: NSRange) -> [CGRect] {
    let start = min(max(range.location, 0), length)
    let end = min(max(NSMaxRange(range), start), storage.length)
    guard let from = location(start), let to = location(end), let textRange = NSTextRange(location: from, end: to)
    else { return [] }
    var frames: [CGRect] = []
    layoutManager.enumerateTextSegments(in: textRange, type: .selection, options: .rangeNotRequired) {
      _, frame, _, _ in
      frames.append(frame)
      return true
    }
    return frames
  }

  func offset(closestTo point: CGPoint) -> Int {
    guard
      let selection = layoutManager.textSelectionNavigation.textSelections(
        interactingAt: point, inContainerAt: layoutManager.documentRange.location, anchors: [], modifiers: [],
        selecting: false, bounds: .zero
      ).first,
      let location = selection.textRanges.first?.location
    else { return length }
    return min(offset(location), length)
  }

  /// The offset a line up or down, at `x`, or nil from the first line up or
  /// the last line down.
  func offset(movingVerticallyFrom offset: Int, _ direction: NSTextSelectionNavigation.Direction, x: CGFloat) -> Int? {
    guard let current = lines.lastIndex(where: { $0.range.location <= offset }) else { return nil }
    let target = direction == .up ? current - 1 : current + 1
    guard lines.indices.contains(target) else { return nil }
    let line = lines[target]
    let landed = self.offset(closestTo: CGPoint(x: x, y: line.frame.midY))
    return min(max(landed, line.range.location), line.range.location + line.range.length)
  }

  /// Where the line `offset` is on starts, or where it ends before the
  /// newline or line break ending it.
  func lineBoundary(at offset: Int, backward: Bool) -> Int {
    guard let line = lines.last(where: { $0.range.location <= offset }) else { return offset }
    if backward { return line.range.location }
    let end = NSMaxRange(line.range)
    let last = end > 0 ? (storage.string as NSString).character(at: end - 1) : 0
    return min(last == 0x0A || last == 0x2028 ? end - 1 : end, length)
  }

  private func location(_ offset: Int) -> (any NSTextLocation)? {
    contentStorage.location(contentStorage.documentRange.location, offsetBy: offset)
  }

  private func offset(_ location: any NSTextLocation) -> Int {
    contentStorage.offset(from: contentStorage.documentRange.location, to: location)
  }
}
/// Colours a link as the web does, rather than in the tint colour, and
/// underlines it not at all: `TextBox` draws its underline.
private final class WebLinkLayoutManager: NSTextLayoutManager {
  static let link = DocumentTypography.web.link

  override func renderingAttributes(forLink link: Any, at location: any NSTextLocation) -> [NSAttributedString.Key: Any] {
    [.foregroundColor: Self.link.color.color]
  }
}
#endif
