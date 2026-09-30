#if canImport(UIKit)
/// Expensive attachment rendering starts when TextKit lays out its block or
/// table cell, rather than while the document-wide attributed text is built.
public protocol LazyTextAttachment: AnyObject {
  func use(fontSize: Double)
  @MainActor func setAnimationVisible(_ visible: Bool)
  @MainActor func load(onChange: @escaping @MainActor () -> Void)
}
extension LazyTextAttachment {
  public func use(fontSize: Double) {}
  @MainActor public func setAnimationVisible(_ visible: Bool) {}
}
#endif
