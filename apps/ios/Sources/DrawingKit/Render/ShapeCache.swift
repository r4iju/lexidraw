import Foundation

/// Shapes kept from one scene to the next while a drawing is edited, as the
/// web's `ShapeCache` keeps them per element: an element drawn again
/// unchanged isn't worked out again, which is most of them in each frame.
public final class ShapeCache: @unchecked Sendable {
  private struct Kept {
    var element: JSONObject
    var background: String
    var shape: [Drawable]??
    var outline: String?
  }

  private var kept: [String: Kept] = [:]
  private let lock = NSLock()

  public init() {}

  private func entry(_ element: DrawingElement, _ background: String) -> Kept {
    if let kept = kept[element.id], kept.background == background, kept.element == element.raw {
      return kept
    }
    return Kept(element: element.raw, background: background)
  }

  func shape(_ element: DrawingElement, background: String, _ make: () -> [Drawable]?) -> [Drawable]? {
    lock.withLock {
      var entry = entry(element, background)
      if let shape = entry.shape { return shape }
      let shape = make()
      entry.shape = .some(shape)
      kept[element.id] = entry
      return shape
    }
  }

  func outline(_ element: DrawingElement, background: String, _ make: () -> String) -> String {
    lock.withLock {
      var entry = entry(element, background)
      if let outline = entry.outline { return outline }
      let outline = make()
      entry.outline = outline
      kept[element.id] = entry
      return outline
    }
  }
}
