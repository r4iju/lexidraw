/// How Lexical's node methods select nodes and keep the selection on the
/// document as they change it.
extension Update {
  /// Lexical's `$setSelection`.
  mutating func setSelection(_ selection: RangeSelection) {
    selection.dirty = true
    self.selection = selection
  }

  /// Lexical's `$internalMakeRangeSelection`.
  @discardableResult
  mutating func makeSelection(_ anchor: KeyPoint, _ focus: KeyPoint) -> RangeSelection {
    let selection = RangeSelection(
      anchor: SelectionPoint(anchor), focus: SelectionPoint(focus), format: [], style: "")
    selection.dirty = true
    self.selection = selection
    return selection
  }

  func touches(_ selection: RangeSelection, _ element: NodeKey) -> Bool {
    selection.anchor.key == element || selection.focus.key == element
  }

  // MARK: Selecting

  /// `ElementNode.select`.
  @discardableResult
  mutating func selectElement(_ key: NodeKey, _ anchorOffset: Int? = nil, _ focusOffset: Int? = nil) -> RangeSelection {
    let count = state.childCount(of: key)
    if !state[key].canBeEmpty {
      if anchorOffset == 0, focusOffset == 0 {
        if let first = state.firstChild(of: key), state[first].isText || state[first].isElement {
          return select(first, 0, 0)
        }
      } else if (anchorOffset ?? count) == count, (focusOffset ?? count) == count {
        if let last = state.lastChild(of: key), state[last].isText || state[last].isElement {
          return select(last)
        }
      }
    }
    let anchor = KeyPoint(key: key, offset: anchorOffset ?? count, type: .element)
    let focus = KeyPoint(key: key, offset: focusOffset ?? count, type: .element)
    guard let selection else { return makeSelection(anchor, focus) }
    selection.anchor.set(key, anchor.offset, .element)
    selection.focus.set(key, focus.offset, .element)
    selection.dirty = true
    return selection
  }

  /// `TextNode.select`.
  @discardableResult
  mutating func selectText(_ key: NodeKey, _ anchorOffset: Int? = nil, _ focusOffset: Int? = nil) -> RangeSelection {
    let size = state.textSize(of: key)
    let anchor = KeyPoint(key: key, offset: anchorOffset ?? size, type: .text)
    let focus = KeyPoint(key: key, offset: focusOffset ?? size, type: .text)
    guard let selection else { return makeSelection(anchor, focus) }
    selection.setTextNodeRange(key, anchor.offset, key, focus.offset)
    return selection
  }

  /// `select` on a text or element node.
  @discardableResult
  mutating func select(_ key: NodeKey, _ anchorOffset: Int? = nil, _ focusOffset: Int? = nil) -> RangeSelection {
    state[key].isText ? selectText(key, anchorOffset, focusOffset) : selectElement(key, anchorOffset, focusOffset)
  }

  @discardableResult
  mutating func selectStart(_ key: NodeKey) -> RangeSelection {
    let node = state[key]
    if node.isElement {
      return firstDescendant(of: key).map { selectStart($0) } ?? selectElement(key)
    }
    return node.isText ? selectText(key, 0, 0) : selectPrevious(key)
  }

  @discardableResult
  mutating func selectEnd(_ key: NodeKey) -> RangeSelection {
    let node = state[key]
    if node.isElement {
      return lastDescendant(of: key).map { selectEnd($0) } ?? selectElement(key)
    }
    if node.isText {
      let size = state.textSize(of: key)
      return selectText(key, size, size)
    }
    return selectNext(key, 0, 0)
  }

  /// `LexicalNode.selectPrevious`.
  @discardableResult
  mutating func selectPrevious(_ key: NodeKey, _ anchorOffset: Int? = nil, _ focusOffset: Int? = nil)
    -> RangeSelection
  {
    let parent = state[key].parent!
    guard let previous = state.previousSibling(of: key) else { return selectElement(parent, 0, 0) }
    if state[previous].isElement { return selectElement(previous) }
    if !state[previous].isText {
      let index = state.index(of: previous)! + 1
      return selectElement(parent, index, index)
    }
    return selectText(previous, anchorOffset, focusOffset)
  }

  /// `LexicalNode.selectNext`.
  @discardableResult
  mutating func selectNext(_ key: NodeKey, _ anchorOffset: Int? = nil, _ focusOffset: Int? = nil) -> RangeSelection {
    let parent = state[key].parent!
    guard let next = state.nextSibling(of: key) else { return selectElement(parent) }
    if state[next].isElement { return selectElement(next, 0, 0) }
    if !state[next].isText {
      let index = state.index(of: next)!
      return selectElement(parent, index, index)
    }
    return selectText(next, anchorOffset, focusOffset)
  }

  func firstDescendant(of key: NodeKey) -> NodeKey? {
    var node = state.firstChild(of: key)
    while let current = node, state[current].isElement, let child = state.firstChild(of: current) {
      node = child
    }
    return node
  }

