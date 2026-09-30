#if canImport(UIKit)
/// Expensive attachment rendering starts when TextKit lays out its block or
/// table cell, rather than while the document-wide attributed text is built.
public protocol LazyTextAttachment: AnyObject {
  @MainActor func load(onChange: @escaping @MainActor () -> Void)
}
#endif
