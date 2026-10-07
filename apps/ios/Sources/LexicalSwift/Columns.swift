/// The column helpers of @packages/lexical-nodes (`columns.ts`) and
/// LayoutPlugin's commands that use them (#252).
extension Update {
  func isColumn(_ key: NodeKey?) -> Bool { key.map { state[$0].type == SerializedLayoutItemNode.type } ?? false }
  func isColumns(_ key: NodeKey?) -> Bool { key.map { state[$0].type == SerializedLayoutContainerNode.type } ?? false }

  /// `$columnOf`: the innermost column holding `key`.
  func columnOf(_ key: NodeKey) -> NodeKey? {
    findParent(from: key, where: { isColumn($0) && isColumns(state.parent(of: $0)) })
  }

  /// `$isEmptyColumn`: nothing, or just the empty line a new column starts with.
  func isEmptyColumn(_ column: NodeKey) -> Bool {
    let children = state.children(of: column)
    guard let only = children.first else { return true }
    return children.count == 1 && state[only].type == SerializedParagraphNode.type && isEmpty(only)
  }

  private func templateColumns(_ container: NodeKey) -> String {
    guard case .layoutContainer(let node) = state[container].payload else { return "" }
    return node.templateColumns?.stringValue ?? ""
  }

  private mutating func setTemplateColumns(_ container: NodeKey, _ template: String) {
    modify(container) { node in
      guard case .layoutContainer(var value) = node.payload else { return }
      value.templateColumns = .string(template)
      node.payload = .layoutContainer(value)
    }
  }

  /// `$columnsIn`: the columns of a row, without anything stray.
  private func columnsIn(_ container: NodeKey) -> [NodeKey] { state.children(of: container).filter(isColumn) }

  /// `$plainTracks`: the template's tracks when it is a plain list of one
  /// per column.
  private func plainTracks(_ container: NodeKey) -> [String]? {
    let tracks = JSRegExp("\\s+", flags: "").split(templateColumns(container)).filter { !$0.isEmpty }
    guard tracks.count == columnsIn(container).count, !tracks.contains(where: { $0.contains("(") }) else {
      return nil
    }
    return tracks
  }

  /// `$dropColumn`: takes the column out of its row with its track.
  private mutating func dropColumn(_ column: NodeKey) throws {
    guard let container = state.parent(of: column) else { return }
    let tracks = plainTracks(container)
    let index = columnsIn(container).firstIndex(of: column)
    try remove(column)
    let count = columnsIn(container).count
    let kept = tracks.map { tracks in tracks.indices.filter { $0 != index }.map { tracks[$0] } }
    setTemplateColumns(container, (kept ?? Array(repeating: "1fr", count: count)).joined(separator: " "))
  }

  /// `$removeColumn`: an empty column goes, the caret to the end of the
  /// column before it, or the start of the one after it for the first.
  mutating func removeColumn(_ column: NodeKey) throws {
    let previous = state.previousSibling(of: column)
    let next = state.nextSibling(of: column)
    try dropColumn(column)
    if let previous, isColumn(previous) { selectEnd(previous) } else if let next, isColumn(next) { selectStart(next) }
  }

  /// `$joinColumn`: a column's blocks onto the end of the column before it.
  mutating func joinColumn(_ column: NodeKey) throws {
    guard let previous = state.previousSibling(of: column), isColumn(previous) else { return }
    try append(previous, Array(state.children(of: column)))
    try dropColumn(column)
  }

  /// The caret's column and its first block, when the caret is at the start
  /// of that block.
  private func caretAtColumnStart(_ selection: RangeSelection) -> (column: NodeKey, block: NodeKey)? {
    let anchor = selection.anchor
    guard selection.isCollapsed, anchor.offset == 0, let column = columnOf(anchor.key),
      let block = state.firstChild(of: column)
    else { return nil }
    let first = state[block].isElement ? firstDescendant(of: block) : nil
    return anchor.key == block || anchor.key == first ? (column, block) : nil
  }

  /// The caret's column and its last block, when the caret is at the end of
  /// that block.
  private func caretAtColumnEnd(_ selection: RangeSelection) -> (column: NodeKey, block: NodeKey)? {
    let anchor = selection.anchor
    guard selection.isCollapsed, let column = columnOf(anchor.key), let block = state.lastChild(of: column) else { return nil }
    let size = state[anchor.key].isElement ? state.childCount(of: anchor.key) : state.textSize(of: anchor.key)
    let last = state[block].isElement ? lastDescendant(of: block) : nil
    return anchor.offset == size && (anchor.key == block || anchor.key == last) ? (column, block) : nil
  }

  /// `$pullNextColumn`: the column after `column` into it, an empty one
  /// removed.
  mutating func pullNextColumn(_ column: NodeKey) throws {
    guard let next = state.nextSibling(of: column), isColumn(next) else { return }
    if isEmptyColumn(next) { try dropColumn(next) } else { try joinColumn(next) }
  }

  /// LayoutPlugin's DELETE_CHARACTER_COMMAND handler.
  mutating func columnDelete(_ selection: RangeSelection, backward: Bool) throws -> Bool {
    guard backward else {
      guard let (column, block) = caretAtColumnEnd(selection),
        [SerializedParagraphNode.type, SerializedHeadingNode.type].contains(state[block].type)
      else { return false }
      try pullNextColumn(column)
      return true
    }
    guard let (column, block) = caretAtColumnStart(selection) else { return false }
    if isEmptyColumn(column) {
      try removeColumn(column)
      return true
    }
    guard [SerializedParagraphNode.type, SerializedHeadingNode.type].contains(state[block].type) else { return false }
    if state.previousSibling(of: column) != nil {
      try joinColumn(column)
    } else if let container = state.parent(of: column) {
      try unwrapColumns(container)
    }
    return true
  }

