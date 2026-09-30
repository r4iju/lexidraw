import Foundation
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// One selectable model node, irrespective of how many digits its marker displays.
final class FootnoteReferenceAttachment: NSTextAttachment {
  let marker: String
  init(marker: String, attributes: [NSAttributedString.Key: Any]) {
    self.marker = marker
    super.init(data: nil, ofType: nil)
    var drawingAttributes = attributes
    drawingAttributes[.baselineOffset] = nil
    let text = NSAttributedString(string: marker, attributes: drawingAttributes)
    let size = text.size()
    #if canImport(UIKit)
    image = UIGraphicsImageRenderer(size: CGSize(width: max(size.width, 1), height: max(size.height, 1))).image { _ in text.draw(at: .zero) }
    let descender = (attributes[.font] as? UIFont)?.descender ?? 0
    #else
    image = NSImage(size: size, flipped: false) { rect in text.draw(at: rect.origin); return true }
    let descender = (attributes[.font] as? NSFont)?.descender ?? 0
    #endif
    bounds = CGRect(x: 0, y: descender, width: size.width, height: size.height)
  }
  required init?(coder: NSCoder) { nil }
}
