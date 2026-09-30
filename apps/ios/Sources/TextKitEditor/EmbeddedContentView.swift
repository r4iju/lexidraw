#if canImport(UIKit)
import EditorModelInterface
import UIKit

/// Native content supplied by the app for a document decorator.
@MainActor open class EmbeddedContentView: UIView {
  open func show(_ node: JSONValue) {}
  open func contentSize(fitting width: CGFloat) -> CGSize { CGSize(width: width, height: 180) }
}
#endif