  /// `$unwrapColumns`: every column's blocks, in reading order, where the
  /// columns were.
  mutating func unwrapColumns(_ container: NodeKey) throws {
    for column in Array(state.children(of: container)) {
      for block in isColumn(column) ? Array(state.children(of: column)) : [column] { try insert(block, before: container) }
    }
    try remove(container)
  }

  /// `$repairColumns`: a row of columns has two or more and only columns,
  /// and is not in a column.
  mutating func repairColumns(_ container: NodeKey) throws {
    let columns = columnsIn(container)
    guard columns.count >= 2, !isColumn(state.parent(of: container)) else { return try unwrapColumns(container) }
    var column: NodeKey?
    var leading: [NodeKey] = []
    for child in Array(state.children(of: container)) {
      if isColumn(child) { column = child } else if let column { try append(column, [child]) } else { leading.append(child) }
    }
    let first = columns[0]
    if let head = state.firstChild(of: first) {
      for block in leading { try insert(block, before: head) }
    } else {
      try append(first, leading)
    }
  }

  /// LayoutPlugin's arrow handlers, where the platform's line move lands
  /// at `native`.
  mutating func columnArrow(_ event: inout ArrowEvent, _ key: ArrowKey) throws -> Bool {
    guard hasEditorPlugin("LayoutPlugin"), !event.shiftKey, let selection, selection.isCollapsed else { return false }
    let handled = try key == .up || key == .down ? leaveColumnsByLine(selection, key, event.native) : leaveColumnsSideways(selection, key)
    if handled { event.stop() }
    return handled
  }

  /// `$leaveColumnsByLine`.
  private mutating func leaveColumnsByLine(_ selection: RangeSelection, _ key: ArrowKey, _ native: Point) throws -> Bool {
    let backward = key == .up
    let focus = selection.focus.key
    guard let column = columnOf(focus), column != focus,
      let edge = backward ? state.firstChild(of: column) : state.lastChild(of: column),
      findParent(from: focus, where: { $0 == edge }) != nil
    else { return false }
    if !state.textContent(of: edge).isEmpty, native != state.point(selection.focus.value) {
      if findParent(from: try pointNode(native), where: { $0 == column }) != nil { return false }
    }
    guard let container = state.parent(of: column) else { return false }
    let sibling = backward ? state.previousSibling(of: container) : state.nextSibling(of: container)
    if let sibling, state[sibling].isDecorator, !state[sibling].isInline {
      selectNode(sibling)
    } else if let sibling {
      if backward { selectEnd(sibling) } else { selectStart(sibling) }
    } else {
      let line = create(SerializedParagraphNode.type)
      if backward { try insert(line, before: container) } else { try insert(line, after: container) }
      select(line)
    }
    return true
  }

  /// `$leaveColumnsSideways`.
  private mutating func leaveColumnsSideways(_ selection: RangeSelection, _ key: ArrowKey) throws -> Bool {
    let backward = key == .left
    let focus = selection.focus
    guard let column = columnOf(focus.key), let container = state.parent(of: column),
      focus.key == (backward ? firstDescendant(of: container) : lastDescendant(of: container))
    else { return false }
    let size = state[focus.key].isElement ? state.childCount(of: focus.key) : state.textSize(of: focus.key)
    guard focus.offset == (backward ? 0 : size),
      (backward ? state.previousSibling(of: container) : state.nextSibling(of: container)) == nil
    else { return false }
    let line = create(SerializedParagraphNode.type)
    if backward { try insert(line, before: container) } else { try insert(line, after: container) }
    select(line)
    return true
  }

  /// LayoutPlugin's SELECT_ALL_COMMAND handler, `$selectColumn`: what the
  /// column holds, then, where that is selected, nothing for rich text to
  /// select the document.
  mutating func selectColumn() throws -> Bool {
    guard hasEditorPlugin("LayoutPlugin"), let selection, let column = columnOf(selection.anchor.key),
      column == columnOf(selection.focus.key), let first = firstDescendant(of: column),
      let last = lastDescendant(of: column)
    else { return false }
    let state = self.state
    // A line break or inline decorator holds no point; one beside it does.
    let edge = { (key: NodeKey, atEnd: Bool) -> KeyPoint in
      let node = state[key]
      if !node.isText, !node.isElement, let parent = state.parent(of: key), let index = state.index(of: key) {
        return KeyPoint(key: parent, offset: index + (atEnd ? 1 : 0), type: .element)
      }
      let offset = !atEnd ? 0 : node.isElement ? state.childCount(of: key) : state.textSize(of: key)
      return KeyPoint(key: key, offset: offset, type: node.isText ? .text : .element)
    }
    let start = edge(first, false)
    let end = edge(last, true)
    let (from, to) = try state.startEnd(selection)
    if from.key == start.key, from.offset == start.offset, to.key == end.key, to.offset == end.offset { return false }
    selection.anchor.set(start)
    selection.focus.set(end)
    setSelection(selection)
    return true
  }
}
