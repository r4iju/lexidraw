/// Each table's arrow key handler, `$handleArrowKey` from @lexical/table, as
/// `reference/tables.ts` copies it.
extension Update {
  /// `TableDOMTable`: a table's cells where `getTable` walks them, by their
  /// place in their row rather than their column, with nil where the walk
  /// records no cell.
  struct Grid {
    var columns = 0
    var rows = 0
    var domRows: [[NodeKey?]?] = []

    fileprivate mutating func put(_ cell: NodeKey, _ x: Int, _ y: Int) {
      while domRows.count <= y { domRows.append(nil) }
      var row = domRows[y] ?? []
      while row.count <= x { row.append(nil) }
      row[x] = cell
      domRows[y] = row
    }

    fileprivate func row(_ y: Int) -> [NodeKey?]? { domRows.indices.contains(y) ? domRows[y] : nil }

    /// `TableNode.getCordsFromCellNode`.
    fileprivate func cords(_ cell: NodeKey) throws -> (x: Int, y: Int) {
      for y in 0..<max(rows, 0) {
        guard let row = row(y) else { continue }
        if let x = row.firstIndex(of: cell) { return (x, y) }
      }
      throw EditorError.invalidState("Cell not found in table.")
    }

    /// `TableNode.getDOMCellFromCords`, for the cell it names.
    fileprivate func cell(_ x: Int, _ y: Int) -> NodeKey? {
      guard let row = row(y), !row.isEmpty, x >= 0 else { return nil }
      return row[x < row.count ? x : row.count - 1]
    }

    /// `TableNode.getDOMCellFromCordsOrThrow`.
    fileprivate func cellOrThrow(_ x: Int, _ y: Int) throws -> NodeKey {
      guard let cell = cell(x, y) else { throw EditorError.invalidState("Cell not found at cords.") }
      return cell
    }

    /// `TableNode.getCellNodeFromCordsOrThrow`.
    fileprivate func cellNodeOrThrow(_ x: Int, _ y: Int) throws -> NodeKey {
      guard let cell = cell(x, y) else { throw EditorError.invalidState("Node at cords not TableCellNode.") }
      return cell
    }

    /// `$getObserverCellFromCellNodeOrThrow`, for the cell it names.
    fileprivate func observerCell(_ cell: NodeKey) throws -> NodeKey {
      let (x, y) = try cords(cell)
      return try cellOrThrow(x, y)
    }
  }

  /// `getTable`'s walk of a table's rows and their cells, which moves past
  /// an empty row as past a cell.
  func grid(_ table: NodeKey) -> Grid {
    var grid = Grid()
    let rows = Array(state.children(of: table))
    var x = 0
    var y = 0
    for (index, row) in rows.enumerated() {
      let cells = state[row].isElement ? Array(state.children(of: row)) : []
      let isLast = index == rows.count - 1
      if cells.isEmpty {
        if isLast { break }
        x += 1
        continue
      }
      for (i, cell) in cells.enumerated() {
        if i > 0 { x += 1 }
        if isCell(cell) { grid.put(cell, x, y) }
      }
      if isLast { break }
      y += 1
      x = 0
    }
    grid.columns = x + 1
    grid.rows = y + 1
    return grid
  }

