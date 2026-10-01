#if canImport(UIKit)
import Foundation
import JavaScriptCore
import LexidrawJSON
import UIKit

/// The web's document header, kept on the root's NodeState: what it shows
/// around the title. The web's own normalisation and property parsing read
/// it, evaluated once, so the app shows what the web shows.
public struct DocumentHeader: Decodable, Equatable, Sendable {
  public struct Cover: Decodable, Equatable, Sendable {
    public var src: String
    public var alt: String?
    public var focus: String?
  }
  public struct Part: Decodable, Equatable, Sendable {
    public var kind: String
    public var text: String
    public var href: String?
    public var status: String?
  }
  public struct Property: Decodable, Equatable, Sendable {
    public var key: String
    public var parts: [Part]
  }
  public var subtitle: String?
  public var cover: Cover?
  public var toc: Bool
  public var properties: [Property]

  public var isEmpty: Bool { subtitle == nil && cover == nil && !toc && properties.isEmpty }

  /// `header` as the root stores it, its dates in `language`.
  public init(_ header: JSONValue, language: String?) throws {
    guard let context = JSContext() else { throw Unreadable("JavaScriptCore unavailable") }
    context.evaluateScript(documentHeaderScript)
    let result = context.objectForKeyedSubscript("documentHeaderPresentation")?.call(
      withArguments: [header.stringified, language as Any? ?? NSNull()])
    guard context.exception == nil, let json = result?.toString() else {
      throw Unreadable(context.exception?.toString() ?? "The header was not returned")
    }
    self = try JSONDecoder().decode(Self.self, from: Data(json.utf8))
  }

  public struct Unreadable: Error, LocalizedError, Sendable {
    let message: String
    init(_ message: String) { self.message = message }
    public var errorDescription: String? { "The document header can’t be shown: \(message)" }
  }
}

/// Cover, subtitle, properties and contents above the content, as the web's
/// DocumentHeader shows them to a reader. The app doesn't edit them yet.
@MainActor final class DocumentHeaderView: UIView {
  typealias Style = WebDocumentHeaderStyle
  struct Heading: Equatable {
    var block: Int
    var text: String
    var subheading: Bool
  }

  var header: DocumentHeader { didSet { if header != oldValue { rebuild() } } }
  var outline: [Heading] = [] { didSet { if outline != oldValue, header.toc { rebuild() } } }
  var imageLoader: MediaImageLoader? { didSet { loadCover() } }
  var onSelectHeading: ((Int) -> Void)?
  private let points: (CGFloat) -> CGFloat
  private let font: (CGFloat, Int) -> UIFont
  private var cover: CoverView?
  private var rows: [(term: UILabel, value: UITextView)] = []
  private var blocks: [(view: UIView, after: CGFloat)] = []
  private var loading: Task<Void, Never>?

  init(header: DocumentHeader, points: @escaping (CGFloat) -> CGFloat, font: @escaping (CGFloat, Int) -> UIFont) {
    self.header = header
    self.points = points
    self.font = font
    super.init(frame: .zero)
    rebuild()
  }
  required init?(coder: NSCoder) { fatalError("DocumentHeaderView is made in code") }
  deinit { loading?.cancel() }

  private func text(_ string: String, pixels: CGFloat, lineHeight: CGFloat, weight: Int = 400, color: ThemeColor) -> NSAttributedString {
    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = points(pixels) * lineHeight
    paragraph.maximumLineHeight = paragraph.minimumLineHeight
    return NSAttributedString(string: string, attributes: [
      .font: font(pixels, weight), .foregroundColor: color.color, .paragraphStyle: paragraph,
    ])
  }

  private func label(_ text: NSAttributedString) -> UILabel {
    let label = UILabel()
    label.attributedText = text
    label.numberOfLines = 0
    return label
  }

  /// Draws it again in the current colours and text size.
  func refresh() { rebuild() }

