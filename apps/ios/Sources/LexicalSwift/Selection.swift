/// A range selection as a committed state keeps it, its points by node key.
struct KeySelection: Equatable, Sendable {
  var anchor: KeyPoint
  var focus: KeyPoint
  var format: Int
  var style: String
}

struct KeyPoint: Equatable, Sendable {
  var key: NodeKey
  var offset: Int
  var type: Point.Kind
}

/// Lexical's `Point`, a shared object as there: an update's code holds on to
/// a selection's points while other code moves them, and moving one marks
/// the selection it belongs to as changed.
final class SelectionPoint {
  private(set) var key: NodeKey
  private(set) var offset: Int
  private(set) var type: Point.Kind
  fileprivate(set) weak var selection: RangeSelection?

  init(_ key: NodeKey, _ offset: Int, _ type: Point.Kind) {
    self.key = key
    self.offset = offset
    self.type = type
  }

  convenience init(_ point: KeyPoint) {
    self.init(point.key, point.offset, point.type)
  }

  var value: KeyPoint { KeyPoint(key: key, offset: offset, type: type) }

  func set(_ key: NodeKey, _ offset: Int, _ type: Point.Kind, onlyIfChanged: Bool = false) {
    if onlyIfChanged, self.key == key, self.offset == offset, self.type == type { return }
    self.key = key
    self.offset = offset
    self.type = type
    selection?.dirty = true
  }

  func `is`(_ other: SelectionPoint) -> Bool {
    key == other.key && offset == other.offset && type == other.type
  }
}

/// Lexical's `RangeSelection`. An update works on a copy of the committed
/// selection, as Lexical's does; `dirty` says the update set it.
final class RangeSelection {
  let anchor: SelectionPoint
  let focus: SelectionPoint
  var format: Int
  var style: String
  var dirty = false

  init(anchor: SelectionPoint, focus: SelectionPoint, format: Int, style: String) {
    self.anchor = anchor
    self.focus = focus
    self.format = format
    self.style = style
    anchor.selection = self
    focus.selection = self
  }

  convenience init(_ saved: KeySelection) {
    self.init(
      anchor: SelectionPoint(saved.anchor), focus: SelectionPoint(saved.focus), format: saved.format,
      style: saved.style)
  }

  var saved: KeySelection { KeySelection(anchor: anchor.value, focus: focus.value, format: format, style: style) }

  var isCollapsed: Bool { anchor.is(focus) }

  func clone() -> RangeSelection {
    RangeSelection(
      anchor: SelectionPoint(anchor.value), focus: SelectionPoint(focus.value), format: format, style: style)
  }

  func `is`(_ other: KeySelection?) -> Bool {
    guard let other else { return false }
    return anchor.value == other.anchor && focus.value == other.focus && format == other.format
      && style.isIdentical(to: other.style)
  }

  func setFormat(_ format: Int) {
    self.format = format
    dirty = true
  }

  func setTextNodeRange(_ anchorKey: NodeKey, _ anchorOffset: Int, _ focusKey: NodeKey, _ focusOffset: Int) {
    anchor.set(anchorKey, anchorOffset, .text)
    focus.set(focusKey, focusOffset, .text)
  }
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
