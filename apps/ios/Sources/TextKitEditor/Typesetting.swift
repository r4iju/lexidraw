#if canImport(UIKit)
import EditorModelInterface
import UIKit

/// The web's typography at the width a view has: the attributes of each
/// block's text, and the space around each block, in points. An em is the
/// body text's size, so text follows the reader's text size.
final class Typesetting {
  let typography: DocumentTypography
  /// Whether the view is no wider than `typography.narrowWidth`.
  var isNarrow = true

  init(_ typography: DocumentTypography) {
    self.typography = typography
  }

  private var em: CGFloat { UIFont.preferredFont(forTextStyle: .body).pointSize }

  func fontSize(_ blockType: String) -> CGFloat { typography.fontSize(blockType, narrow: isNarrow) * em }

  func lineHeight(_ blockType: String) -> CGFloat {
    (typography.headings[blockType]?.lineHeight ?? typography.lineHeight) * fontSize(blockType)
  }

  func space(_ blockType: String, after previous: String?) -> (before: CGFloat, after: CGFloat) {
    let space = typography.space(blockType, after: previous, narrow: isNarrow)
    return (space.before * em, space.after * em)
  }

  /// Text of `format` in a block of `blockType`, which for a heading is its
  /// tag. A block's space after it is its paragraphs' spacing, which sets
  /// apart the blocks nested in it.
  func attributes(_ blockType: String, _ format: TextFormat) -> [NSAttributedString.Key: Any] {
    let size = fontSize(blockType)
    let heading = typography.headings[blockType]
    let weight: UIFont.Weight = format.contains(.bold) ? .bold : heading.map { _ in Self.weight(typography.headingWeight) } ?? .regular
    var font =
      format.contains(.code)
      ? UIFont.monospacedSystemFont(ofSize: size * 0.9, weight: weight == .regular ? .regular : .bold)
      : UIFont.systemFont(ofSize: size, weight: weight)
    if format.contains(.italic), let italic = font.fontDescriptor.withSymbolicTraits(.traitItalic) {
      font = UIFont(descriptor: italic, size: 0)
    }
    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = lineHeight(blockType)
    paragraph.maximumLineHeight = paragraph.minimumLineHeight
    paragraph.paragraphSpacing = space(blockType, after: nil).after
    var attributes: [NSAttributedString.Key: Any] = [
      .foregroundColor: (heading?.color ?? typography.color).color, .paragraphStyle: paragraph,
    ]
    if let heading, heading.letterSpacing != 0 { attributes[.kern] = heading.letterSpacing * size }
    if blockType == "quote" {
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
  private static func weight(_ weight: Int) -> UIFont.Weight {
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