  /// `$handleArrowKey`. The typeahead menu check, which reads the root
  /// element's attributes, is left out.
  mutating func handleArrowKey(_ event: inout ArrowEvent, _ direction: ArrowDirection, _ table: NodeKey, _ grid: Grid)
    throws -> Bool
  {
    guard isSelectionInTable(table) else {
      if let selection, let handled = try handleArrowKeyOutside(&event, direction, table, grid, selection) {
        return handled
      }
      // DOCUMENT_TABLE_PLUGIN turns on horizontal scrolling.
      if direction == .down, try isSelectionBeforeTable(table) { event.tableToCheck = table }
      return false
    }
    if let selection {
      if direction == .backward || direction == .forward {
        return try handleHorizontalArrowKeyRangeSelection(
          &event, selection, extend: event.shiftKey, backward: direction == .backward, table)
      }
      guard selection.isCollapsed else { return false }
      guard let anchorCell = findParent(from: selection.anchor.key, where: isCell),
        anchorCell == findParent(from: selection.focus.key, where: isCell)
      else { return false }
      if let anchorCellTable = findParent(from: anchorCell, where: isTable), anchorCellTable != table {
        return try handleArrowKey(&event, direction, anchorCellTable, self.grid(anchorCellTable))
      }
      let edgeChild = direction == .up ? state.firstChild(of: anchorCell) : state.lastChild(of: anchorCell)
      guard edgeChild != nil, event.atCellEdge else { return false }
      event.stop()
      let (x, y) = try grid.cords(anchorCell)
      if event.shiftKey {
        let cell = try grid.cellOrThrow(x, y)
        setSelection(TableSelection(table: table, anchor: cell, focus: cell))
        return true
      }
      return try selectTableNodeInDirection(table, grid, x, y, direction)
    }
    guard let tableSelection, tableSelection.table == table else { return false }
    let anchorCell = findParent(from: tableSelection.anchor, where: isCell)
    let focusCell = findParent(from: tableSelection.focus, where: isCell)
    let (_, _, tableFromSelection) = try nodeTriplet(tableSelection.anchor)
    guard let anchorCell, let focusCell else { return false }
    let selectionGrid = self.grid(tableFromSelection)
    let anchorCords = try selectionGrid.cords(anchorCell)
    _ = try selectionGrid.cellOrThrow(anchorCords.x, anchorCords.y)
    event.stop()
    if event.shiftKey {
      let (map, anchorValue, focusValue) = try computeTableMap(table, anchorCell, focusCell)
      return try adjustFocusInDirection(table, grid, map, anchorValue, focusValue, direction)
    }
    selectEnd(focusCell)
    return true
  }

  /// `$handleArrowKey` for a range outside the table: from after the
  /// table, back into its last cell, and with Shift, up or down over it.
  /// Nil where the handler goes on to the check for scrolling tables.
  private mutating func handleArrowKeyOutside(
    _ event: inout ArrowEvent, _ direction: ArrowDirection, _ table: NodeKey, _ grid: Grid, _ selection: RangeSelection
  ) throws -> Bool? {
    if direction == .backward {
      guard selection.focus.offset == 0, let parent = blockParentIfFirstNode(selection.focus.key),
        let sibling = state.previousSibling(of: parent), isTable(sibling)
      else { return false }
      event.stop()
      if event.shiftKey {
        selection.focus.set(state.parent(of: sibling)!, state.index(of: sibling)!, .element)
      } else {
        selectEnd(sibling)
      }
      return true
    }
    guard event.shiftKey, direction == .up || direction == .down else { return nil }
    let focusNode = selection.focus.key
    let isBackward = try state.isBackward(selection)
    let isTableUnselect =
      !selection.isCollapsed && ((direction == .up && !isBackward) || (direction == .down && isBackward))
    if isTableUnselect {
      guard let focusTable = findParent(from: focusNode, where: isTable), focusTable == table,
        let sibling = direction == .down ? state.nextSibling(of: focusTable) : state.previousSibling(of: focusTable)
      else { return false }
      var newFocusNode = sibling
      var newOffset = 0
      if direction == .up, state[sibling].isElement {
        newFocusNode = state.lastChild(of: sibling) ?? sibling
        newOffset = state[newFocusNode].isText ? state.textSize(of: newFocusNode) : 0
      }
      let newSelection = selection.clone()
      newSelection.focus.set(newFocusNode, newOffset, state[newFocusNode].isText ? .text : .element)
      setSelection(newSelection)
      event.stop()
      return true
    }
    if state[focusNode].isRootOrShadowRoot {
      let nodes = try nodes(in: selection)
      guard let selectedNode = direction == .up ? nodes.last : nodes.first,
        parentCellInTable(table, selectedNode) != nil
      else { return false }
      guard let first = firstDescendant(of: table), let last = lastDescendant(of: table) else { return false }
      let firstCords = try grid.cords(try nodeTriplet(first).cell)
      let lastCords = try grid.cords(try nodeTriplet(last).cell)
      setSelection(
        TableSelection(
          table: table, anchor: try grid.cellOrThrow(firstCords.x, firstCords.y),
          focus: try grid.cellOrThrow(lastCords.x, lastCords.y)))
      return true
    }
    var focusParent = findParent(from: focusNode) { state[$0].isElement && !state[$0].isInline }
    if let cell = focusParent, isCell(cell) { focusParent = findParent(from: cell, where: isTable) }
    guard let focusParent else { return false }
    let sibling = direction == .down ? state.nextSibling(of: focusParent) : state.previousSibling(of: focusParent)
    guard sibling == table else { return nil }
    guard let first = firstDescendant(of: table), let last = lastDescendant(of: table) else { return false }
    let firstCell = try nodeTriplet(first).cell
    let lastCell = try nodeTriplet(last).cell
    let newSelection = selection.clone()
    newSelection.focus.set(
      direction == .up ? firstCell : lastCell, direction == .up ? 0 : state.childCount(of: lastCell), .element)
    event.stop()
    setSelection(newSelection)
    return true
  }

