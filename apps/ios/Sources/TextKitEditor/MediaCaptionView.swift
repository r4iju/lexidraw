#if canImport(UIKit)
import EditorModelInterface
import UIKit

@MainActor private final class CaptionAccessibilityElement: UIAccessibilityElement {
  private let url: URL?
  init(container: UIView, url: URL?) { self.url = url; super.init(accessibilityContainer: container) }
  override func accessibilityActivate() -> Bool {
    guard let url else { return false }; UIApplication.shared.open(url); return true
  }
}

@MainActor final class MediaCaptionView: UIView {
  private let payload: MediaPayload
  private let bodyStyle: DocumentText.Style
  private var box: TextBox?
  private var measuredWidth: CGFloat = -1
  private var textInset: CGFloat = 0

  init(_ payload: MediaPayload, style: DocumentText.Style? = nil) {
    self.payload = payload
    let typesetting = Typesetting(.web)
    bodyStyle = style ?? { typesetting.attributes(StyledBlock($0), $1) }
    super.init(frame: .zero)
    isOpaque = false
    backgroundColor = .clear
  }
  required init?(coder: NSCoder) { fatalError("MediaCaptionView is made in code") }

  static func attributedText(_ payload: MediaPayload, style: @escaping DocumentText.Style) -> NSAttributedString {
    func captionStyle(_ type: String, _ format: TextFormat) -> [NSAttributedString.Key: Any] {
      var attributes = style(type, format)
      let font = (attributes[.font] as? UIFont) ?? UIFont.preferredFont(forTextStyle: .body)
      attributes[.font] = font.withSize(font.pointSize * FigureStyle.captionFontScale)
      attributes[.foregroundColor] = UIColor.secondaryLabel
      let paragraph = (attributes[.paragraphStyle] as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
      paragraph.alignment = .center
      paragraph.minimumLineHeight = UIFont.preferredFont(forTextStyle: .body).pointSize * FigureStyle.captionFontScale * FigureStyle.captionLineHeight
      paragraph.maximumLineHeight = paragraph.minimumLineHeight
      paragraph.paragraphSpacing = 0
      attributes[.paragraphStyle] = paragraph
      return attributes
    }
    let text: NSMutableAttributedString
    if let state = payload.captionState, payload.captionRefusal == nil {
      text = NSMutableAttributedString(attributedString: DocumentText.caption(state, style: captionStyle))
    } else {
      text = NSMutableAttributedString(string: payload.caption, attributes: captionStyle("paragraph", []))
    }
    text.append(NSAttributedString(string: "\n", attributes: captionStyle("paragraph", [])))
    return text
  }

  func fittingHeight(_ width: CGFloat) -> CGFloat {
    guard !payload.caption.isEmpty else { return 0 }
    let font = UIFont.preferredFont(forTextStyle: .body)
    let ch = ("0" as NSString).size(withAttributes: [.font: font.withSize(font.pointSize * FigureStyle.captionFontScale)]).width
    let textWidth = min(width, MediaStyle.captionMaximumCh * ch)
    textInset = (width - textWidth) / 2
    if textWidth != measuredWidth {
      measuredWidth = textWidth
      box = TextBox(Self.attributedText(payload, style: bodyStyle), width: max(1, textWidth))
      box?.onRedraw = { [weak self] in self?.setNeedsDisplay() }
      setNeedsDisplay()
    }
    return box.map { max(0, $0.height - $0.spacingAfter) } ?? 0
  }
  override var accessibilityElements: [Any]? {
    get {
      guard let box, !payload.caption.isEmpty else { return [] }
      let text = Self.attributedText(payload, style: bodyStyle)
      var elements: [UIAccessibilityElement] = []
      text.enumerateAttribute(.link, in: NSRange(location: 0, length: text.length)) { value, range, _ in
        let label = (text.string as NSString).substring(with: range).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else { return }
        let element = CaptionAccessibilityElement(container: self, url: value as? URL)
        element.accessibilityLabel = label
        element.accessibilityTraits = value is URL ? .link : .staticText
        element.accessibilityFrameInContainerSpace = box.segments(range).reduce(CGRect.null) { $0.union($1) }.offsetBy(dx: self.textInset, dy: 0)
        elements.append(element)
      }
      return elements
    }
    set {}
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    _ = fittingHeight(bounds.width)
  }
  override func draw(_ rect: CGRect) {
    guard let box, let context = UIGraphicsGetCurrentContext() else { return }
    box.draw(at: CGPoint(x: textInset, y: 0), in: context)
  }
  func openLink(at point: CGPoint) {
    guard let box, let state = payload.captionState, payload.captionRefusal == nil else { return }
    let text = DocumentText.caption(state, style: bodyStyle)
    let offset = min(max(0, box.offset(closestTo: CGPoint(x: point.x - textInset, y: point.y))), max(0, text.length - 1))
    guard text.length > 0, let url = text.attribute(.link, at: offset, effectiveRange: nil) as? URL else { return }
    UIApplication.shared.open(url)
  }
}
#endif
