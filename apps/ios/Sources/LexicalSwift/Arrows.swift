/// The arrow keys, as `arrow` in `reference/entry.ts` has a browser take
/// them: each table's handler, then rich text's, and where neither takes
/// the key, the platform's move.
extension Update {
  /// The key event the handlers read, and what they leave in it.
  struct ArrowEvent {
    let shiftKey: Bool
    let parentRTL: Bool
    let anchorRTL: Bool
    /// The command's.
    let atCellEdge: Bool
    let native: Point
    var defaultPrevented = false
    /// `TableObservers`' flag for scrolling tables: Down from before a
    /// table names it, for the selection change after the key to check.
    var tableToCheck: NodeKey?

    /// `stopEvent`.
    mutating func stop() { defaultPrevented = true }
  }

  enum ArrowDirection { case backward, forward, up, down }

  /// `arrow` in `reference/entry.ts`.
  mutating func arrow(_ key: ArrowKey, extend: Bool, native: Point, atCellEdge: Bool, parentRTL: Bool, anchorRTL: Bool) throws {
    let before = selection?.clone()
    let wereNodesSelected = nodeSelection != nil
    var event = ArrowEvent(shiftKey: extend, parentRTL: parentRTL, anchorRTL: anchorRTL, atCellEdge: atCellEdge, native: native)
    let direction: ArrowDirection =
      switch key {
      case .left: .backward
      case .right: .forward
      case .up: .up
      case .down: .down
      }
    var handled = false
    for table in tables() {
      handled = try handleArrowKey(&event, direction, table, grid(table))
      if handled { break }
    }
    if !handled {
      try structuralArrow(key)
      handled = try richTextArrow(&event, key)
    }
    if !handled, !event.defaultPrevented {
      // Rich text turns selected nodes into the range the platform extends,
      // and where it leaves them selected the platform shows no caret to move.
      if wereNodesSelected, nodeSelection != nil { return }
      let extended = wereNodesSelected ? selection : before
      let anchor = extend ? extended.flatMap { state.point($0.anchor.value) } ?? native : native
      try placeSelection(anchor, native)
    } else if try !reselect(before) {
      return
    }
    if let table = event.tableToCheck, try checkSelectionForTable(table, before) {
      _ = try reselect(before)
    }
  }

  /// `$reselect` in `reference/entry.ts`: the selection change a browser
  /// has after Lexical moves a range. False where there was none.
  private mutating func reselect(_ before: RangeSelection?) throws -> Bool {
    guard let selection else { return false }
    let state = self.state
    let inText = { (point: SelectionPoint) in
      point.type == .text && point.offset != 0 && point.offset != state.textSize(of: point.key)
    }
    if let before, before.anchor.is(selection.anchor), before.focus.is(selection.focus) { return false }
    if inText(selection.anchor), inText(selection.focus) { return false }
    guard let anchor = state.point(selection.anchor.value), let focus = state.point(selection.focus.value) else {
      return false
    }
    try placeSelection(anchor, focus)
    return true
  }

  // MARK: Rich text

  /// Rich text's KEY_ARROW handlers: selected nodes are left, or with Shift
  /// made a range, which the handlers for a range then take.
  private mutating func richTextArrow(_ event: inout ArrowEvent, _ key: ArrowKey) throws -> Bool {
    if let nodes = nodeSelection {
      let selected = self.nodes(in: nodes)
      let backward = key == .up || (key == .left && !event.parentRTL) || (key == .right && event.parentRTL)
      let direction: CaretDirection = backward ? .previous : .next
      if let first = selected.first, try !(event.shiftKey && convertContiguousNodeSelection(selected, direction)) {
        event.defaultPrevented = true
        exitNodeSelection(toward: first, direction)
        return true
      }
    }
    guard let selection else { return false }
    let root = EditorState.rootKey
    switch key {
    case .up, .down:
      let atRootEdge =
        selection.focus.key == root && selection.focus.offset == (key == .up ? 0 : state.childCount(of: root))
      let handled =
        try atRootEdge
        || !event.shiftKey && tryBlockCursorShadowRootNavigation(selection, key == .up ? .previous : .next)
        || !event.shiftKey && tryDecoratorLineNavigation(selection, key == .up ? .previous : .next, event.native)
      if handled { event.defaultPrevented = true }
      return handled
    case .left, .right:
      let direction: CaretDirection = (key == .left) != event.parentRTL ? .previous : .next
      let handled =
        try isBlockCursorAtRootEdge(selection, direction)
        || !event.shiftKey && tryBlockCursorShadowRootNavigation(selection, direction)
      if handled {
        event.defaultPrevented = true
        return true
      }
      let backward = (key == .left) != event.anchorRTL
      guard try shouldOverrideDefaultCharacterSelection(selection, backward: backward) else { return false }
      event.defaultPrevented = true
      if try !modifyAroundDecoratorsAndBlocks(selection, move: !event.shiftKey, backward: backward, .character) {
        try moveNatively(selection, event, backward: backward)
      }
      return true
    }
  }