  func lastDescendant(of key: NodeKey) -> NodeKey? {
    var node = state.lastChild(of: key)
    while let current = node, state[current].isElement, let child = state.lastChild(of: current) {
      node = child
    }
    return node
  }

  // MARK: Keeping the selection in the document

  /// Lexical's `$maybeMoveChildrenSelectionToParent`, for a node about to go.
  mutating func moveChildrenSelectionToParent(_ node: NodeKey) -> RangeSelection? {
    guard let selection, state[node].isElement else { return selection }
    for point in [selection.anchor, selection.focus] where hasAncestor(point.key, node) {
      point.set(node, 0, .element)
    }
    return selection
  }

  func hasAncestor(_ key: NodeKey, _ ancestor: NodeKey) -> Bool {
    var parent = state.parent(of: key)
    while let current = parent {
      if current == ancestor { return true }
      parent = state.parent(of: current)
    }
    return false
  }

  /// Lexical's `moveSelectionPointToSibling`.
  func moveSelectionPoint(
    _ point: SelectionPoint, toSiblingOf node: NodeKey, in parent: NodeKey, previous: NodeKey?, next: NodeKey?
  ) {
    if let previous, state[previous].isText {
      point.set(previous, state.textSize(of: previous), .text)
    } else if let previous, state[previous].isElement {
      point.set(previous, state.childCount(of: previous), .element)
    } else if previous == nil, let next, state[next].isText || state[next].isElement {
      point.set(next, 0, state[next].isText ? .text : .element)
    } else {
      point.set(parent, state.index(of: node) ?? state.childCount(of: parent), .element)
    }
  }

  /// Lexical's `$moveSelectionPointToEnd`.
  func movePoint(_ point: SelectionPoint, toEndOf node: NodeKey) {
    if state[node].isElement, let last = lastDescendant(of: node), state[last].isElement || state[last].isText {
      selectPoint(point, on: last)
    } else {
      selectPoint(point, on: node)
    }
  }

  /// `selectPointOnNode` from LexicalSelection.
  private func selectPoint(_ point: SelectionPoint, on node: NodeKey) {
    var key = node
    var offset = point.offset
    var type = Point.Kind.element
    if state[node].isText {
      type = .text
      offset = min(offset, state.textSize(of: node))
    } else if !state[node].isElement {
      if let next = state.nextSibling(of: node), state[next].isText {
        key = next
        offset = 0
        type = .text
      } else if let parent = state.parent(of: node) {
        key = parent
        offset = state.index(of: node)! + 1
      }
    }
    point.set(key, offset, type)
  }

  /// Lexical's `$updateElementSelectionOnCreateDeleteNode`: element points in
  /// `parent` shift by `times` children created (or, negative, deleted) at
  /// `offset`.
  func updateElementSelection(
    _ selection: RangeSelection, onCreatingOrDeletingIn parent: NodeKey, at offset: Int, times: Int
  ) throws {
    guard touches(selection, parent) else { return }
    let shifts = { (pointOffset: Int) in
      (offset <= pointOffset && times > 0) || (offset < pointOffset && times < 0)
    }
    if selection.isCollapsed {
      let pointOffset = selection.anchor.offset
      if shifts(pointOffset) {
        let shifted = max(0, pointOffset + times)
        selection.anchor.set(parent, shifted, .element)
        selection.focus.set(parent, shifted, .element)
        resolveTextNodes(selection)
      }
    } else {
      let (first, last) = try state.startEnd(selection)
      for point in [first, last] where point.key == parent && shifts(point.offset) {
        point.set(parent, max(0, point.offset + times), .element)
      }
    }
    resolveTextNodes(selection)
  }

  /// Lexical's `$updateSelectionResolveTextNodes`: element points beside text
  /// move into it.
  private func resolveTextNodes(_ selection: RangeSelection) {
    let resolve = { (point: SelectionPoint, others: [SelectionPoint]) in
      guard self.state[point.key].isElement else { return }
      let count = self.state.childCount(of: point.key)
      let atEnd = point.offset >= count
      guard let child = self.state.child(of: point.key, at: atEnd ? count - 1 : point.offset),
        self.state[child].isText
      else { return }
      let offset = atEnd ? self.state.textSize(of: child) : 0
      for point in [point] + others { point.set(child, offset, .text) }
    }
    if selection.isCollapsed {
      resolve(selection.anchor, [selection.focus])
      return
    }
    resolve(selection.anchor, [])
    resolve(selection.focus, [])
  }

  // MARK: Text

  /// Lexical's `$createTextNode`.
  mutating func createText(_ text: String, format: TextFormat = [], style: String = "") -> NodeKey {
    let key = create(SerializedTextNode.type)
    guard case .text(var node) = state[key].payload else { return key }
    node.text = text
    node.format = Double(format.rawValue)
    node.style = style
    state.nodes[key]!.payload = .text(node)
    return key
  }

