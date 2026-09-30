#if canImport(UIKit)
import UIKit
/// Expensive attachment rendering starts when TextKit lays out its block or
/// table cell, rather than while the document-wide attributed text is built.
public protocol LazyTextAttachment: AnyObject {
  @MainActor func use(font: UIFont?)
  @MainActor func load(onChange: @escaping @MainActor () -> Void)
}
extension LazyTextAttachment {
  @MainActor public func use(font: UIFont?) {}
}
#endif
