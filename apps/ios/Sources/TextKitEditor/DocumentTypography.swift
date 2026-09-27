import EditorModelInterface
import Foundation

/// A block as the web sets it: one of `BlockType`'s, a rule, or any other,
/// which the web sets in the body text and spaces as every block.
enum StyledBlock: Hashable, Sendable {
  case text(BlockType)
  case rule
  case other

  /// The block `DocumentText` gives `type`.
  init(_ type: String) {
    if let blockType = BlockType(rawValue: type) {
      self = .text(blockType)
    } else {
      self = type == Self.ruleType ? .rule : .other
    }
  }

  /// `HorizontalRuleNode`'s type.
  static let ruleType = "horizontalrule"
}

/// How the web sets a document's blocks (`web`, generated from its
/// stylesheets). Lengths are in ems of the text they apply to, whose size a
/// heading sets and every other block takes from the body text, except
/// widths, which are in points.
struct DocumentTypography: Sendable {
  struct Heading: Sendable {
    var fontSize: Double
    var lineHeight: Double
    /// Or none, for the body text's.
    var letterSpacing: Double?
    var before: Double
    var after: Double
    var color: ThemeColor
  }

  /// Heading sizes, in ems of the body text, in a view no wider than
  /// `width`.
  struct Narrow: Sendable {
    var width: Double
    var headingSizes: [BlockType: Double]
  }

  /// The body text of a document in a language `tags` match as CSS's
  /// `:lang()` does, where it sets any.
  struct Language: Sendable {
    var tags: [String]
    var lineHeight: Double?
    var letterSpacing: Double?
  }

  /// Lists and checklists. Lengths are in ems of an item's text.
  struct List: Sendable {
    /// How far in a list takes its items, past their markers.
    var padding: Double
    /// Between an item and the next, or the list nested after it.
    var itemSpacing: Double
    var markerColor: ThemeColor
    /// How much further a checklist takes its items, past their boxes.
    var checklistPadding: Double
    var box: Box
    /// A checked item's text.
    var doneColor: ThemeColor
  }

  /// A checklist item's box, at the start of its padding.
  struct Box: Sendable {
    /// Below the top of its item.
    var top: Double
    var size: Double
    /// In points, as are the corners.
    var borderWidth: Double
    var borderColor: ThemeColor
    var cornerRadius: Double
    /// What a checked box is filled and outlined with.
    var checkedColor: ThemeColor
    var tick: Tick
  }

  /// A checked box's tick: the right and bottom of a rectangle turned 45°,
  /// from the start of the item's padding and the top of the item.
  struct Tick: Sendable {
    var left: Double
    var top: Double
    var width: Double
    var height: Double
    /// In points.
    var lineWidth: Double
    var color: ThemeColor
  }

  struct Quote: Sendable {
    var borderWidth: Double
    var borderColor: ThemeColor
    var paddingStart: Double
  }

  struct Rule: Sendable {
    var width: Double
    var color: ThemeColor
    /// Before it and after it, in ems of the body text.
    var margin: Double
  }

  /// A link's text, underlined in its colour at this opacity.
  struct Link: Sendable {
    var color: ThemeColor
    var underlineOpacity: Double
  }

  var color: ThemeColor
  var lineHeight: Double
  var letterSpacing: Double
  /// After any block that doesn't set its own.
  var blockAfter: Double
  /// As CSS numbers it, 400 being regular.
  var headingWeight: Int
  var headings: [BlockType: Heading]
  /// A heading right after a heading has this much of its space before.
  var adjacentHeadingBefore: Double
  /// In the stylesheet's order, a later one over an earlier where both
  /// apply.
  var narrow: [Narrow]
  /// Ordered as `narrow` is.
  var languages: [Language]
  var list: List
  var quote: Quote
  var rule: Rule
  var link: Link

  /// As the web sets a document in `language`, a BCP 47 tag.
  func forLanguage(_ language: String?) -> DocumentTypography {
    guard let language = language?.lowercased() else { return self }
    var typography = self
    for rule in languages where rule.tags.contains(where: { language == $0 || language.hasPrefix("\($0)-") }) {
      typography.lineHeight = rule.lineHeight ?? typography.lineHeight
      typography.letterSpacing = rule.letterSpacing ?? typography.letterSpacing
    }
    return typography
  }

  func heading(_ block: StyledBlock) -> Heading? {
    guard case .text(let type) = block else { return nil }
    return headings[type]
  }

  /// The size of the text in `block` in a view `width` wide, in ems of the
  /// body text.
  func fontSize(_ block: StyledBlock, width: Double) -> Double {
    guard case .text(let type) = block else { return 1 }
    return narrow.last { width <= $0.width && $0.headingSizes[type] != nil }?.headingSizes[type]
      ?? headings[type]?.fontSize ?? 1
  }

  /// A block's space before and after it, in ems of the body text, after
  /// `previous`, or first in the document for none.
  func space(_ block: StyledBlock, after previous: StyledBlock?, width: Double) -> (before: Double, after: Double) {
    let size = fontSize(block, width: width)
    let (before, after): (Double, Double) =
      if let heading = heading(block) {
        (heading.before * size * (previous.flatMap(self.heading) != nil ? adjacentHeadingBefore : 1), heading.after * size)
      } else if block == .rule {
        (rule.margin, rule.margin)
      } else {
        (0, blockAfter)
      }
    return (previous == nil ? 0 : before, after)
  }
}

/// A colour of the web's theme, light and dark.
struct ThemeColor: Sendable {
  var light: RGBA
  var dark: RGBA
}

/// sRGB channels from 0 to 1.
struct RGBA: Sendable {
  var red: Double
  var green: Double
  var blue: Double
  var alpha: Double

  init(_ red: Double, _ green: Double, _ blue: Double, _ alpha: Double) {
    (self.red, self.green, self.blue, self.alpha) = (red, green, blue, alpha)
  }
}