  /// `$isSelectionInTable`.
  private func isSelectionInTable(_ table: NodeKey) -> Bool {
    if let selection { return hasAncestor(selection.anchor.key, table) && hasAncestor(selection.focus.key, table) }
    if let tableSelection {
      return hasAncestor(tableSelection.anchor, table) && hasAncestor(tableSelection.focus, table)
    }
    return false
  }

  /// `$isSelectionBeforeTable`.
  private func isSelectionBeforeTable(_ table: NodeKey) throws -> Bool {
    guard let selection else { return false }
    let focusCaret = try state.caret(from: selection.focus, .next)
    return state.compareNext(focusCaret, .child(table, .next)) < 0
  }

  /// The check in `$handleTableSelectionChangeCommand`: a caret Down put in
  /// the table, other than in its first cell, goes to the start of the
  /// first cell. True where it moved the caret.
  mutating func checkSelectionForTable(_ table: NodeKey, _ before: RangeSelection?) throws -> Bool {
    guard before != nil, let selection, selection.isCollapsed, state.nodes[table] != nil, isTable(table),
      let anchorCell = findParent(from: selection.anchor.key, where: isCell),
      let firstRow = state.firstChild(of: table), isRow(firstRow),
      let firstCell = state.firstChild(of: firstRow), isCell(firstCell),
      findParent(from: anchorCell, where: { $0 == table || $0 == firstCell }) == table
    else { return false }
    selectStart(firstCell)
    return true
  }

  /// `$findParentTableCellNodeInTable`.
  private func parentCellInTable(_ table: NodeKey, _ node: NodeKey) -> NodeKey? {
    var lastCell: NodeKey?
    var current: NodeKey? = node
    while let key = current {
      if key == table { return lastCell }
      if isCell(key) { lastCell = key }
      current = state.parent(of: key)
    }
    return nil
  }

  /// `$getBlockParentIfFirstNode`.
  private func blockParentIfFirstNode(_ node: NodeKey) -> NodeKey? {
    var previous = node
    var current: NodeKey? = node
    while let key = current {
      if state[key].isElement {
        if key != previous, state.firstChild(of: key) != previous { return nil }
        if !state[key].isInline { return key }
      }
      previous = key
      current = state.parent(of: key)
    }
    return nil
  }

