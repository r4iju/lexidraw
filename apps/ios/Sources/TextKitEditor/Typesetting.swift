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
    didSet {
      typography = web.forLanguage(language)
      attributesByStyle.removeAll(keepingCapacity: true)
    }
  }

  init(_ typography: DocumentTypography) {
    web = typography
    self.typography = typography
  }

  private var fontMetricsEm: CGFloat?
  private var em: CGFloat { fontMetricsEm ?? UIFont.preferredFont(forTextStyle: .body).pointSize }

  /// A render/layout pass uses one Dynamic Type size, without repeatedly
  /// asking UIKit for the same preferred font for every run and block.
  func withFontMetrics<T>(_ body: () throws -> T) rethrows -> T {
    let previous = fontMetricsEm
    fontMetricsEm = em
    defer { fontMetricsEm = previous }
    return try body()
  }
  private struct AttributeStyle: Hashable {
    let block: StyledBlock
    let format: TextFormat
  }
  private var attributesByStyle: [AttributeStyle: [NSAttributedString.Key: Any]] = [:]
  private var attributesEm: CGFloat = 0

  /// Sets text for a view `width` wide and names the block styles whose
  /// responsive font size changed.
  func setWidth(_ width: Double) -> Set<String> {
    guard width != self.width else { return [] }
    attributesByStyle.removeAll(keepingCapacity: true)
    let before = Dictionary(uniqueKeysWithValues: BlockType.allCases.map { ($0, fontSize(.text($0))) })
    self.width = width
    return Set(BlockType.allCases.filter { fontSize(.text($0)) != before[$0] }.map(\.rawValue))
  }

  func fontSize(_ block: StyledBlock) -> CGFloat { typography.fontSize(block, width: width) * em }

  func lineHeight(_ block: StyledBlock) -> CGFloat { setting(block).lineHeight * fontSize(block) }

  /// What a block's text is set by besides its size and weight: a table's
  /// by the table's typography, the rest by the body's or their heading's.
  private struct TextSetting {
    /// In ems of the text.
    var lineHeight: Double
    var kern: CGFloat
    var paragraphSpacing: CGFloat
    var tabularFigures: Bool
  }

  private func setting(_ block: StyledBlock) -> TextSetting {
    let size = fontSize(block)
    if block == .table {
      let table = typography.table
      return TextSetting(
        lineHeight: table.lineHeight, kern: CGFloat(table.letterSpacing) * size,
        paragraphSpacing: typography.blockAfter * size, tabularFigures: table.tabularFigures)
    }
    let heading = typography.heading(block)
    return TextSetting(
      lineHeight: heading?.lineHeight ?? typography.lineHeight,
      kern: CGFloat(heading?.letterSpacing.map { $0 * size } ?? typography.letterSpacing * em),
      paragraphSpacing: space(block, after: nil).after, tabularFigures: false)
  }

  func space(_ block: StyledBlock, after previous: StyledBlock?) -> (before: CGFloat, after: CGFloat) {
    let space = typography.space(block, after: previous, width: width)
    return (space.before * em, space.after * em)
  }

  /// Text of `format` in `block`. A block's space after it is its
  /// paragraphs' spacing, which sets apart the blocks nested in it; a
  /// table's paragraphs are spaced as the body's are, in the table's text.
  func attributes(_ block: StyledBlock, _ format: TextFormat) -> [NSAttributedString.Key: Any] {
    let em = self.em
    if attributesEm != em {
      attributesEm = em
      attributesByStyle.removeAll(keepingCapacity: true)
    }
    let style = AttributeStyle(block: block, format: format)
    if let attributes = attributesByStyle[style] { return attributes }
    let size = fontSize(block)
    let heading = typography.heading(block)
    let setting = setting(block)
    let weight: UIFont.Weight = format.contains(.bold) ? .bold : heading.map { _ in Self.weight(typography.headingWeight) } ?? .regular
    var font =
      format.contains(.code)
      ? UIFont.monospacedSystemFont(ofSize: size * 0.9, weight: weight == .regular ? .regular : .bold)
      : UIFont.systemFont(ofSize: size, weight: weight)
    if format.contains(.italic), let italic = font.fontDescriptor.withSymbolicTraits(.traitItalic) {
      font = UIFont(descriptor: italic, size: 0)
    }
    if setting.tabularFigures {
      let tabular = font.fontDescriptor.addingAttributes([
        .featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType, .selector: kMonospacedNumbersSelector]]
      ])
      font = UIFont(descriptor: tabular, size: 0)
    }
    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = setting.lineHeight * size
    paragraph.maximumLineHeight = paragraph.minimumLineHeight
    paragraph.paragraphSpacing = setting.paragraphSpacing
    // A browser's tab stops, every eight spaces.
    paragraph.tabStops = []
    paragraph.defaultTabInterval = 8 * (" " as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: size)]).width
    var attributes: [NSAttributedString.Key: Any] = [
      .foregroundColor: (heading?.color ?? typography.color).color, .paragraphStyle: paragraph,
    ]
    if setting.kern != 0 { attributes[.kern] = setting.kern }
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
    attributes[.paragraphStyle] = paragraph.copy() as! NSParagraphStyle
    attributesByStyle[style] = attributes
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
