/// `@lexical/history`: the states undo and redo go back and forth between,
/// and when an edit starts a new undo step rather than joining the last.
struct History {
  /// Edits of one kind less than this far apart are one undo step.
  static let delay = 1000

  enum ChangeType: Equatable {
    case other
    case insertCharacterAfterSelection
    case deleteCharacterBeforeSelection
    case deleteCharacterAfterSelection
  }

  /// The state undoing would leave, the loaded one to start with.
  private var current: EditorState
  private var undoStack: [EditorState] = []
  private var redoStack: [EditorState] = []
  private var previousChangeType = ChangeType.other
  private var previousChangeTime = 0

  init(_ loaded: EditorState) {
    current = loaded
  }

  /// A committed update, from `previous` to `next`, at `time`.
  mutating func record(_ update: Update, from previous: EditorState, to next: EditorState, at time: Int) {
    let changeType = Self.changeType(update, from: previous, to: next)
    let movesOnlySelection = update.dirtyLeaves.isEmpty && update.dirtyElements.isEmpty
    defer {
      previousChangeTime = time
      previousChangeType = changeType
    }
    if movesOnlySelection {
      if next.selection != nil { current = next }
      return
    }
    let merges =
      (changeType != .other && changeType == previousChangeType && time < previousChangeTime + Self.delay)
      || (update.dirtyLeaves.count == 1 && Self.isTextUnchanged(update.dirtyLeaves[0], from: previous, to: next))
    if !merges {
      redoStack = []
      undoStack.append(current)
    }
    current = next
  }

  /// The state to go back to, if there is one.
  mutating func undo(at time: Int) -> EditorState? {
    guard let entry = undoStack.popLast() else { return nil }
    redoStack.append(current)
    return restore(entry, at: time)
  }

  mutating func redo(at time: Int) -> EditorState? {
    guard let entry = redoStack.popLast() else { return nil }
    undoStack.append(current)
    return restore(entry, at: time)
  }

  private mutating func restore(_ entry: EditorState, at time: Int) -> EditorState {
    current = entry
    previousChangeType = .other
    previousChangeTime = time
    return entry
  }

  /// `getChangeType`: whether an update typed or deleted one character
  /// beside a caret, which consecutive updates merge on.
  private static func changeType(_ update: Update, from previous: EditorState, to next: EditorState) -> ChangeType {
    guard !update.dirtyLeaves.isEmpty || !update.dirtyElements.isEmpty,
      let nextSelection = next.selection, let previousSelection = previous.selection,
      nextSelection.anchor == nextSelection.focus, previousSelection.anchor == previousSelection.focus
    else { return .other }
    let dirtyNodes =
      update.dirtyLeaves.filter { next.nodes[$0] != nil }
      + update.dirtyElements.filter { $0.value && $0.key != EditorState.rootKey && next.nodes[$0.key] != nil }.map(
        \.key)
    guard let dirtyNode = dirtyNodes.first else { return .other }
    let nextAnchor = nextSelection.anchor
    let previousAnchor = previousSelection.anchor
    if dirtyNodes.count > 1 {
      guard let anchorNode = next.nodes[nextAnchor.key], next.nodes[previousAnchor.key] != nil,
        previous.nodes[nextAnchor.key] == nil, anchorNode.isText, anchorNode.text.utf16.count == 1,
        nextAnchor.offset == 1
      else { return .other }
      return .insertCharacterAfterSelection
    }
    guard let before = previous.nodes[dirtyNode]?.textNode, let after = next.nodes[dirtyNode]?.textNode,
      before.mode == after.mode, !(before.text ?? "").isIdentical(to: after.text ?? ""), nextAnchor.key == previousAnchor.key,
      nextAnchor.type == .text
    else { return .other }
    let textDiff = (after.text ?? "").utf16.count - (before.text ?? "").utf16.count
    switch (textDiff, previousAnchor.offset - nextAnchor.offset) {
    case (1, -1): return .insertCharacterAfterSelection
    case (-1, 1): return .deleteCharacterBeforeSelection
    case (-1, 0): return .deleteCharacterAfterSelection
    default: return .other
    }
  }

  /// `isTextNodeUnchanged`: the one leaf an update marked saves as it did.
  private static func isTextUnchanged(_ key: NodeKey, from previous: EditorState, to next: EditorState) -> Bool {
    if let before = previous.selection, let after = next.selection, before.anchor.type == .element,
      before.focus.type == .element, after.anchor.type == .text, after.focus.type == .text
    {
      return false
    }
    guard let before = previous.nodes[key], let after = next.nodes[key], before.isText, after.isText,
      before.parent == after.parent
    else { return false }
    return previous.json(of: key) == next.json(of: key)
  }
}
