import Foundation

/// The actual nested mark boxes, outermost first, beneath each native text run.
final class CommentHighlight: NSObject {
  let ids: [String]
  let resolved: Bool
  let active: Bool
  init(ids: [String], resolved: Bool, active: Bool) {
    self.ids = ids; self.resolved = resolved; self.active = active
  }
  override func isEqual(_ object: Any?) -> Bool {
    guard let other = object as? CommentHighlight else { return false }
    return ids == other.ids && resolved == other.resolved && active == other.active
  }
  override var hash: Int {
    var hash = Hasher(); hash.combine(ids); hash.combine(resolved); hash.combine(active); return hash.finalize()
  }
}
