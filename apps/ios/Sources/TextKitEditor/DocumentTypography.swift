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
  /// In the stylesheet's order, a later one over an earlier where both
  /// apply.
  var languages: [Language]
  var quote: Quote
  var rule: Rule

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

  /// A block's space before and after it, in ems of the body text. The
  /// space between two blocks is the larger of the first's after and the
  /// second's before, as CSS collapses margins, and the first block has
  /// none before it.
  func space(_ block: StyledBlock, after previous: StyledBlock?, width: Double) -> (before: Double, after: Double) {
    let size = fontSize(block, width: width)
    if let heading = heading(block) {
      let adjacent = previous.map { self.heading($0) != nil } == true
      return (heading.before * size * (adjacent ? adjacentHeadingBefore : 1), heading.after * size)
    }
    if block == .rule { return (rule.margin, rule.margin) }
    return (0, blockAfter)
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
