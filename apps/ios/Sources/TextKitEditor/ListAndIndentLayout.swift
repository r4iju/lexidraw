#if canImport(UIKit)
import EditorModelInterface
import UIKit

/// List items and indented blocks laid out as the web's theme lays them out
/// (`DocumentTypography.List`), in em of the font of the newline ending the
/// line.
///
/// Offsets are into the text that `DocumentText` marked, `.listItem` and
/// `.elementIndent` on the lines they describe.
struct ListAndIndentLayout {
  static let list = DocumentTypography.web.list
  /// Points a level of indent, as Lexical pads an indented block.
  static let indentWidth: CGFloat = 40
  /// Points from a box's left in which a tap toggles its item, as far as the
  /// web's MobileCheckListPlugin reaches.
  static let toggleWidth: CGFloat = 40

  /// A list item's line: where its text starts, and its marker or box.
  struct Item {
    var item: DocumentText.ListItem
    var range: NSRange
    var em: CGFloat
    var font: UIFont

    var textStart: CGFloat {
      item.lists.reduce(0) { $0 + (list.padding + ($1 == .check ? list.checklistPadding : 0)) * em }
    }
    var isChecklistItem: Bool { item.lists.last == .check }

    /// The item's box, from the top of its first line.
    var box: CGRect {
      CGRect(
        x: textStart - list.checklistPadding * em, y: list.box.top * em, width: list.box.size * em,
        height: list.box.size * em)
    }

    /// Where a tap toggles the item, from the top of its first line.
    func toggleArea(height: CGFloat) -> CGRect { CGRect(x: box.minX, y: 0, width: toggleWidth, height: height) }

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
  static func styled(_ text: NSAttributedString) -> (NSAttributedString, ListAndIndentLayout) {
    let styled = NSMutableAttributedString(attributedString: text)
    var layout = ListAndIndentLayout()
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
        layout.items.append(line)
        paragraph.firstLineHeadIndent = line.textStart
        paragraph.headIndent = line.textStart
        if NSMaxRange(enclosing) < string.length { paragraph.paragraphSpacing = Self.list.itemSpacing * font.pointSize }
        if line.isChecklistItem, item.checked {
          styled.addAttributes(
            [.foregroundColor: Self.list.doneColor.color, .strikethroughStyle: NSUnderlineStyle.single.rawValue], range: range)
        }
      } else if let indent {
        // Lexical indents with `padding-inline-start`, which takes the place
        // of a quote's padding and leaves its border.
        let border = (text.attribute(.leadingBorder, at: last, effectiveRange: nil) as? LeadingBorder)?.width ?? 0
        paragraph.firstLineHeadIndent = border + CGFloat(indent) * Self.indentWidth
        paragraph.headIndent = paragraph.firstLineHeadIndent
      }
      styled.addAttribute(.paragraphStyle, value: paragraph, range: enclosing)
    }
    return (styled, layout)
  }
}
#endif
