/// Lexical's `RangeSelection`, its points held by node key.
struct RangeSelection: Equatable, Sendable {
  var anchor: KeyPoint
  var focus: KeyPoint
  var format: Int
  var style: String

  var isCollapsed: Bool { anchor == focus }
}

struct KeyPoint: Equatable, Sendable {
  var key: NodeKey
  var offset: Int
  var type: Point.Kind
}

extension EditorState {
  func point(_ point: KeyPoint) -> Point? {
    path(of: point.key).map { Point(path: $0, offset: point.offset, type: point.type) }
  }

  var pathSelection: Selection? {
    guard let selection, let anchor = point(selection.anchor), let focus = point(selection.focus) else { return nil }
    return Selection(anchor: anchor, focus: focus, format: selection.format, style: selection.style)
  }
}
