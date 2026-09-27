#if canImport(UIKit)
import EditorModelInterface
import UIKit

/// The web's typography at the width a view has: the attributes of each
/// block's text, and the space around each block, in points. An em is the
/// body text's size, so text follows the reader's text size.
final class Typesetting {
  private let web: DocumentTypography
  private(set) var typography: DocumentTypography
  /// The view's, which sets some headings smaller.
  private(set) var width: Double = 0
  /// The document's, a BCP 47 tag.
  var language: String? {
    didSet { typography = web.forLanguage(language) }
  }

  init(_ typography: DocumentTypography) {
    web = typography
    self.typography = typography
  }

  private var em: CGFloat { UIFont.preferredFont(forTextStyle: .body).pointSize }

  /// Sets text for a view `width` wide, returning whether that sets any
  /// heading otherwise.
  func setWidth(_ width: Double) -> Bool {
    let before = BlockType.allCases.map { fontSize(.text($0)) }
    self.width = width
    return BlockType.allCases.map { fontSize(.text($0)) } != before
  }

  func fontSize(_ block: StyledBlock) -> CGFloat { typography.fontSize(block, width: width) * em }

  func lineHeight(_ block: StyledBlock) -> CGFloat {
    let lineHeight =
      block == .table ? typography.table.lineHeight : typography.heading(block)?.lineHeight ?? typography.lineHeight
    return lineHeight * fontSize(block)
  }

  func space(_ block: StyledBlock, after previous: StyledBlock?) -> (before: CGFloat, after: CGFloat) {
    let space = typography.space(block, after: previous, width: width)
    return (space.before * em, space.after * em)
  }

  /// Text of `format` in `block`. A block's space after it is its
  /// paragraphs' spacing, which sets apart the blocks nested in it; a
  /// table's paragraphs are spaced as the body's are, in the table's text.
  func attributes(_ block: StyledBlock, _ format: TextFormat) -> [NSAttributedString.Key: Any] {
    let size = fontSize(block)
    let heading = typography.heading(block)
    let weight: UIFont.Weight = format.contains(.bold) ? .bold : heading.map { _ in Self.weight(typography.headingWeight) } ?? .regular
    var font =
      format.contains(.code)
      ? UIFont.monospacedSystemFont(ofSize: size * 0.9, weight: weight == .regular ? .regular : .bold)
      : UIFont.systemFont(ofSize: size, weight: weight)
    if format.contains(.italic), let italic = font.fontDescriptor.withSymbolicTraits(.traitItalic) {
      font = UIFont(descriptor: italic, size: 0)
    }
    if block == .table, typography.table.tabularFigures {
      let tabular = font.fontDescriptor.addingAttributes([
        .featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType, .selector: kMonospacedNumbersSelector]]
      ])
      font = UIFont(descriptor: tabular, size: 0)
    }
    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = lineHeight(block)
    paragraph.maximumLineHeight = paragraph.minimumLineHeight
    paragraph.paragraphSpacing =
      block == .table ? typography.blockAfter * size : space(block, after: nil).after
    // A browser's tab stops, every eight spaces.
    paragraph.tabStops = []
    paragraph.defaultTabInterval = 8 * (" " as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: size)]).width
    var attributes: [NSAttributedString.Key: Any] = [
      .foregroundColor: (heading?.color ?? typography.color).color, .paragraphStyle: paragraph,
    ]
    let kern =
      block == .table
      ? CGFloat(typography.table.letterSpacing) * size
      : CGFloat(heading?.letterSpacing.map { $0 * size } ?? typography.letterSpacing * em)
    if kern != 0 { attributes[.kern] = kern }
    if block == .text(.quote) {
      let quote = typography.quote
      paragraph.firstLineHeadIndent = quote.borderWidth + quote.paddingStart * size
      paragraph.headIndent = paragraph.firstLineHeadIndent
      attributes[.leadingBorder] = LeadingBorder(width: quote.borderWidth, color: quote.borderColor.color)
    }
    if format.contains(.subscript) || format.contains(.superscript) {
      font = font.withSize(font.pointSize * 0.75)
      attributes[.baselineOffset] = (format.contains(.superscript) ? 0.4 : -0.2) * size
    }
    attributes[.font] = font
    if format.contains(.underline) { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
    if format.contains(.strikethrough) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
    if format.contains(.code) { attributes[.backgroundColor] = UIColor.secondarySystemFill }
    if format.contains(.highlight) { attributes[.backgroundColor] = UIColor.systemYellow.withAlphaComponent(0.4) }
    return attributes
  }

  /// A CSS font weight.
  static func weight(_ weight: Int) -> UIFont.Weight {
    let weights: [UIFont.Weight] = [.ultraLight, .thin, .light, .regular, .medium, .semibold, .bold, .heavy, .black]
    return weights[min(max(weight / 100 - 1, 0), weights.count - 1)]
  }
}

extension NSAttributedString.Key {
  /// A line down the start of a block, as a `LeadingBorder`.
  static let leadingBorder = NSAttributedString.Key("TextKitEditor.leadingBorder")
}

final class LeadingBorder: NSObject {
  let width: CGFloat
  let color: UIColor

  init(width: CGFloat, color: UIColor) {
    self.width = width
    self.color = color
  }
}

extension ThemeColor {
  var color: UIColor {
    let (light, dark) = (UIColor(light), UIColor(dark))
    return UIColor { $0.userInterfaceStyle == .dark ? dark : light }
  }
}

extension UIColor {
  fileprivate convenience init(_ rgba: RGBA) {
    self.init(red: rgba.red, green: rgba.green, blue: rgba.blue, alpha: rgba.alpha)
  }
}
#endif