  func format(of key: NodeKey) -> TextFormat { TextFormat(rawValue: Int(state[key].textNode?.format ?? 0)) }

  func style(of key: NodeKey) -> String { state[key].textNode?.style ?? "" }

  mutating func setFormat(_ key: NodeKey, _ format: TextFormat) {
    modifyText(key) { $0.format = Double(format.rawValue) }
  }

  mutating func setStyle(_ key: NodeKey, _ style: String) {
    modifyText(key) { $0.style = style }
  }

  private mutating func modifyText(_ key: NodeKey, _ change: (inout SerializedTextNode) -> Void) {
    guard case .text(var node) = state[key].payload else { return }
    change(&node)
    modify(key) { $0.payload = .text(node) }
  }

  /// Lexical's `TextNode.spliceText`.
  mutating func spliceText(_ key: NodeKey, at offset: Int, deleting count: Int, inserting text: String, movingSelection: Bool)
  {
    markDirty(key)
    if movingSelection, let selection {
      let caret = offset + text.utf16.count
      selection.setTextNodeRange(key, caret, key, caret)
    }
    let units = Array(state[key].text.utf16)
    let end = min(offset + count, units.count)
    let spliced = Array(units[..<offset]) + Array(text.utf16) + Array(units[end...])
    guard case .text(var node) = state[key].payload else { return }
    node.text = String(decoding: spliced, as: UTF16.self)
    state.nodes[key]!.payload = .text(node)
  }

  /// Lexical's `TextNode.splitText`: the node keeps the first part and new
  /// nodes like it take the rest, with the selection's points following
  /// their text.
  @discardableResult
  mutating func splitText(_ key: NodeKey, at offsets: [Int]) throws -> [NodeKey] {
    let units = Array(state[key].text.utf16)
    guard !units.isEmpty else { return [] }
    var parts: [ArraySlice<UTF16.CodeUnit>] = []
    var start = 0
    for end in offsets.sorted() + [units.count] where end > start && start < units.count {
      parts.append(units[start..<min(end, units.count)])
      start = end
    }
    guard parts.count > 1 else { return [key] }
    let parent = state[key].parent
    var startPoint: SelectionPoint?
    var endPoint: SelectionPoint?
    let selection = selection
    if let selection {
      let (first, last) = try state.startEnd(selection)
      if first.type == .text, first.key == key { startPoint = first }
      if last.type == .text, last.key == key { endPoint = last }
    }
    try setText(key, String(decoding: parts[0], as: UTF16.self))
    var nodes = [key]
    for part in parts.dropFirst() {
      guard case .text(var payload) = state[key].payload else { break }
      payload.text = String(decoding: part, as: UTF16.self)
      payload.mode = .normal
      nodes.append(create(.text(payload), type: SerializedTextNode.type, children: nil))
    }
    let originalStart = startPoint?.offset
    let originalEnd = endPoint?.offset
    var nodeStart = 0
    for node in nodes {
      guard startPoint != nil || endPoint != nil else { break }
      let nodeEnd = nodeStart + state.textSize(of: node)
      if let point = startPoint, let offset = originalStart, (nodeStart...nodeEnd).contains(offset) {
        point.set(node, offset - nodeStart, .text)
        if offset < nodeEnd { startPoint = nil }
      }
      if let point = endPoint, let offset = originalEnd, (nodeStart...nodeEnd).contains(offset) {
        point.set(node, offset - nodeStart, .text)
        break
      }
      nodeStart = nodeEnd
    }
    if let parent {
      if let previous = state.previousSibling(of: key) { markDirty(previous) }
      if let next = state.nextSibling(of: key) { markDirty(next) }
      markDirty(parent)
      let index = state.index(of: key)!
      try splice(parent, index, deleting: 1, inserting: nodes)
      if let selection {
        try updateElementSelection(selection, onCreatingOrDeletingIn: parent, at: index, times: parts.count - 1)
      }
    }
    return nodes
  }

  /// Lexical's `TextNode.mergeWithSibling`: `node` takes `target`'s text, and
  /// the selection's points in `target` with it.
  mutating func merge(_ node: NodeKey, with target: NodeKey) throws -> NodeKey {
    let isBefore = target == state.previousSibling(of: node)
    guard isBefore || target == state.nextSibling(of: node) else {
      throw EditorError.invalidState("mergeWithSibling: sibling must be a previous or next sibling")
    }
    let text = state[node].text
    if let selection {
      for point in [selection.anchor, selection.focus] where point.key == target {
        if point.type == .text {
          point.set(node, point.offset + (isBefore ? 0 : text.utf16.count), .text)
        } else if point.offset > state.index(of: target) ?? -1 {
          point.set(point.key, point.offset - 1, .element)
        }
      }
    }
    try setText(node, isBefore ? state[target].text + text : text + state[target].text)
    markDirty(node)
    try remove(target)
    return node
  }
}
