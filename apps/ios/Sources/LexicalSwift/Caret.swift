/// Lexical's NodeCaret API (`lexical/src/caret`), which its selection and
/// deletion code walk the document with.
enum CaretDirection: Equatable, Sendable {
  case next, previous

  var flipped: CaretDirection { self == .next ? .previous : .next }
}

enum RootMode {
  /// Walks stop at the root.
  case root
  /// Walks stop at the root or a shadow root.
  case shadowRoot
}

/// Lexical's `PointCaret`: beside a node (`sibling`), inside an element at
/// one end (`child`), or at an offset in text (`text`), facing a direction.
enum Caret: Equatable, Sendable {
  case sibling(NodeKey, CaretDirection)
  case child(NodeKey, CaretDirection)
  case text(NodeKey, CaretDirection, offset: Int)

  var origin: NodeKey {
    switch self {
    case .sibling(let origin, _), .child(let origin, _), .text(let origin, _, _): origin
    }
  }

  var direction: CaretDirection {
    switch self {
    case .sibling(_, let direction), .child(_, let direction), .text(_, let direction, _): direction
    }
  }

  var isChild: Bool { if case .child = self { true } else { false } }
  var isSibling: Bool { if case .sibling = self { true } else { false } }
  var isText: Bool { if case .text = self { true } else { false } }

  var offset: Int? { if case .text(_, _, let offset) = self { offset } else { nil } }
}

struct CaretRange: Equatable {
  var anchor: Caret
  var focus: Caret

  var direction: CaretDirection { anchor.direction }
}

/// Lexical's `TextPointCaretSlice`: the text from a caret's offset for
/// `distance` code units, negative going back.
struct TextSlice {
  var origin: NodeKey
  var direction: CaretDirection
  var offset: Int
  var distance: Int

  var caret: Caret { .text(origin, direction, offset: offset) }

  var indices: Range<Int> { min(offset, offset + distance)..<max(offset, offset + distance) }
}

extension EditorState {
  func nodeAtCaret(_ caret: Caret) -> NodeKey? {
    switch caret {
    case .child(let origin, .next): firstChild(of: origin)
    case .child(let origin, .previous): lastChild(of: origin)
    case .sibling(let origin, .next), .text(let origin, .next, _): nextSibling(of: origin)
    case .sibling(let origin, .previous), .text(let origin, .previous, _): previousSibling(of: origin)
    }
  }

  func adjacentCaret(_ caret: Caret) -> Caret? {
    nodeAtCaret(caret).map { .sibling($0, caret.direction) }
  }

  func parentAtCaret(_ caret: Caret) -> NodeKey? {
    caret.isChild ? caret.origin : parent(of: caret.origin)
  }

  func parentCaret(_ caret: Caret, _ mode: RootMode = .root) -> Caret? {
    guard let parent = parentAtCaret(caret) else { return nil }
    let stops = mode == .root ? self[parent].isRoot : self[parent].isRootOrShadowRoot
    return stops ? nil : .sibling(parent, caret.direction)
  }

  func flipped(_ caret: Caret) -> Caret {
    switch caret {
    case .text(let origin, let direction, let offset):
      return .text(origin, direction.flipped, offset: offset)
    case .sibling(let origin, let direction):
      return nodeAtCaret(caret).map { .sibling($0, direction.flipped) }
        ?? .child(parent(of: origin)!, direction.flipped)
    case .child(let origin, let direction):
      return nodeAtCaret(caret).map { .sibling($0, direction.flipped) } ?? .child(origin, direction.flipped)
    }
  }

  func childCaret(_ caret: Caret) -> Caret? {
    switch caret {
    case .child: caret
    case .sibling(let origin, let direction): self[origin].isElement ? .child(origin, direction) : nil
    case .text: nil
    }
  }

  func childCaretOrSelf(_ caret: Caret?) -> Caret? {
    caret.map { childCaret($0) ?? $0 }
  }

  func adjacentChildCaret(_ caret: Caret?) -> Caret? {
    caret.flatMap { childCaretOrSelf(adjacentCaret($0)) }
  }

  func siblingCaret(_ caret: Caret) -> Caret {
    caret.isSibling ? caret : .sibling(caret.origin, caret.direction)
  }

  func isSameNodeCaret(_ a: Caret, _ b: Caret?) -> Bool {
    guard let b, a.direction == b.direction, a.origin == b.origin else { return false }
    return a.isChild == b.isChild
  }

  func isSamePointCaret(_ a: Caret, _ b: Caret?) -> Bool {
    guard let b else { return false }
    return a == b
  }

