import EditorModelInterface
import Foundation

/// A block as the web sets it: one of `BlockType`'s, a rule, a table, or
/// any other, which the web sets in the body text and spaces as every
/// block.
enum StyledBlock: Hashable, Sendable {
  case text(BlockType)
  case rule
  case table
  case other

  /// The block `DocumentText` gives `type`.
  init(_ type: String) {
    if let blockType = BlockType(rawValue: type) {
      self = .text(blockType)
    } else {
      self =
        switch type {
        case Self.ruleType: .rule
        case "table": .table
        default: .other
        }
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
    var start: Double
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
    /// Drawn around it where it's selected whole.
    var selected: Outline
  }

  /// A line around a box, `offset` points out from it, `width` points wide.
  struct Outline: Sendable {
    var width: Double
    var color: ThemeColor
    var offset: Double
  }

  /// A link's text, underlined in its colour at `underlineOpacity`, the
  /// underline's top `underlineOffset` below the baseline, in ems of the
  /// block's text, and `underlineThickness` points thick.
  struct Link: Sendable {
    var color: ThemeColor
    var underlineThickness: Double
    var underlineOffset: Double
    var underlineOpacity: Double
  }

  /// Lengths other than `fontSize` and `margin` are in points.
  struct Table: Sendable {
    /// In ems of the body text.
    var fontSize: Double
    var lineHeight: Double
    /// In ems of the table's text.
    var letterSpacing: Double
    var tabularFigures: Bool
    /// Before it and after it, in ems of the body text.
    var margin: Double
    var paddingX: Double
    var paddingY: Double
    /// The table's frame and the lines between its cells.
    var border: Double
    var borderColor: ThemeColor
    var cornerRadius: Double
    /// A cell's least width unless its column is short, and at most this
    /// share of the screen's width.
    var minimumWidth: Double
    var minimumViewportShare: Double
    /// An empty cell's least width.
    var emptyWidth: Double
    var headerBackground: ThemeColor
    /// As CSS numbers it.
    var headerWeight: Int
    /// Over a selected cell.
    var selection: ThemeColor
    /// The shadows at an edge the table scrolls past.
    var shadowWidth: Double
    var shadowColor: ThemeColor
    var pinned: Pinned
    /// A table more columns wide than this pins its first column on a
    /// narrow screen.
    var unpinnedColumns: Int
    /// A column no wider than this in Latin letters keeps each cell on one
    /// line.
    var shortColumns: Int
    /// A table this many columns wide keeps its short columns whole even
    /// where that makes it scroll.
    var scrollingColumns: Int
    /// A cell's text that's a number, a column mostly of which is set right.
    var number: JSRegExp
    /// A character that counts as two Latin letters toward `shortColumns`,
    /// and that a line may break either side of.
    var wide: JSRegExp
  }

  /// The first column a table pins on a screen no wider than `width`, `inset`
  /// inside the table's frame, over the columns scrolled under it, with a
  /// shadow of the table's `shadowColor` once they are.
  struct Pinned: Sendable {
    var width: Double
    var inset: Double
    var background: ThemeColor
    var headerBackground: ThemeColor
    var shadowX: Double
    var shadowBlur: Double
    var shadowSpread: Double
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
  var table: Table

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
    if block == .table { return table.fontSize }
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
      } else if block == .table {
        (table.margin, table.margin)
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

  /// The colour at `opacity` of its own, as CSS's `/` sets it.
  func opacity(_ opacity: Double) -> ThemeColor {
    var color = self
    color.light.alpha *= opacity
    color.dark.alpha *= opacity
    return color
  }
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

extension DocumentTypography.Table {
  func isWide(_ scalar: Unicode.Scalar) -> Bool { wide.firstMatch(in: String(scalar)) != nil }
}