  private func rebuild() {
    subviews.forEach { $0.removeFromSuperview() }
    blocks = []
    rows = []
    cover = nil
    if let source = header.cover {
      let view = CoverView(focus: source.focus)
      view.backgroundColor = Style.coverBackground.color
      view.layer.cornerRadius = Style.coverRadius
      view.accessibilityLabel = source.alt
      view.isAccessibilityElement = !(source.alt ?? "").isEmpty
      cover = view
      blocks.append((view, points(Style.coverAfter)))
      loadCover()
    }
    if let subtitle = header.subtitle {
      let size = 16 * Style.subtitleSize
      blocks.append((label(text(subtitle, pixels: size, lineHeight: Style.subtitleLineHeight, color: Style.subtitleColor)),
        points(size * Style.subtitleAfter)))
    }
    for property in header.properties {
      let term = label(text(property.key, pixels: Style.termSize, lineHeight: Style.termLineHeight, color: Style.termColor))
      let value = UITextView()
      value.isEditable = false
      value.isScrollEnabled = false
      value.backgroundColor = .clear
      value.textContainerInset = .zero
      value.textContainer.lineFragmentPadding = 0
      value.linkTextAttributes = [:]
      value.attributedText = self.value(property.parts)
      value.accessibilityLabel = "\(property.key), \(value.text ?? "")"
      rows.append((term, value))
      addSubview(term)
      addSubview(value)
    }
    let headings = header.toc ? outline : []
    if !headings.isEmpty {
      let contents = UIStackView()
      contents.axis = .vertical
      contents.accessibilityLabel = Style.contentsLabel
      let title = label(text(Style.contentsLabel, pixels: Style.contentsLabelSize, lineHeight: Style.contentsLineHeight,
        weight: Int(Style.contentsLabelWeight), color: Style.contentsLabelColor))
      contents.addArrangedSubview(title)
      contents.setCustomSpacing(points(Style.contentsLabelAfter), after: title)
      for heading in headings {
        let size = heading.subheading ? Style.contentsSubitemSize : Style.contentsSize
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.plain()
        configuration.attributedTitle = try? AttributedString(
          text(heading.text, pixels: size, lineHeight: Style.contentsLineHeight, color: .foreground), including: \.uiKit)
        configuration.contentInsets = NSDirectionalEdgeInsets(
          top: points(Style.contentsItemPadding), leading: heading.subheading ? points(size * Style.contentsSubitemIndent) : 0,
          bottom: points(Style.contentsItemPadding), trailing: 0)
        configuration.titleAlignment = .leading
        button.configuration = configuration
        button.contentHorizontalAlignment = .leading
        button.addAction(UIAction { [weak self] _ in self?.onSelectHeading?(heading.block) }, for: .touchUpInside)
        contents.addArrangedSubview(button)
      }
      blocks.append((contents, points(Style.contentsAfter)))
    }
    for (view, _) in blocks { addSubview(view) }
    invalidateIntrinsicContentSize()
    superview?.setNeedsLayout()
  }

