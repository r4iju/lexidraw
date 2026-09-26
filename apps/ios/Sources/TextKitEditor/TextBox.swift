#if canImport(UIKit)
import UIKit

/// Text laid out whole by TextKit 2 at a width, for a block or a table cell.
/// Offsets are into the text; geometry is from the box's top left. The text
/// keeps the newline that follows it in the document, so an empty block
/// still has a line to put the caret on.
@MainActor final class TextBox {
  private let storage = NSTextStorage()
  private let contentStorage = NSTextContentStorage()
  private let layoutManager = NSTextLayoutManager()
  private let container = NSTextContainer(size: .zero)
  private(set) var height: CGFloat = 0
  /// The lines as laid out, the extra one TextKit adds after a final newline
  /// left out.
  private var lines: [Line] = []

  private struct Line {
    var frame: CGRect
    var range: NSRange
  }

  /// `text` must end with the newline that follows it in the document.
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
    contentStorage.performEditingTransaction { storage.setAttributedString(text) }
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
        self.lines.append(Line(frame: line.typographicBounds.offsetBy(dx: origin.x, dy: origin.y), range: range))
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
      fragment.draw(at: CGPoint(x: origin.x + frame.minX, y: origin.y + frame.minY), in: context)
      return true
    }
  }

  func segments(_ range: NSRange) -> [CGRect] {
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
  func offset(movingVerticallyFrom offset: Int, up: Bool, x: CGFloat) -> Int? {
    guard let current = lines.lastIndex(where: { $0.range.location <= offset }) else { return nil }
    let target = up ? current - 1 : current + 1
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