  /// `$handleHorizontalArrowKeyRangeSelection`: from the edge of a cell,
  /// into the cell beside, out of the table past its first or last, and
  /// with Shift, a table selection.
  private mutating func handleHorizontalArrowKeyRangeSelection(
    _ event: inout ArrowEvent, _ selection: RangeSelection, extend: Bool, backward isBackward: Bool, _ table: NodeKey
  ) throws -> Bool {
    let initialFocus = try state.caret(from: selection.focus, isBackward ? .previous : .next)
    if state.isExtendableTextCaret(initialFocus) { return false }
    var lastCaret = initialFocus
    for caret in state.nodeCarets(state.extendToRange(initialFocus), .shadowRoot) {
      guard caret.isSibling, state[caret.origin].isElement else { return false }
      lastCaret = caret
    }
    guard let anchorCell = state.parentAtCaret(lastCaret), isCell(anchorCell) else { return false }
    let focusCaret = findNextTableCell(.sibling(anchorCell, lastCaret.direction))
    guard let anchorCellTable = findParent(from: anchorCell, where: isTable), anchorCellTable == table else {
      return false
    }
    if let focusCaret {
      if extend {
        setSelection(TableSelection(table: table, anchor: anchorCell, focus: focusCaret.origin))
      } else {
        let inner = state.normalize(focusCaret)
        setPoint(selection.anchor, from: inner)
        setPoint(selection.focus, from: inner)
      }
    } else if extend {
      setSelection(TableSelection(table: table, anchor: anchorCell, focus: anchorCell))
    } else {
      let outer = tableExitCaret(.sibling(anchorCellTable, initialFocus.direction))
      setPoint(selection.anchor, from: outer)
      setPoint(selection.focus, from: outer)
    }
    event.stop()
    return true
  }

  /// `$getTableExitCaret`.
  private func tableExitCaret(_ initialCaret: Caret) -> Caret {
    guard let adjacent = state.adjacentChildCaret(initialCaret), adjacent.isChild else { return initialCaret }
    return state.normalize(adjacent)
  }

  /// `$findNextTableCell`.
  private func findNextTableCell(_ initialCaret: Caret) -> Caret? {
    for caret in state.nodeCarets(state.extendToRange(initialCaret)) {
      if isCell(caret.origin) {
        if caret.isChild { return .child(caret.origin, initialCaret.direction) }
      } else if !isRow(caret.origin) {
        break
      }
    }
    return nil
  }

  /// `selectTableNodeInDirection`.
  private mutating func selectTableNodeInDirection(
    _ table: NodeKey, _ grid: Grid, _ x: Int, _ y: Int, _ direction: ArrowDirection
  ) throws -> Bool {
    switch direction {
    case .backward, .forward:
      let isForward = direction == .forward
      if x != (isForward ? grid.columns - 1 : 0) {
        let cell = try grid.cellNodeOrThrow(x + (isForward ? 1 : -1), y)
        if isForward { selectStart(cell) } else { selectEnd(cell) }
      } else if y != (isForward ? grid.rows - 1 : 0) {
        let cell = try grid.cellNodeOrThrow(isForward ? 0 : grid.columns - 1, y + (isForward ? 1 : -1))
        if isForward { selectStart(cell) } else { selectEnd(cell) }
      } else if isForward {
        selectNext(table)
      } else {
        selectPrevious(table)
      }
    case .up:
      if y != 0 {
        selectEnd(try grid.cellNodeOrThrow(x, y - 1))
      } else {
        selectPrevious(table)
      }
    case .down:
      if y != grid.rows - 1 {
        selectStart(try grid.cellNodeOrThrow(x, y + 1))
      } else {
        selectNext(table)
      }
    }
    return true
  }

  // MARK: Moving a table selection's focus

  private typealias Boundary = (minColumn: Int, minRow: Int, maxColumn: Int, maxRow: Int)

  /// `getCorner`'s corner, as whether it's at the maximum column and row.
  private typealias Corner = (maxColumn: Bool, maxRow: Bool)

  /// `getCorner`.
  private func corner(_ rect: Boundary, _ value: TableMapValue) -> Corner? {
    let maxColumn: Bool
    if value.startColumn == rect.minColumn {
      maxColumn = false
    } else if value.startColumn + colSpan(value.cell) - 1 == rect.maxColumn {
      maxColumn = true
    } else {
      return nil
    }
    if value.startRow == rect.minRow { return (maxColumn, false) }
    if value.startRow + rowSpan(value.cell) - 1 == rect.maxRow { return (maxColumn, true) }
    return nil
  }