  private func value(_ parts: [DocumentHeader.Part]) -> NSAttributedString {
    let result = NSMutableAttributedString()
    for (index, part) in parts.enumerated() {
      if index > 0, part.kind != "text", parts[index - 1].kind != "text" {
        result.append(text(" ", pixels: Style.valueSize, lineHeight: Style.valueLineHeight, color: .foreground))
      }
      switch part.kind {
      case "status":
        let colors = Style.statusColors[part.status ?? ""] ?? Style.statusColors[""]!
        result.append(NSAttributedString(attachment: PillAttachment(
          text: text(part.text, pixels: Style.statusSize, lineHeight: Style.statusLineHeight, weight: Int(Style.statusWeight), color: colors.foreground),
          background: colors.background.color, padding: points(Style.statusPaddingX), radius: .infinity)))
      case "mention":
        result.append(NSAttributedString(attachment: PillAttachment(
          text: text(part.text, pixels: Style.valueSize, lineHeight: Style.valueLineHeight, weight: Int(Style.mentionWeight), color: Style.mentionForeground),
          background: Style.mentionBackground.color, padding: points(Style.mentionPaddingX), radius: Style.mentionRadius)))
      case "link":
        let link = NSMutableAttributedString(attributedString: text(part.text, pixels: Style.valueSize, lineHeight: Style.valueLineHeight, color: Style.linkColor))
        let range = NSRange(location: 0, length: link.length)
        link.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: range)
        if let href = part.href, let url = URL(string: href) { link.addAttribute(.link, value: url, range: range) }
        result.append(link)
      default:
        result.append(text(part.text, pixels: Style.valueSize, lineHeight: Style.valueLineHeight, color: .foreground))
      }
    }
    return result
  }

  private func loadCover() {
    loading?.cancel()
    guard let cover, let loader = imageLoader, let source = header.cover?.src, let url = URL(string: source) else { return }
    loading = Task { [weak cover] in
      guard let image = try? await loader(url), !Task.isCancelled else { return }
      cover?.image = image
    }
  }

  /// Lays the header out `width` wide and returns its height.
  @discardableResult func layout(width: CGFloat, viewportHeight: CGFloat) -> CGFloat {
    var y: CGFloat = 0
    func place(_ view: UIView, after: CGFloat) {
      let height: CGFloat
      if view === cover {
        height = min(width / Style.coverAspect, viewportHeight * Style.coverMaximumViewportShare)
      } else {
        height = view.systemLayoutSizeFitting(
          CGSize(width: width, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height
      }
      view.frame = CGRect(x: 0, y: y, width: width, height: height)
      y += height + after
    }
    let contentsIndex = header.toc && !outline.isEmpty ? blocks.count - 1 : blocks.count
    for (view, after) in blocks[..<contentsIndex] { place(view, after: after) }
    if !rows.isEmpty {
      let narrow = width <= points(Style.narrowWidth)
      let columnGap = points(Style.propertyColumnGap)
      let termWidth = narrow ? width : min(
        rows.map { $0.term.sizeThatFits(CGSize(width: CGFloat.greatestFiniteMagnitude, height: 0)).width }.max() ?? 0,
        width / 2)
      let valueX = narrow ? 0 : termWidth + columnGap
      let valueWidth = max(width - valueX, 1)
      for (index, row) in rows.enumerated() {
        let term = row.term.sizeThatFits(CGSize(width: termWidth, height: .greatestFiniteMagnitude)).height
        let value = row.value.sizeThatFits(CGSize(width: valueWidth, height: .greatestFiniteMagnitude)).height
        row.term.frame = CGRect(x: 0, y: y, width: termWidth, height: term)
        if narrow {
          row.value.frame = CGRect(x: 0, y: y + term, width: valueWidth, height: value)
          y += term + value + points(Style.narrowValueAfter) + (index < rows.count - 1 ? points(Style.narrowRowGap) : 0)
        } else {
          // The web aligns a row's term and value on their first baselines.
          let shift = (row.value.font?.ascender ?? 0) - (row.term.font?.ascender ?? 0)
          row.term.frame.origin.y += max(shift, 0)
          row.value.frame = CGRect(x: valueX, y: y + max(-shift, 0), width: valueWidth, height: value)
          y += max(row.term.frame.maxY, row.value.frame.maxY) - y + (index < rows.count - 1 ? points(Style.propertyRowGap) : 0)
        }
      }
      y += points(Style.propertiesAfter) - (narrow ? points(Style.narrowValueAfter) : 0)
    }
    for (view, after) in blocks[contentsIndex...] { place(view, after: after) }
    return y
  }
}

/// A cover image filling its frame, cropped as CSS `object-fit: cover` with
/// `object-position` at the stored focus.
@MainActor private final class CoverView: UIView {
  private let imageView = UIImageView()
  private let focus: CGPoint
  var image: UIImage? { didSet { imageView.image = image; setNeedsLayout() } }

  init(focus: String?) {
    let parts = (focus ?? "").split(separator: " ").compactMap { part -> CGFloat? in
      switch part {
      case "left", "top": 0
      case "center": 0.5
      case "right", "bottom": 1
      default: part.hasSuffix("%") ? Double(part.dropLast()).map { CGFloat($0) / 100 } : nil
      }
    }
    self.focus = CGPoint(x: parts.first ?? 0.5, y: parts.count > 1 ? parts[1] : 0.5)
    super.init(frame: .zero)
    clipsToBounds = true
    addSubview(imageView)
  }
  required init?(coder: NSCoder) { fatalError("CoverView is made in code") }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard let size = image?.size, size.width > 0, size.height > 0 else { imageView.frame = bounds; return }
    let scale = max(bounds.width / size.width, bounds.height / size.height)
    let fitted = CGSize(width: size.width * scale, height: size.height * scale)
    imageView.frame = CGRect(
      x: (bounds.width - fitted.width) * focus.x, y: (bounds.height - fitted.height) * focus.y,
      width: fitted.width, height: fitted.height)
  }
}

/// A run of text drawn on a rounded fill, as the web's status and mention
/// spans are, kept on the line as one piece.
private final class PillAttachment: NSTextAttachment {
  private let text: NSAttributedString
  private let fill: UIColor
  private let padding: CGFloat
  private let radius: CGFloat

  init(text: NSAttributedString, background: UIColor, padding: CGFloat, radius: CGFloat) {
    self.text = text
    fill = background
    self.padding = padding
    self.radius = radius
    super.init(data: nil, ofType: nil)
    let size = text.size()
    let font = text.length > 0 ? text.attribute(.font, at: 0, effectiveRange: nil) as? UIFont : nil
    bounds = CGRect(x: 0, y: font.map { $0.descender } ?? 0, width: ceil(size.width + 2 * padding), height: ceil(size.height))
  }
  required init?(coder: NSCoder) { fatalError("PillAttachment is made in code") }

  override func image(forBounds imageBounds: CGRect, textContainer: NSTextContainer?, characterIndex charIndex: Int) -> UIImage? {
    let format = UIGraphicsImageRendererFormat()
    format.opaque = false
    return UIGraphicsImageRenderer(size: imageBounds.size, format: format).image { context in
      let rect = CGRect(origin: .zero, size: imageBounds.size)
      fill.setFill()
      UIBezierPath(roundedRect: rect, cornerRadius: min(radius, rect.height / 2)).fill()
      text.draw(at: CGPoint(x: padding, y: 0))
    }
  }
}
#endif
