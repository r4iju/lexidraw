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
    var letterSpacing: Double
    var before: Double
    var after: Double
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

  var color: ThemeColor
  var lineHeight: Double
  /// After any block that doesn't set its own.
  var blockAfter: Double
  /// As CSS numbers it, 400 being regular.
  var headingWeight: Int
  var headings: [BlockType: Heading]
  /// A heading right after a heading has this much of its space before.
  var adjacentHeadingBefore: Double
  /// The widest a view is narrow at, which sets the headings in
  /// `narrowHeadingSizes` smaller.
  var narrowWidth: Double
  var narrowHeadingSizes: [BlockType: Double]
  var quote: Quote
  var rule: Rule

  func heading(_ block: StyledBlock) -> Heading? {
    guard case .text(let type) = block else { return nil }
    return headings[type]
  }

  /// The size of the text in `block`, in ems of the body text.
  func fontSize(_ block: StyledBlock, narrow: Bool) -> Double {
    guard case .text(let type) = block else { return 1 }
    return (narrow ? narrowHeadingSizes[type] : nil) ?? headings[type]?.fontSize ?? 1
  }

  /// A block's space before and after it, in ems of the body text. The
  /// space between two blocks is the larger of the first's after and the
  /// second's before, as CSS collapses margins, and the first block has
  /// none before it.
  func space(_ block: StyledBlock, after previous: StyledBlock?, narrow: Bool) -> (before: Double, after: Double) {
    let size = fontSize(block, narrow: narrow)
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
