#if canImport(UIKit)
import UIKit

final class HiddenCommentView: EmbeddedContentView {
  override func contentSize(fitting width: CGFloat) -> CGSize { CGSize(width: width, height: 0) }
}

final class HiddenCommentAttachment: NSTextAttachment {
  override func attachmentBounds(for textContainer: NSTextContainer?, proposedLineFragment lineFrag: CGRect,
    glyphPosition position: CGPoint, characterIndex charIndex: Int) -> CGRect { .zero }
}
#endif
