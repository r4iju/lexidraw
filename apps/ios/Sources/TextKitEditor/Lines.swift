#if canImport(UIKit)
import EditorModelInterface
import UIKit

/// List items and indented blocks as the web's theme shows them
/// (document.css): each list takes its items in 1.625em, past the marker,
/// and a checklist 1.75em more, past the box; items are 0.25em apart; each
/// level of indent is 40pt, as Lexical pads an indented block. Lengths in em
/// are of the font of the newline ending the line.
///
/// Offsets are into the text that `DocumentText` marked, `.listItem` and
/// `.elementIndent` on the lines they describe.
struct Lines {
  /// A list item's line: where its text starts, and its marker or box.
  struct Item {
    var item: DocumentText.ListItem
    var range: NSRange
    var em: CGFloat
    var font: UIFont

    var textStart: CGFloat { item.lists.reduce(0) { $0 + (1.625 + ($1 == .check ? 1.75 : 0)) * em } }
    var isChecklistItem: Bool { item.lists.last == .check }

    /// The item's box, from the top of its first line.
    var box: CGRect { CGRect(x: textStart - 1.75 * em, y: 0.3 * em, width: em, height: em) }

    /// Where a tap toggles the item, across the box and past it as far as
    /// the web's MobileCheckListPlugin reaches, from the top of its first line.
    func toggleArea(height: CGFloat) -> CGRect { CGRect(x: textStart - 1.75 * em, y: 0, width: 40, height: height) }

    /// The marker the web's theme gives an item of a bullet or numbered list
    /// this deep: disc, circle, square and decimal, lower-alpha, lower-roman
    /// by turns, then a space, as a browser writes an outside marker.
    var marker: String? {
      let level = (item.lists.count - 1) % 3
      switch item.lists.last {
      case .bullet: return ["\u{2022}", "\u{25E6}", "\u{25AA}"][level] + " "
      case .number:
        let number = [String(item.value), Self.alphabetic(item.value), Self.roman(item.value)][level]
        return number + ". "
      case .check, nil: return nil
      }
    }

    static func alphabetic(_ value: Int) -> String {
      guard value > 0 else { return String(value) }
      var value = value
      var letters = ""
      while value > 0 {
        value -= 1
        letters = String(UnicodeScalar(UInt8(97 + value % 26))) + letters
        value /= 26
      }
      return letters
    }

    static func roman(_ value: Int) -> String {
      guard (1...3999).contains(value) else { return String(value) }
      let numerals = [
        (1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"),
        (9, "ix"), (5, "v"), (4, "iv"), (1, "i"),
      ]
      var value = value
      var letters = ""
      for (amount, numeral) in numerals {
        while value >= amount {
          letters += numeral
          value -= amount
        }
      }
      return letters
    }
  }

  private(set) var items: [Item] = []

  /// `text` laid out as its lines say, and the items in it.
  static func styled(_ text: NSAttributedString) -> (NSAttributedString, Lines) {
    let styled = NSMutableAttributedString(attributedString: text)
    var lines = Lines()
    let string = text.string as NSString
    string.enumerateSubstrings(in: NSRange(location: 0, length: string.length), options: [.byParagraphs, .substringNotRequired]) {
      _, range, enclosing, _ in
      guard enclosing.length > 0 else { return }
      let last = NSMaxRange(enclosing) - 1
      let item = text.attribute(.listItem, at: last, effectiveRange: nil) as? DocumentText.ListItem
      let indent = text.attribute(.elementIndent, at: last, effectiveRange: nil) as? Int
      guard item != nil || indent != nil else { return }
      let font = text.attribute(.font, at: last, effectiveRange: nil) as? UIFont ?? .preferredFont(forTextStyle: .body)
      let paragraph =
        (text.attribute(.paragraphStyle, at: enclosing.location, effectiveRange: nil) as? NSParagraphStyle)?
        .mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
      if let item {
        let line = Item(item: item, range: range, em: font.pointSize, font: font)
        lines.items.append(line)
        paragraph.firstLineHeadIndent = line.textStart
        paragraph.headIndent = line.textStart
        if NSMaxRange(enclosing) < string.length { paragraph.paragraphSpacing = 0.25 * font.pointSize }
        if line.isChecklistItem, item.checked {
          styled.addAttributes(
            [.foregroundColor: UIColor.secondaryLabel, .strikethroughStyle: NSUnderlineStyle.single.rawValue], range: range)
        }
      } else if let indent {
        paragraph.firstLineHeadIndent = CGFloat(indent) * 40
        paragraph.headIndent = CGFloat(indent) * 40
      }
      styled.addAttribute(.paragraphStyle, value: paragraph, range: enclosing)
    }
    return (styled, lines)
  }
}
#endif