  func inDirection(_ caret: Caret, _ direction: CaretDirection) -> Caret {
    caret.direction == direction ? caret : flipped(caret)
  }

  /// `$getTextNodeOffset` for a direction: the end a caret facing it leaves.
  func textOffset(_ key: NodeKey, _ direction: CaretDirection) -> Int {
    direction == .next ? textSize(of: key) : 0
  }

  func textCaret(_ key: NodeKey, _ direction: CaretDirection, at end: CaretDirection) -> Caret {
    .text(key, direction, offset: textOffset(key, end))
  }

  func caret(from point: SelectionPoint, _ direction: CaretDirection) throws -> Caret {
    try caret(from: point.value, direction)
  }

  /// `$caretFromPoint`, which refuses a point its node can't hold, as
  /// Lexical's development build does.
  func caret(from point: KeyPoint, _ direction: CaretDirection) throws -> Caret {
    guard let node = nodes[point.key] else {
      throw EditorError.invalidState("$caretFromPoint: no node with key \(point.key)")
    }
    guard point.type == .text else {
      guard node.isElement else { throw EditorError.invalidState("$caretFromPoint: element point in a leaf") }
      return childCaret(at: point.offset, in: point.key, direction)
    }
    guard node.isText, (0...textSize(of: point.key)).contains(point.offset) else {
      throw EditorError.invalidState("$getTextNodeOffset: invalid offset \(point.offset) at key \(point.key)")
    }
    return .text(point.key, direction, offset: point.offset)
  }

  func childCaret(at index: Int, in parent: NodeKey, _ direction: CaretDirection) -> Caret {
    var caret = Caret.child(parent, .next)
    for _ in 0..<index {
      guard let next = adjacentCaret(caret) else { break }
      caret = next
    }
    return inDirection(caret, direction)
  }

  func rewind(_ caret: Caret) -> Caret {
    let direction = caret.direction
    if let origin = nodeAtCaret(.sibling(caret.origin, direction.flipped)) {
      return .sibling(origin, direction)
    }
    return .child(parent(of: caret.origin)!, direction)
  }

  func isCaretAttached(_ caret: Caret?) -> Bool {
    caret.map { isAttached($0.origin) } ?? false
  }

  // MARK: Normalizing

  func deepestChildOrSelf(_ caret: Caret) -> Caret {
    var caret = caret
    while caret.isChild, let adjacent = adjacentChildCaret(caret), adjacent.isChild {
      caret = adjacent
    }
    return caret
  }

  func normalize(_ caret: Caret) -> Caret {
    let caret = deepestChildOrSelf(caret)
    let direction = caret.direction
    if self[caret.origin].isText {
      return caret.isText ? caret : textCaret(caret.origin, direction, at: direction)
    }
    if let adjacent = adjacentCaret(caret), self[adjacent.origin].isText {
      return textCaret(adjacent.origin, direction, at: direction.flipped)
    }
    return caret
  }

  func isExtendableTextCaret(_ caret: Caret) -> Bool {
    guard case .text(let origin, let direction, let offset) = caret else { return false }
    return offset != textOffset(origin, direction)
  }

  // MARK: Ranges

  func extendToRange(_ anchor: Caret) -> CaretRange {
    CaretRange(anchor: anchor, focus: inDirection(.child(Self.rootKey, anchor.direction.flipped), anchor.direction))
  }

  func inDirection(_ range: CaretRange, _ direction: CaretDirection) -> CaretRange {
    range.direction == direction
      ? range : CaretRange(anchor: inDirection(range.focus, direction), focus: inDirection(range.anchor, direction))
  }

  func isCollapsed(_ range: CaretRange) -> Bool { isSamePointCaret(range.anchor, range.focus) }

  func textSlices(_ range: CaretRange) -> (TextSlice?, TextSlice?) {
    func slice(_ caret: Caret, isFocus: Bool) -> TextSlice? {
      guard case .text(let origin, let direction, let offset) = caret else { return nil }
      let end = textOffset(origin, isFocus ? direction.flipped : direction)
      return TextSlice(origin: origin, direction: direction, offset: offset, distance: end - offset)
    }
    let anchor = slice(range.anchor, isFocus: false)
    let focus = slice(range.focus, isFocus: true)
    if let anchor, let focus, isSameNodeCaret(anchor.caret, focus.caret) {
      return (
        TextSlice(
          origin: anchor.origin, direction: anchor.direction, offset: anchor.offset,
          distance: focus.offset - anchor.offset),
        nil
      )
    }
    return (anchor, focus)
  }