  /// `getAnchorCorner`.
  private func anchorCorner(_ rect: Boundary, _ anchor: TableMapValue, _ focus: TableMapValue) -> Corner {
    if let corner = corner(rect, anchor) { return corner }
    if let corner = corner(rect, focus) { return opposite(corner) }
    return (false, false)
  }

  /// `oppositeCorner`.
  private func opposite(_ corner: Corner) -> Corner { (!corner.maxColumn, !corner.maxRow) }

  /// `cellAtCornerOrThrow`.
  private func cell(_ map: TableMap, _ rect: Boundary, at corner: Corner) throws -> TableMapValue {
    let row = corner.maxRow ? rect.maxRow : rect.minRow
    let column = corner.maxColumn ? rect.maxColumn : rect.minColumn
    guard map.indices.contains(row) else {
      throw EditorError.invalidState("cellAtCornerOrThrow: \(corner.maxRow ? "maxRow" : "minRow") missing in tableMap")
    }
    guard map[row].indices.contains(column), let value = map[row][column] else {
      throw EditorError.invalidState(
        "cellAtCornerOrThrow: \(corner.maxColumn ? "maxColumn" : "minColumn") missing in tableMap")
    }
    return value
  }

  /// `$computeTableCellRectSpans`.
  private func rectSpans(_ map: TableMap, _ rect: Boundary) throws -> (
    topSpan: Int, leftSpan: Int, rightSpan: Int, bottomSpan: Int
  ) {
    var (topSpan, leftSpan, rightSpan, bottomSpan) = (1, 1, 1, 1)
    for column in rect.minColumn...rect.maxColumn {
      topSpan = max(topSpan, rowSpan(try entry(map, rect.minRow, column).cell))
      bottomSpan = max(bottomSpan, rowSpan(try entry(map, rect.maxRow, column).cell))
    }
    for row in rect.minRow...rect.maxRow {
      leftSpan = max(leftSpan, colSpan(try entry(map, row, rect.minColumn).cell))
      rightSpan = max(rightSpan, colSpan(try entry(map, row, rect.maxColumn).cell))
    }
    return (topSpan, leftSpan, rightSpan, bottomSpan)
  }

  /// `$adjustFocusInDirection`: the focus moves a cell, past the merged
  /// cells at the selection's edge, and the selection is the rectangle
  /// from the anchor's corner to it.
  private mutating func adjustFocusInDirection(
    _ table: NodeKey, _ grid: Grid, _ map: TableMap, _ anchorValue: TableMapValue, _ focusValue: TableMapValue,
    _ direction: ArrowDirection
  ) throws -> Bool {
    let rect = rectBoundary(map, anchorValue, focusValue)
    let spans = try rectSpans(map, rect)
    let focusCorner = opposite(anchorCorner(rect, anchorValue, focusValue))
    var column = focusCorner.maxColumn ? rect.maxColumn : rect.minColumn
    var row = focusCorner.maxRow ? rect.maxRow : rect.minRow
    switch direction {
    case .forward: column += focusCorner.maxColumn ? 1 : spans.leftSpan
    case .backward: column -= focusCorner.maxColumn ? spans.rightSpan : 1
    case .down: row += focusCorner.maxRow ? 1 : spans.topSpan
    case .up: row -= focusCorner.maxRow ? spans.bottomSpan : 1
    }
    guard map.indices.contains(row), map[row].indices.contains(column), let newFocusValue = map[row][column] else {
      return false
    }
    let newRect = rectBoundary(map, anchorValue, newFocusValue)
    let newAnchorCorner = anchorCorner(newRect, anchorValue, newFocusValue)
    let finalAnchor = try cell(map, newRect, at: newAnchorCorner)
    let finalFocus = try cell(map, newRect, at: opposite(newAnchorCorner))
    setSelection(
      TableSelection(
        table: table, anchor: try grid.observerCell(finalAnchor.cell.key),
        focus: try grid.observerCell(finalFocus.cell.key)))
    return true
  }
}