  /// `$exitNodeSelectionToward`: to beside the node, where a table is next
  /// to it, or else into what's next to it.
  private mutating func exitNodeSelection(toward node: NodeKey, _ direction: CaretDirection) {
    let sibling = direction == .next ? state.nextSibling(of: node) : state.previousSibling(of: node)
    if let sibling, state[sibling].isElement, !state[sibling].isInline, state[sibling].isShadowRoot {
      let caret = Caret.sibling(node, direction)
      setSelection(from: CaretRange(anchor: caret, focus: caret))
    } else if direction == .next {
      selectNext(node, 0, 0)
    } else {
      selectPrevious(node)
    }
  }

  /// `$convertContiguousNodeSelection`: selected siblings side by side
  /// become the range over them, facing `direction`. False where they
  /// aren't side by side.
  private mutating func convertContiguousNodeSelection(_ nodes: [NodeKey], _ direction: CaretDirection) throws -> Bool {
    var carets = nodes.map { Caret.sibling($0, .next) }
    var sortError: (any Error)?
    carets.sort { a, b in
      do { return try state.compareNext(a, b) < 0 } catch {
        sortError = error
        return false
      }
    }
    if let sortError { throw sortError }
    guard let first = carets.first, let last = carets.last else { return false }
    for (caret, next) in zip(carets, carets.dropFirst()) where state.nodeAtCaret(caret) != next.origin {
      return false
    }
    setSelection(from: state.inDirection(CaretRange(anchor: state.rewind(first), focus: last), direction))
    return true
  }

  /// `$isBlockCursorAtRootEdge`.
  private func isBlockCursorAtRootEdge(_ selection: RangeSelection, _ direction: CaretDirection) -> Bool {
    let root = EditorState.rootKey
    let focus = selection.focus
    guard selection.isCollapsed, focus.key == root,
      focus.offset == (direction == .next ? state.childCount(of: root) : 0)
    else { return false }
    let beside = state.child(of: root, at: direction == .next ? focus.offset - 1 : focus.offset)
    return beside.map(needsBlockCursorBeside) ?? false
  }

  private func isShadowRootNode(_ key: NodeKey) -> Bool { state[key].isElement && state[key].isShadowRoot }

  /// `$tryBlockCursorShadowRootNavigation`.
  private mutating func tryBlockCursorShadowRootNavigation(_ selection: RangeSelection, _ direction: CaretDirection)
    throws -> Bool
  {
    try tryExitShadowRootToBlockCursor(selection, direction) || tryEnterFromBlockCursor(selection, direction)
  }

  /// `$tryEnterFromBlockCursor`: from beside a table, into its first or
  /// last cell.
  private mutating func tryEnterFromBlockCursor(_ selection: RangeSelection, _ direction: CaretDirection) throws
    -> Bool
  {
    guard selection.isCollapsed, selection.anchor.type == .element else { return false }
    let caret = try state.caret(from: selection.anchor, direction)
    guard let child = state.nodeAtCaret(caret), isShadowRootNode(child), !state[child].isInline else {
      return false
    }
    let inside = state.normalize(.child(child, direction))
    updateSelection(selection, from: CaretRange(anchor: inside, focus: inside))
    setSelection(selection)
    return true
  }

  /// `$tryExitShadowRootToBlockCursor`: from the edge of a shadow root, to
  /// beside it where what's past it needs a block cursor.
  private mutating func tryExitShadowRootToBlockCursor(_ selection: RangeSelection, _ direction: CaretDirection)
    throws -> Bool
  {
    guard selection.isCollapsed else { return false }
    let focusCaret = try state.caret(from: selection.focus, direction)
    guard let shadowRoot = findParent(from: focusCaret.origin, where: isShadowRootNode) else { return false }
    let focusNode = selection.focus.key
    guard shadowRoot == focusNode || hasAncestor(focusNode, shadowRoot) else { return false }
    let textRange = CaretRange(anchor: focusCaret, focus: .sibling(shadowRoot, direction))
    let (first, second) = state.textSlices(textRange)
    if [first, second].contains(where: { $0.map { $0.distance != 0 } ?? false }) { return false }
    let range = CaretRange(anchor: state.siblingCaret(textRange.anchor), focus: textRange.focus)
    var previousOrigin = range.anchor.origin
    for caret in state.nodeCarets(range) {
      guard caret.isSibling, caret.origin == state.parent(of: previousOrigin) else { return false }
      previousOrigin = caret.origin
    }
    var previousShadow = shadowRoot
    for caret in state.nodeCarets(state.extendToRange(.sibling(shadowRoot, direction))) {
      if caret.origin == state.parent(of: previousShadow) {
        guard isShadowRootNode(caret.origin) else { break }
        previousShadow = caret.origin
        continue
      }
      if needsBlockCursorBeside(caret.origin) {
        let beside = Caret.sibling(previousShadow, direction)
        updateSelection(selection, from: CaretRange(anchor: beside, focus: beside))
        setSelection(selection)
        return true
      }
      break
    }
    return false
  }

