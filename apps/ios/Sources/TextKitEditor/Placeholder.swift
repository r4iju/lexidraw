#if canImport(UIKit)
import EditorModelInterface
import UIKit

/// Where an embedded node will be drawn, until it has a view of its own.
@MainActor final class PlaceholderView: UIView {
  static let height: CGFloat = 180

  init(type: String) {
    super.init(frame: .zero)
    backgroundColor = .secondarySystemFill
    layer.cornerRadius = 8
    let label = UILabel()
    label.text = type
    label.font = .preferredFont(forTextStyle: .caption1)
    label.textColor = .secondaryLabel
    label.translatesAutoresizingMaskIntoConstraints = false
    addSubview(label)
    NSLayoutConstraint.activate([
      label.centerXAnchor.constraint(equalTo: centerXAnchor), label.centerYAnchor.constraint(equalTo: centerYAnchor),
    ])
  }

  required init?(coder: NSCoder) { fatalError("PlaceholderView is made in code") }
}
/// Where a node inside a line of text will be drawn, as an attachment
/// the size of a word.
enum InlinePlaceholder {
  static func attachment(type: String) -> NSTextAttachment {
    let font = UIFont.preferredFont(forTextStyle: .caption1)
    let label = type as NSString
    let size = CGSize(width: ceil(label.size(withAttributes: [.font: font]).width) + 12, height: ceil(font.lineHeight) + 4)
    let image = UIGraphicsImageRenderer(size: size).image { _ in
      UIColor.secondarySystemFill.setFill()
      UIBezierPath(roundedRect: CGRect(origin: .zero, size: size), cornerRadius: 4).fill()
      label.draw(at: CGPoint(x: 6, y: 2), withAttributes: [.font: font, .foregroundColor: UIColor.secondaryLabel])
    }
    let attachment = NSTextAttachment(image: image)
    attachment.bounds = CGRect(x: 0, y: -4, width: size.width, height: size.height)
    return attachment
  }

  /// A node with no text of its own, which has nothing in the text to show.
  static func isEmbedded(_ node: JSONValue) -> Bool {
    node["children"] == nil && node["text"] == nil && node["type"] != "linebreak"
  }
}
#endif
