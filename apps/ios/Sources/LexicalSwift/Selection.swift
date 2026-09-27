/// A selection as a committed state keeps it, by node key.
enum KeySelection: Equatable, Sendable {
  case range(KeyRange)
  case table(TableSelection)
}

/// A range selection's points, format and style.
struct KeyRange: Equatable, Sendable {
  var anchor: KeyPoint
  var focus: KeyPoint
  var format: TextFormat
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

  func set(_ point: KeyPoint, onlyIfChanged: Bool = false) {
    set(point.key, point.offset, point.type, onlyIfChanged: onlyIfChanged)
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
  var format: TextFormat
  var style: String
  var dirty = false

  init(anchor: SelectionPoint, focus: SelectionPoint, format: TextFormat, style: String) {
    self.anchor = anchor
    self.focus = focus
    self.format = format
    self.style = style
    anchor.selection = self
    focus.selection = self
  }

  convenience init(_ saved: KeyRange) {
    self.init(
      anchor: SelectionPoint(saved.anchor), focus: SelectionPoint(saved.focus), format: saved.format,
      style: saved.style)
  }

  var saved: KeyRange { KeyRange(anchor: anchor.value, focus: focus.value, format: format, style: style) }

  var isCollapsed: Bool { anchor.is(focus) }

  func clone() -> RangeSelection {
    RangeSelection(
      anchor: SelectionPoint(anchor.value), focus: SelectionPoint(focus.value), format: format, style: style)
  }

  func `is`(_ other: KeySelection?) -> Bool {
    guard case .range(let other) = other else { return false }
    return anchor.value == other.anchor && focus.value == other.focus && format == other.format
      && style.isIdentical(to: other.style)
  }

  func setFormat(_ format: TextFormat) {
    self.format = format
    dirty = true
  }

  /// Lexical's `$updateSelectionFormatStyle`.
  func updateFormatStyle(_ format: TextFormat, _ style: String) {
    guard self.format != format || !self.style.isIdentical(to: style) else { return }
    self.format = format
    self.style = style
    dirty = true
  }

  func setTextNodeRange(_ anchorKey: NodeKey, _ anchorOffset: Int, _ focusKey: NodeKey, _ focusOffset: Int) {
    anchor.set(anchorKey, anchorOffset, .text)
    focus.set(focusKey, focusOffset, .text)
  }
}

/// @lexical/table's `TableSelection`: the cells of a table's rectangle from
/// the anchor cell to the focus cell.
struct TableSelection: Equatable, Sendable {
  var table: NodeKey
  var anchor: NodeKey
  var focus: NodeKey
}

extension EditorState {
  func point(_ point: KeyPoint) -> Point? {
    path(of: point.key).map { Point(path: $0, offset: point.offset, type: point.type) }
  }

  func pathSelection() throws -> Selection? {
    switch selection {
    case nil: return nil
    case .range(let range):
      guard let anchor = point(range.anchor), let focus = point(range.focus) else { return nil }
      return .range(anchor: anchor, focus: focus, format: range.format, style: range.style)
    case .table(let table):
      guard let tablePath = path(of: table.table), let anchor = path(of: table.anchor), let focus = path(of: table.focus)
      else { return nil }
      // The reference lists the cells among `getNodes`, which takes in what
      // the selected cells hold, a table's cells included, as
      // `$visitRecursively` does: last child first.
      var cells: [NodeKey] = []
      func visit(_ node: NodeKey) {
        if self[node].type == SerializedTableCellNode.type { cells.append(node) }
        children(of: node).reversed().forEach(visit)
      }
      try Update(self, nextKey: 0, revision: 0).cells(of: table).forEach(visit)
      return .table(table: tablePath, anchor: anchor, focus: focus, cells: cells.compactMap(path(of:)))
    }
  }
}
