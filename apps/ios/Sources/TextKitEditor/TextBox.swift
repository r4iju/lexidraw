#if canImport(UIKit)
import UIKit

/// Text laid out whole by TextKit 2 at a width, for a block or a table cell.
/// Offsets are into the text; geometry is from the box's top left. The text
/// keeps the newline that follows it in the document, so an empty block
/// still has a line to put the caret on. List items and indented blocks
/// are laid out and drawn as their lines say (`Lines`).
@MainActor final class TextBox {
  private let storage = NSTextStorage()
  private let contentStorage = NSTextContentStorage()
  private let layoutManager = NSTextLayoutManager()
  private let container = NSTextContainer(size: .zero)
  private(set) var height: CGFloat = 0
  /// The lines as laid out, the extra one TextKit adds after a final newline
  /// left out.
  private var lines: [Line] = []
  private var listLines = Lines()

  private struct Line {
    var frame: CGRect
    var range: NSRange
    var inset: CGFloat
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

  /// The text's length, without the final newline.
  var length: Int { max(storage.length - 1, 0) }

  func set(_ text: NSAttributedString) {
    let (styled, listLines) = Lines.styled(text)
    self.listLines = listLines
    contentStorage.performEditingTransaction { storage.setAttributedString(styled) }
    measure()
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
        self.lines.append(
          Line(
            frame: line.typographicBounds.offsetBy(dx: origin.x, dy: origin.y), range: range,
            inset: self.placement(of: line, at: start).inset,
            baseline: origin.y + line.typographicBounds.minY + line.glyphOrigin.y))
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
        line.draw(at: CGPoint(x: origin.x + frame.minX + at.x, y: origin.y + frame.minY + at.y - raise), in: context)
      }
      return true
    }
    for item in listLines.items {
      guard let line = lines.first(where: { $0.range.location >= item.range.location }) else { continue }
      if item.isChecklistItem {
        drawBox(item, at: CGPoint(x: origin.x, y: origin.y + line.frame.minY), in: context)
      } else if let marker = item.marker {
        let text = NSAttributedString(string: marker, attributes: [.font: item.font, .foregroundColor: UIColor.secondaryLabel])
        let size = text.size()
        text.draw(at: CGPoint(x: origin.x + item.textStart - size.width, y: origin.y + line.baseline - item.font.ascender))
      }
    }
  }

  /// A checklist item's box as the web's theme draws it: outlined, or when
  /// checked filled and ticked.
  private func drawBox(_ item: Lines.Item, at origin: CGPoint, in context: CGContext) {
    let box = item.box.offsetBy(dx: origin.x, dy: origin.y)
    let border: CGFloat = 1.5
    let outline = UIBezierPath(roundedRect: box.insetBy(dx: border / 2, dy: border / 2), cornerRadius: 4)
    outline.lineWidth = border
    if item.item.checked {
      UIColor.tintColor.setFill()
      UIColor.tintColor.setStroke()
      outline.fill()
      outline.stroke()
      // An L 0.3em wide and 0.5em tall, turned 45°, as the theme's ::after.
      let tick = CGRect(x: box.minX + 0.34 * item.em, y: box.minY + 0.15 * item.em, width: 0.3 * item.em, height: 0.5 * item.em)
      context.saveGState()
      context.translateBy(x: tick.midX, y: tick.midY)
      context.rotate(by: .pi / 4)
      let mark = UIBezierPath()
      mark.move(to: CGPoint(x: tick.width / 2 - border / 2, y: -tick.height / 2))
      mark.addLine(to: CGPoint(x: tick.width / 2 - border / 2, y: tick.height / 2 - border / 2))
      mark.addLine(to: CGPoint(x: -tick.width / 2, y: tick.height / 2 - border / 2))
      mark.lineWidth = border
      UIColor.systemBackground.setStroke()
      mark.stroke()
      context.restoreGState()
    } else {
      UIColor.secondaryLabel.setStroke()
      outline.stroke()
    }
  }

  /// The checklist item whose box a tap at `point` toggles.
  func checklistItem(at point: CGPoint) -> DocumentText.ListItem? {
    for item in listLines.items where item.isChecklistItem {
      let itemLines = lines.filter { NSLocationInRange($0.range.location, item.range) || $0.range.location == item.range.location }
      guard let first = itemLines.first, let last = itemLines.last else { continue }
      let area = item.toggleArea(height: last.frame.maxY - first.frame.minY).offsetBy(dx: 0, dy: first.frame.minY)
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
    guard storage.length > 0 else { return (0, 0) }
    let paragraph = (storage.string as NSString).paragraphRange(
      for: NSRange(location: min(offset, storage.length - 1), length: 0))
    let end = max(NSMaxRange(paragraph) - 1, paragraph.location)
    guard let style = storage.attribute(.paragraphStyle, at: end, effectiveRange: nil) as? NSParagraphStyle,
      let font = storage.attribute(.font, at: end, effectiveRange: nil) as? UIFont, style.maximumLineHeight > 0
    else { return (0, 0) }
    let inset = max(line.typographicBounds.height - font.lineHeight, 0) / 2
    return (inset, line.glyphOrigin.y - inset - font.ascender)
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
#endif