  /// `$tryDecoratorLineNavigation`: from an empty block, or from beside
  /// it in a root, onto the block decorator a line up or down reaches.
  /// From a block with text it asks the DOM's selection whether
  /// the line move leaves the block, which `native` answers, as in
  /// `reference/entry.ts`. `$tryInlineGridLineNavigation`, which runs next,
  /// finds no inline element the web displays as a grid.
  private mutating func tryDecoratorLineNavigation(
    _ selection: RangeSelection, _ direction: CaretDirection, _ native: Point
  ) throws -> Bool {
    guard selection.isCollapsed else { return false }
    let (focus, state) = (selection.focus, self.state)
    let isSelectableBlockDecorator = { (key: NodeKey) in state[key].isDecorator && !state[key].isInline }
    if focus.type == .element, state[focus.key].isRootOrShadowRoot {
      guard let child = state.nodeAtCaret(try state.caret(from: focus, direction)), isSelectableBlockDecorator(child)
      else { return false }
      selectNode(child)
      return true
    }
    let start = state[focus.key].isElement ? focus.key : state.parent(of: focus.key)
    let isTopBlock = { (key: NodeKey) in
      state[key].isElement && !state[key].isInline && (state.parent(of: key).map { state[$0].isRootOrShadowRoot } ?? false)
    }
    guard let start, let block = findParent(from: start, where: isTopBlock),
      let sibling = direction == .next ? state.nextSibling(of: block) : state.previousSibling(of: block),
      isSelectableBlockDecorator(sibling)
    else { return false }
    if !state.textContent(of: block).isEmpty, native != state.point(focus.value) {
      if findParent(from: try pointNode(native), where: { $0 == block }) != nil { return false }
    }
    selectNode(sibling)
    return true
  }

  /// `$shouldOverrideDefaultCharacterSelection`, with physical direction already resolved.
  private func shouldOverrideDefaultCharacterSelection(_ selection: RangeSelection, backward isBackward: Bool) throws
    -> Bool
  {
    let focusCaret = try state.caret(from: selection.focus, isBackward ? .previous : .next)
    if state.isExtendableTextCaret(focusCaret) { return false }
    if focusCaret.isText, !isTab(focusCaret.origin), state[focusCaret.origin].isUnmergeable,
      let sibling = state.nodeAtCaret(focusCaret), state[sibling].isText, !isTab(sibling)
    {
      return true
    }
    for caret in state.nodeCarets(state.extendToRange(focusCaret)) {
      if caret.isChild { return !state[caret.origin].isInline }
      if state[caret.origin].isElement { continue }
      if state[caret.origin].isDecorator { return true }
      break
    }
    return false
  }

  private func isTab(_ key: NodeKey) -> Bool { state[key].type == "tab" }

  /// The rest of `RangeSelection.modify` after the platform moves its focus
  /// to the event's `native`, as `$moveNatively` in `reference/entry.ts`.
  private mutating func moveNatively(_ selection: RangeSelection, _ event: ArrowEvent, backward isBackward: Bool)
    throws
  {
    let native = KeyPoint(key: try pointNode(event.native), offset: event.native.offset, type: event.native.type)
    guard event.shiftKey else {
      try applyRange(selection, native, native)
      selection.dirty = true
      return
    }
    let anchorNode = selection.anchor.key
    let root = state[anchorNode].isRoot ? anchorNode : nearestRootOrShadowRoot(anchorNode)
    let moved = selection.clone()
    moved.focus.set(native)
    let anchorIsAtStart = try !state.isBackward(moved)
    let anchor = selection.anchor.value
    try applyRange(selection, anchorIsAtStart ? anchor : native, anchorIsAtStart ? native : anchor)
    selection.dirty = true
    _ = try shrinkToRoot(selection, backward: isBackward, root)
    if !anchorIsAtStart { swapPoints(selection) }
  }
}