  /// `CaretRange.iterNodeCarets`, lazily, over this state as it is now.
  func nodeCarets(_ range: CaretRange, _ mode: RootMode = .root) -> NodeCarets {
    NodeCarets(state: self, range: range, mode: mode)
  }

  // MARK: Order

  func compareNext(_ a: Caret, _ b: Caret) -> Int {
    switch commonAncestor(a.origin, b.origin) {
    case .same:
      if case .text(_, _, let aOffset) = a, case .text(_, _, let bOffset) = b {
        return aOffset < bOffset ? -1 : aOffset > bOffset ? 1 : 0
      }
      if a.isText == b.isText && a.isChild == b.isChild { return 0 }
      if a.isText { return -1 }
      if b.isText { return 1 }
      return a.isChild ? -1 : 1
    case .ancestor: return a.isChild ? -1 : 1
    case .descendant: return b.isChild ? 1 : -1
    case .branch(let aChild, let bChild): return branchOrder(aChild, bChild)
    case nil: preconditionFailure("Carets in different trees")
    }
  }

  enum CommonAncestor {
    case same
    /// `a` is an ancestor of `b`.
    case ancestor
    case descendant
    /// The children of the common ancestor that `a` and `b` are in.
    case branch(NodeKey, NodeKey)
  }

  func commonAncestor(_ a: NodeKey, _ b: NodeKey) -> CommonAncestor? {
    if a == b { return .same }
    func start(_ key: NodeKey) -> (NodeKey?, NodeKey?) {
      self[key].isElement ? (key, nil) : (parent(of: key), key)
    }
    var aChildren: [NodeKey: NodeKey?] = [:]
    var (ancestor, child) = start(a)
    while let current = ancestor {
      aChildren[current] = child
      child = current
      ancestor = parent(of: current)
    }
    (ancestor, child) = start(b)
    while let current = ancestor {
      if let aChild = aChildren[current] {
        guard let aChild else { return .ancestor }
        guard let child else { return .descendant }
        return .branch(aChild, child)
      }
      child = current
      ancestor = parent(of: current)
    }
    return nil
  }

  func branchOrder(_ a: NodeKey, _ b: NodeKey) -> Int {
    var na: NodeKey? = a
    var nb: NodeKey? = b
    while let x = na, let y = nb {
      if x == b { return -1 }
      if y == a { return 1 }
      na = nextSibling(of: x)
      nb = nextSibling(of: y)
    }
    return na == nil ? 1 : -1
  }

  func isBefore(_ a: SelectionPoint, _ b: SelectionPoint) throws -> Bool {
    if a.key == b.key { return a.offset < b.offset }
    return compareNext(normalize(try caret(from: a, .next)), normalize(try caret(from: b, .next))) < 0
  }

  func isBackward(_ selection: RangeSelection) throws -> Bool { try isBefore(selection.focus, selection.anchor) }

  /// The selection's points in document order.
  func startEnd(_ selection: RangeSelection) throws -> (start: SelectionPoint, end: SelectionPoint) {
    try isBackward(selection) ? (selection.focus, selection.anchor) : (selection.anchor, selection.focus)
  }

  func caretRange(from selection: RangeSelection) throws -> CaretRange {
    let anchor = try caret(from: selection.anchor, .next)
    let focus = try caret(from: selection.focus, .next)
    let direction: CaretDirection = compareNext(anchor, focus) <= 0 ? .next : .previous
    return CaretRange(anchor: inDirection(anchor, direction), focus: inDirection(focus, direction))
  }
}

struct NodeCarets: Sequence, IteratorProtocol {
  private let state: EditorState
  private let focus: Caret
  private let mode: RootMode
  private var current: Caret?

  init(state: EditorState, range: CaretRange, mode: RootMode) {
    self.state = state
    self.mode = mode
    let anchor = range.anchor.isText ? state.siblingCaret(range.anchor) : range.anchor
    focus = range.focus
    current = nil
    current = state.isSameNodeCaret(anchor, focus) ? nil : step(anchor)
  }

  private func step(_ caret: Caret) -> Caret? {
    state.isSameNodeCaret(caret, focus)
      ? nil : state.adjacentChildCaret(caret) ?? state.parentCaret(caret, mode)
  }

  mutating func next() -> Caret? {
    guard let caret = current, !(focus.isText && state.isSameNodeCaret(focus, caret)) else { return nil }
    current = step(caret)
    return caret
  }
}
