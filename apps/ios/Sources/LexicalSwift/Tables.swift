/// @lexical/table@0.51.0 as a document's tables use it: the transforms
/// TablePlugin registers, the insert-table dialog and the table menu, and
/// what each table's handlers do to the selection and to editing in it, as
/// `reference/tables.ts` transcribes them.
extension Update {
  /// `TableCellHeaderStates`.
  enum HeaderState {
    static let none = 0
    static let row = 1
    static let column = 2
    static let both = 3
  }

  // MARK: Nodes

  func isTable(_ key: NodeKey) -> Bool { state[key].type == SerializedTableNode.type }
  func isRow(_ key: NodeKey) -> Bool { state[key].type == SerializedTableRowNode.type }
  func isCell(_ key: NodeKey) -> Bool { state[key].type == SerializedTableCellNode.type }

  private func cellNode(_ key: NodeKey) -> SerializedTableCellNode? {
    if case .tableCell(let node) = state[key].payload { node } else { nil }
  }

  func colSpan(of cell: NodeKey) -> Int { cellNode(cell)?.colSpan ?? 1 }
  func rowSpan(of cell: NodeKey) -> Int { cellNode(cell)?.rowSpan ?? 1 }
  func headerState(of cell: NodeKey) -> Int { Int(cellNode(cell)?.headerState ?? 0) }

  private mutating func modifyCell(_ cell: NodeKey, _ change: (inout SerializedTableCellNode) -> Void) {
    guard var node = cellNode(cell) else { return }
    change(&node)
    modify(cell) { $0.payload = .tableCell(node) }
  }

  private mutating func setColSpan(_ cell: NodeKey, _ span: Int) { modifyCell(cell) { $0.colSpan = span } }
  private mutating func setRowSpan(_ cell: NodeKey, _ span: Int) { modifyCell(cell) { $0.rowSpan = span } }

  private func colWidths(of table: NodeKey) -> [Double]? {
    if case .table(let node) = state[table].payload { node.colWidths } else { nil }
  }

  private mutating func setColWidths(_ table: NodeKey, _ widths: [Double]?) {
    guard case .table(var node) = state[table].payload else { return }
    node.colWidths = widths
    modify(table) { $0.payload = .table(node) }
  }

  /// `TableNode.getColumnCount`.
  private func columnCount(of table: NodeKey) -> Int {
    guard let first = state.firstChild(of: table), isRow(first) else { return 0 }
    return state.children(of: first).filter(isCell).reduce(0) { $0 + colSpan(of: $1) }
  }

  /// `$createTableCellNode(headerState)`.
  private mutating func createCell(headerState: Int) -> NodeKey {
    let cell = create(SerializedTableCellNode.type)
    if var node = cellNode(cell) {
      node.headerState = Double(headerState)
      state.nodes[cell]!.payload = .tableCell(node)
    }
    return cell
  }

  /// A new cell holding an empty paragraph, as the table menu adds them.
  private mutating func createFilledCell(headerState: Int) throws -> NodeKey {
    let cell = createCell(headerState: headerState)
    try append(cell, [create(SerializedParagraphNode.type)])
    return cell
  }

  /// `getHeaderState`: a new cell beside `current` is a header of the kind
  /// `possible` names where `current` is one.
  private func headerState(beside current: Int, _ possible: Int) -> Int {
    current == HeaderState.both || current == possible ? possible : HeaderState.none
  }

  /// `$copyNode`: a node like `key`, in no parent and with no children.
  mutating func copyNode(_ key: NodeKey) -> NodeKey {
    let node = state[key]
    return create(node.payload, type: node.type, children: node.isElement ? [] : nil)
  }

  /// `$insertFirst`.
  private mutating func insertFirst(_ parent: NodeKey, _ node: NodeKey) throws {
    if let first = state.firstChild(of: parent) {
      try insert(node, before: first)
    } else {
      try append(parent, [node])
    }
  }

  // MARK: The table map

  /// A cell as code holding its node reads it. Lexical's code holds node
  /// objects, and a node this update hasn't written yet is copied on its
  /// first write, leaving the object held with its spans as they were read;
  /// one it has is written in place, so later writes show through it.
  struct CellRead {
    let key: NodeKey
    fileprivate let colSpan: Int
    fileprivate let rowSpan: Int
    fileprivate let isLive: Bool
  }

  func read(_ cell: NodeKey) -> CellRead {
    CellRead(key: cell, colSpan: colSpan(of: cell), rowSpan: rowSpan(of: cell), isLive: touched.contains(cell))
  }

  func colSpan(_ cell: CellRead) -> Int { cell.isLive ? colSpan(of: cell.key) : cell.colSpan }
  func rowSpan(_ cell: CellRead) -> Int { cell.isLive ? rowSpan(of: cell.key) : cell.rowSpan }

  /// `TableMapValueType`.
  struct TableMapValue {
    let cell: CellRead
    let startRow: Int
    let startColumn: Int
  }

  /// `TableMapType`, a JavaScript array of rows with holes where no cell
  /// reaches, as nil.
  typealias TableMap = [[TableMapValue?]]

  /// `map[row][column]` where Lexical reads a property of it, which throws
  /// where there's no cell.
  private func entry(_ row: [TableMapValue?]?, _ column: Int) throws -> TableMapValue {
    guard let row, row.indices.contains(column), let value = row[column] else {
      throw EditorError.invalidState("Cannot read properties of undefined (reading 'cell')")
    }
    return value
  }

  private func entry(_ map: TableMap, _ row: Int, _ column: Int) throws -> TableMapValue {
    try entry(map.indices.contains(row) ? map[row] : nil, column)
  }

  /// `$computeTableMapSkipCellCheck`.
  func computeTableMapSkipCellCheck(_ table: NodeKey, _ cellA: NodeKey?, _ cellB: NodeKey?) throws -> (
    TableMap, TableMapValue?, TableMapValue?
  ) {
    var map: TableMap = []
    var valueA: TableMapValue?
    var valueB: TableMapValue?
    let rows = Array(state.children(of: table))
    func put(_ value: TableMapValue, _ row: Int, _ column: Int) {
      while map.count <= row { map.append([]) }
      while map[row].count <= column { map[row].append(nil) }
      map[row][column] = value
    }
    for (rowIndex, row) in rows.enumerated() {
      guard isRow(row) else { throw EditorError.invalidState("Expected TableNode children to be TableRowNode") }
      while map.count <= rowIndex { map.append([]) }
      var columnIndex = 0
      for cell in state.children(of: row) {
        guard isCell(cell) else { throw EditorError.invalidState("Expected TableRowNode children to be TableCellNode") }
        while map[rowIndex].indices.contains(columnIndex), map[rowIndex][columnIndex] != nil { columnIndex += 1 }
        let value = TableMapValue(cell: read(cell), startRow: rowIndex, startColumn: columnIndex)
        for j in 0..<rowSpan(of: cell) where rowIndex + j < rows.count {
          for i in 0..<colSpan(of: cell) { put(value, rowIndex + j, columnIndex + i) }
        }
        if cell == cellA, valueA == nil { valueA = value }
        if cell == cellB, valueB == nil { valueB = value }
      }
    }
    return (map, valueA, valueB)
  }

  /// `$computeTableMap`.
  func computeTableMap(_ table: NodeKey, _ cellA: NodeKey, _ cellB: NodeKey) throws -> (
    TableMap, TableMapValue, TableMapValue
  ) {
    let (map, valueA, valueB) = try computeTableMapSkipCellCheck(table, cellA, cellB)
    guard let valueA else { throw EditorError.invalidState("Anchor not found in Table") }
    guard let valueB else { throw EditorError.invalidState("Focus not found in Table") }
    return (map, valueA, valueB)
  }

  /// `$getNodeTriplet`: the cell `key` is in, its row and its table.
  func nodeTriplet(_ key: NodeKey) throws -> (cell: NodeKey, row: NodeKey, table: NodeKey) {
    guard let cell = findParent(from: key, where: isCell) else {
      throw EditorError.invalidState("Expected to find a parent TableCellNode")
    }
    guard let row = state.parent(of: cell), isRow(row) else {
      throw EditorError.invalidState("Expected TableCellNode to have a parent TableRowNode")
    }
    guard let table = state.parent(of: row), isTable(table) else {
      throw EditorError.invalidState("Expected TableRowNode to have a parent TableNode")
    }
    return (cell, row, table)
  }

  /// `$computeTableCellRectBoundary`: the rectangle holding both cells,
  /// grown until no merged cell crosses its edge.
  private func rectBoundary(_ map: TableMap, _ a: TableMapValue, _ b: TableMapValue) -> (
    minColumn: Int, minRow: Int, maxColumn: Int, maxRow: Int
  ) {
    var minColumn = min(a.startColumn, b.startColumn)
    var minRow = min(a.startRow, b.startRow)
    var maxColumn = max(a.startColumn + colSpan(a.cell) - 1, b.startColumn + colSpan(b.cell) - 1)
    var maxRow = max(a.startRow + rowSpan(a.cell) - 1, b.startRow + rowSpan(b.cell) - 1)
    var hasChanges = true
    while hasChanges {
      hasChanges = false
      for row in map.indices {
        for column in 0..<(map.first?.count ?? 0) {
          guard map[row].indices.contains(column), let cell = map[row][column] else { continue }
          let endColumn = cell.startColumn + colSpan(cell.cell) - 1
          let endRow = cell.startRow + rowSpan(cell.cell) - 1
          guard cell.startColumn <= maxColumn, endColumn >= minColumn, cell.startRow <= maxRow, endRow >= minRow
          else { continue }
          let grown = (
            min(minColumn, cell.startColumn), min(minRow, cell.startRow), max(maxColumn, endColumn),
            max(maxRow, endRow)
          )
          if grown != (minColumn, minRow, maxColumn, maxRow) {
            (minColumn, minRow, maxColumn, maxRow) = grown
            hasChanges = true
          }
        }
      }
    }
    return (minColumn, minRow, maxColumn, maxRow)
  }

  /// `TableSelection.getNodes()`'s cells, row by row.
  func cells(of selection: TableSelection) throws -> [NodeKey] {
    guard state.nodes[selection.table] != nil, state.nodes[selection.anchor] != nil, state.nodes[selection.focus] != nil
    else { return [] }
    let (anchorCell, _, table) = try nodeTriplet(selection.anchor)
    let (focusCell, _, focusTable) = try nodeTriplet(selection.focus)
    guard table == focusTable else {
      throw EditorError.invalidState("Expected TableSelection anchor and focus to be in the same table")
    }
    let (map, anchorValue, focusValue) = try computeTableMap(table, anchorCell, focusCell)
    let boundary = rectBoundary(map, anchorValue, focusValue)
    var cells: [NodeKey] = []
    for row in boundary.minRow...boundary.maxRow {
      for column in boundary.minColumn...boundary.maxColumn {
        let cell = try entry(map, row, column).cell.key
        if !cells.contains(cell) { cells.append(cell) }
      }
    }
    return cells
  }

  /// `$getTableCellNodeRect`.
  private func cellRect(_ key: NodeKey) throws -> (row: Int, column: Int, rowSpan: Int, colSpan: Int)? {
    let (target, _, table) = try nodeTriplet(key)
    let rows = state.children(of: table).filter(isRow)
    guard let first = rows.first else { throw EditorError.invalidState("Cannot read properties of undefined") }
    var matrix = [[NodeKey?]](repeating: [NodeKey?](repeating: nil, count: state.childCount(of: first)), count: rows.count)
    for (rowIndex, row) in rows.enumerated() {
      var columnIndex = 0
      for cell in state.children(of: row).filter(isCell) {
        while matrix[rowIndex].indices.contains(columnIndex), matrix[rowIndex][columnIndex] != nil { columnIndex += 1 }
        let (rowSpan, colSpan) = (rowSpan(of: cell), colSpan(of: cell))
        for i in 0..<rowSpan {
          guard matrix.indices.contains(rowIndex + i) else {
            throw EditorError.invalidState("Cannot set properties of undefined")
          }
          for j in 0..<colSpan {
            while matrix[rowIndex + i].count <= columnIndex + j { matrix[rowIndex + i].append(nil) }
            matrix[rowIndex + i][columnIndex + j] = cell
          }
        }
        if cell == target { return (rowIndex, columnIndex, rowSpan, colSpan) }
        columnIndex += colSpan
      }
    }
    return nil
  }

  /// The anchor and focus of the selection, a range or a table selection.
  private func selectionPoints() throws -> (anchor: SelectionPoint, focus: SelectionPoint) {
    if let selection { return (selection.anchor, selection.focus) }
    if let saved = tableSelection?.saved { return (SelectionPoint(saved.anchor), SelectionPoint(saved.focus)) }
    throw EditorError.invalidState("Expected a RangeSelection or TableSelection")
  }

  // MARK: Transforms

  /// `$tableCellTransform`: a cell is in a row, and holds something.
  mutating func transformCell(_ cell: NodeKey) throws {
    if !(state.parent(of: cell).map(isRow) ?? false) {
      try remove(cell)
    } else if isEmpty(cell) {
      try append(cell, [create(SerializedParagraphNode.type)])
    }
  }

  /// `$tableRowTransform`: a row is in a table, and holds cells alone.
  mutating func transformRow(_ row: NodeKey) throws {
    if !(state.parent(of: row).map(isTable) ?? false) {
      try remove(row)
    } else {
      try unwrapAndFilterDescendants(row, keeping: isCell)
    }
  }

  /// `$tableTransform`: a table holds rows alone, each as long as the
  /// longest, and a width for each column where it has widths.
  mutating func transformTable(_ table: NodeKey) throws {
    try unwrapAndFilterDescendants(table, keeping: isRow)
    let (map, _, _) = try computeTableMapSkipCellCheck(table, nil, nil)
    let maxRowLength = map.map(\.count).max() ?? 0
    let rows = Array(state.children(of: table))
    for (index, mapRow) in map.enumerated() where rows.indices.contains(index) {
      let row = rows[index]
      guard isRow(row) else {
        throw EditorError.invalidState("TablePlugin: Expecting all children of TableNode to be TableRowNode")
      }
      let rowLength = mapRow.count { $0 != nil }
      guard rowLength != maxRowLength else { continue }
      let headerState = state.lastChild(of: row).map { isCell($0) ? self.headerState(of: $0) & HeaderState.row : 0 } ?? 0
      for _ in rowLength..<maxRowLength {
        try append(row, [createFilledCell(headerState: headerState)])
      }
    }
    let count = columnCount(of: table)
    if let widths = colWidths(of: table), widths.count != count {
      if count < widths.count {
        setColWidths(table, Array(widths.prefix(count)))
      } else if let last = widths.last {
        setColWidths(table, widths + Array(repeating: last, count: count - widths.count))
      } else {
        setColWidths(table, nil)
      }
    }
  }

  /// `$unwrapAndFilterDescendants`: the children of `root` that `keeps`
  /// turns down go, and whatever it keeps inside them goes after the
  /// outermost of them.
  private mutating func unwrapAndFilterDescendants(
    _ root: NodeKey, keeping keeps: (NodeKey) -> Bool, after host: NodeKey? = nil
  ) throws {
    var current = state.lastChild(of: root)
    while let node = current {
      current = state.previousSibling(of: node)
      if keeps(node) {
        if let host { try insert(node, after: host) }
        continue
      }
      if state[node].isElement {
        try unwrapAndFilterDescendants(node, keeping: keeps, after: host ?? node)
      }
      try remove(node)
    }
  }

  // MARK: Inserting a table

  /// `$insertDocumentTable` in @packages/lexical-nodes: the web's
  /// INSERT_TABLE_COMMAND.
  mutating func insertDocumentTable(rows: Int, columns: Int) throws {
    guard tableSelection == nil, let selection, findParent(from: selection.anchor.key, where: isTable) == nil else {
      return
    }
    let table = try createDocumentTable(rows: rows, columns: columns)
    try insertNodeToNearestRoot(table, selection)
    selectStart(table)
  }

  /// `$createDocumentTable`: `$createTableNodeWithDimensions` with a header
  /// row.
  private mutating func createDocumentTable(rows: Int, columns: Int) throws -> NodeKey {
    let table = create(SerializedTableNode.type)
    for rowIndex in 0..<max(rows, 0) {
      let row = create(SerializedTableRowNode.type)
      for _ in 0..<max(columns, 0) {
        let cell = createCell(headerState: rowIndex == 0 ? HeaderState.row : HeaderState.none)
        let paragraph = create(SerializedParagraphNode.type)
        try append(paragraph, [createText("")])
        try append(cell, [paragraph])
        try append(row, [cell])
      }
      try append(table, [row])
    }
    return table
  }

  /// `$insertNodeToNearestRoot` from @lexical/utils, with a range selection.
  private mutating func insertNodeToNearestRoot(_ node: NodeKey, _ selection: RangeSelection) throws {
    let initial = try state.caret(from: selection.focus, .next)
    let hasContentAfter =
      state.isExtendableTextCaret(initial)
      || adjacentSiblingOrParentSiblingCaret(initial.isText ? state.siblingCaret(initial) : initial) != nil
    let inserted = try insertNodeToNearestRoot(node, at: initial, splittingLast: !hasContentAfter)
    let adjacent = state.adjacentChildCaret(inserted)
    let caret = adjacent.map { $0.isChild ? state.normalize($0) : inserted } ?? inserted
    let target =
      self.selection
      ?? RangeSelection(
        anchor: SelectionPoint(EditorState.rootKey, 0, .element), focus: SelectionPoint(EditorState.rootKey, 0, .element),
        format: [], style: "")
    updateSelection(target, from: CaretRange(anchor: caret, focus: caret))
    setSelection(target)
  }

  /// `$getAdjacentSiblingOrParentSiblingCaret` within the nearest root or
  /// shadow root.
  private func adjacentSiblingOrParentSiblingCaret(_ start: Caret) -> Caret? {
    var caret = start
    var next = state.adjacentChildCaret(caret)
    while next == nil {
      guard let parent = state.parentCaret(caret, .shadowRoot) else { return nil }
      caret = parent
      next = state.adjacentChildCaret(caret)
    }
    return next
  }

  /// `$insertNodeToNearestRootAtCaret`, for a node not yet in the document:
  /// splits up to the nearest root or shadow root and puts the node there.
  private mutating func insertNodeToNearestRoot(_ node: NodeKey, at caret: Caret, splittingLast: Bool) throws -> Caret {
    var insertCaret = state.inDirection(caret, .next)
    if case .text(let origin, _, let offset) = insertCaret {
      if offset == 0 {
        insertCaret = state.flipped(.sibling(origin, .previous))
      } else if offset == state.textSize(of: origin) {
        insertCaret = .sibling(origin, .next)
      }
    }
    var next: Caret? = insertCaret
    while let current = next {
      insertCaret = current
      next = try splitAtPointCaretNext(current, splittingLast: splittingLast)
    }
    guard !insertCaret.isText else {
      throw EditorError.invalidState("$insertNodeToNearestRootAtCaret: An unattached TextNode can not be split")
    }
    if state[node].isInline {
      let paragraph = create(SerializedParagraphNode.type)
      try append(paragraph, [node])
      try insert(paragraph, at: insertCaret)
    } else {
      try insert(node, at: insertCaret)
    }
    return state.inDirection(.sibling(node, .next), caret.direction)
  }

  /// `$splitAtPointCaretNext`, splitting a block's first edge always and its
  /// last where `splittingLast` says.
  private mutating func splitAtPointCaretNext(_ caret: Caret, splittingLast: Bool) throws -> Caret? {
    if case .text(let origin, let direction, let offset) = caret {
      if offset == state.textOffset(origin, direction) { return .sibling(origin, direction) }
      if offset == state.textOffset(origin, direction.flipped) { return state.rewind(.sibling(origin, direction)) }
      let first = try splitText(origin, at: [offset])[0]
      return state.inDirection(.sibling(first, .next), direction)
    }
    guard let parentCaret = state.parentCaret(caret, .shadowRoot) else { return nil }
    let origin = parentCaret.origin
    if caret.isChild, !state[origin].canBeEmpty {
      return state.rewind(parentCaret)
    }
    var siblings: [NodeKey] = []
    var adjacent = state.adjacentCaret(caret)
    while let sibling = adjacent {
      siblings.append(sibling.origin)
      adjacent = state.adjacentCaret(sibling)
    }
    if !siblings.isEmpty || (state[origin].canBeEmpty && splittingLast) {
      let copy = copyNode(origin)
      try splice(copy, 0, deleting: 0, inserting: siblings)
      try insert(copy, at: parentCaret)
    }
    return parentCaret
  }

  // MARK: Rows and columns

  /// `$insertTableRowAtSelection`.
  mutating func insertTableRowAtSelection(after: Bool) throws {
    let (anchor, focus) = try selectionPoints()
    let anchorCell = try nodeTriplet(anchor.key).cell
    let (focusCell, _, table) = try nodeTriplet(focus.key)
    let (_, focusValue, anchorValue) = try computeTableMap(table, focusCell, anchorCell)
    if after {
      let isAnchorLower =
        anchorValue.startRow + rowSpan(of: anchorCell) > focusValue.startRow + rowSpan(of: focusCell)
      try insertTableRow(at: isAnchorLower ? anchorCell : focusCell, after: true)
    } else {
      try insertTableRow(at: focusValue.startRow < anchorValue.startRow ? focusCell : anchorCell, after: false)
    }
  }

  /// `$insertTableRowAtNode`.
  private mutating func insertTableRow(at cell: NodeKey, after: Bool) throws {
    let table = try nodeTriplet(cell).table
    let (map, cellValue, _) = try computeTableMap(table, cell, cell)
    let columnCount = map[0].count
    let edgeRow = after ? cellValue.startRow + rowSpan(of: cell) - 1 : cellValue.startRow
    let newRow = create(SerializedTableRowNode.type)
    for column in 0..<columnCount {
      let value = try entry(map, edgeRow, column)
      let isOwnRow =
        after ? value.startRow + rowSpan(value.cell) - 1 <= edgeRow : value.startRow == edgeRow
      if isOwnRow {
        let headerState = headerState(beside: headerState(of: value.cell.key), HeaderState.column)
        try append(newRow, [createFilledCell(headerState: headerState)])
      } else {
        setRowSpan(value.cell.key, rowSpan(value.cell) + 1)
      }
    }
    guard let edge = state.child(of: table, at: edgeRow), isRow(edge) else {
      throw EditorError.invalidState(after ? "insertAfterEndRow is not a TableRowNode" : "insertBeforeStartRow is not a TableRowNode")
    }
    if after {
      try insert(newRow, after: edge)
    } else {
      try insert(newRow, before: edge)
    }
  }

  /// `$insertDocumentTableColumns` in @packages/lexical-nodes: as many
  /// columns as a table selection spans, or one.
  mutating func insertDocumentTableColumns(after: Bool) throws {
    var count = 1
    if let tableSelection {
      guard let anchor = try cellRect(tableSelection.anchor) else {
        throw EditorError.invalidState("getCellRect: expected to find AnchorNode")
      }
      guard let focus = try cellRect(tableSelection.focus) else {
        throw EditorError.invalidState("getCellRect: expected to find focusCellNode")
      }
      let start = min(anchor.column, focus.column)
      let stop = max(anchor.column + anchor.colSpan - 1, focus.column + focus.colSpan - 1)
      count = max(start, stop) - min(start, stop) + 1
    }
    for _ in 0..<count { try insertTableColumnAtSelection(after: after) }
  }

  /// `$insertTableColumnAtSelection`.
  private mutating func insertTableColumnAtSelection(after: Bool) throws {
    let (anchor, focus) = try selectionPoints()
    let anchorCell = try nodeTriplet(anchor.key).cell
    let (focusCell, _, table) = try nodeTriplet(focus.key)
    let (_, focusValue, anchorValue) = try computeTableMap(table, focusCell, anchorCell)
    if after {
      let isAnchorFurther =
        anchorValue.startColumn + colSpan(of: anchorCell) > focusValue.startColumn + colSpan(of: focusCell)
      try insertTableColumn(at: isAnchorFurther ? anchorCell : focusCell, after: true)
    } else {
      try insertTableColumn(
        at: focusValue.startColumn < anchorValue.startColumn ? focusCell : anchorCell, after: false)
    }
  }

  /// `$insertTableColumnAtNode`, which moves the selection to the first new
  /// cell.
  private mutating func insertTableColumn(at cell: NodeKey, after: Bool) throws {
    let table = try nodeTriplet(cell).table
    let (map, cellValue, _) = try computeTableMap(table, cell, cell)
    let insertAfterColumn = after ? cellValue.startColumn + colSpan(of: cell) - 1 : cellValue.startColumn - 1
    guard let firstRow = state.firstChild(of: table), isRow(firstRow) else {
      throw EditorError.invalidState("Expected firstTable child to be a row")
    }
    var firstInserted: NodeKey?
    func newCell(_ update: inout Update, _ headerState: Int) throws -> NodeKey {
      let cell = try update.createFilledCell(headerState: headerState)
      if firstInserted == nil { firstInserted = cell }
      return cell
    }
    var row = firstRow
    for rowIndex in map.indices {
      if rowIndex != 0 {
        guard let next = state.nextSibling(of: row), isRow(next) else {
          throw EditorError.invalidState("Expected row nextSibling to be a row")
        }
        row = next
      }
      let beside = try entry(map, rowIndex, max(insertAfterColumn, 0)).cell.key
      let headerState = headerState(beside: headerState(of: beside), HeaderState.row)
      if insertAfterColumn < 0 {
        try insertFirst(row, newCell(&self, headerState))
        continue
      }
      let current = try entry(map, rowIndex, insertAfterColumn)
      if current.startColumn + colSpan(current.cell) - 1 <= insertAfterColumn {
        // The last cell this row owns at or before the column: positions a
        // row span from above covers aren't among its children.
        var insertAfterCell: NodeKey?
        var column = 0
        while column <= insertAfterColumn {
          let value = try entry(map, rowIndex, column)
          if value.startRow == rowIndex { insertAfterCell = value.cell.key }
          column += max(colSpan(value.cell), 1)
        }
        if let insertAfterCell {
          try insert(newCell(&self, headerState), after: insertAfterCell)
        } else {
          try insertFirst(row, newCell(&self, headerState))
        }
      } else {
        setColSpan(current.cell.key, colSpan(current.cell) + 1)
      }
    }
    if let firstInserted { moveSelection(toCell: firstInserted) }
    if var widths = colWidths(of: table) {
      let index = max(insertAfterColumn, 0)
      guard widths.indices.contains(index) else {
        throw EditorError.unsupported("A column width Lexical leaves undefined")
      }
      widths.insert(widths[index], at: index)
      setColWidths(table, widths)
    }
  }

  /// `$deleteTableRowAtSelection`.
  mutating func deleteTableRowAtSelection() throws {
    let (anchor, focus) = try selectionPoints()
    let (first, last) = try state.isBefore(focus, anchor) ? (focus.key, anchor.key) : (anchor.key, focus.key)
    let (anchorCell, _, table) = try nodeTriplet(first)
    let focusCell = try nodeTriplet(last).cell
    let (map, anchorValue, focusValue) = try computeTableMap(table, anchorCell, focusCell)
    let startRow = anchorValue.startRow
    let endRow = focusValue.startRow + rowSpan(of: focusCell) - 1
    if map.count == endRow - startRow + 1 {
      selectPrevious(table)
      try remove(table)
      return
    }
    let columnCount = map[0].count
    let nextRow = map.indices.contains(endRow + 1) ? map[endRow + 1] : nil
    let nextRowNode = state.child(of: table, at: endRow + 1)
    for row in stride(from: endRow, through: startRow, by: -1) {
      for column in stride(from: columnCount - 1, through: 0, by: -1) {
        let value = try entry(map, row, column)
        guard value.startColumn == column else { continue }
        let cell = value.cell
        if value.startRow < startRow || value.startRow + rowSpan(cell) - 1 > endRow {
          let intersectionStart = max(value.startRow, startRow)
          let intersectionEnd = min(rowSpan(cell) + value.startRow - 1, endRow)
          let overflow = intersectionStart <= intersectionEnd ? intersectionEnd - intersectionStart + 1 : 0
          setRowSpan(cell.key, rowSpan(cell) - overflow)
        }
        // A cell reaching below the rows goes down into the next.
        if value.startRow >= startRow, value.startRow + rowSpan(cell) - 1 > endRow, row == endRow {
          guard let nextRowNode, isRow(nextRowNode) else { throw EditorError.invalidState("Expected a TableRowNode") }
          var insertAfterCell: NodeKey?
          var columnIndex = 0
          while columnIndex < column {
            let below = try entry(nextRow, columnIndex)
            if below.startRow == row + 1 { insertAfterCell = below.cell.key }
            columnIndex += max(colSpan(below.cell), 1)
          }
          if let insertAfterCell {
            try insert(cell.key, after: insertAfterCell)
          } else {
            try insertFirst(nextRowNode, cell.key)
          }
        }
      }
      guard let rowNode = state.child(of: table, at: row), isRow(rowNode) else {
        throw EditorError.invalidState("Expected TableNode childAtIndex(\(row)) to be RowNode")
      }
      try remove(rowNode)
    }
    if let nextRow {
      moveSelection(toCell: try entry(nextRow, 0).cell.key)
    } else {
      moveSelection(toCell: try entry(map, startRow - 1, 0).cell.key)
    }
  }

  /// `$deleteTableColumnAtSelection`.
  mutating func deleteTableColumnAtSelection() throws {
    let (anchor, focus) = try selectionPoints()
    let (anchorCell, _, table) = try nodeTriplet(anchor.key)
    let focusCell = try nodeTriplet(focus.key).cell
    let (anchorSpan, focusSpan) = (read(anchorCell), read(focusCell))
    let (map, anchorValue, focusValue) = try computeTableMap(table, anchorCell, focusCell)
    let startColumn = min(anchorValue.startColumn, focusValue.startColumn)
    let endColumn = max(
      anchorValue.startColumn + colSpan(anchorSpan) - 1, focusValue.startColumn + colSpan(focusSpan) - 1)
    let selectedCount = endColumn - startColumn + 1
    if map[0].count == selectedCount {
      selectPrevious(table)
      try remove(table)
      return
    }
    for row in map.indices {
      for column in startColumn...endColumn {
        let value = try entry(map, row, column)
        let cell = value.cell
        if value.startColumn < startColumn {
          if column == startColumn {
            let overflowLeft = startColumn - value.startColumn
            setColSpan(cell.key, colSpan(cell) - min(selectedCount, colSpan(cell) - overflowLeft))
          }
        } else if value.startColumn + colSpan(cell) - 1 > endColumn {
          if column == endColumn {
            setColSpan(cell.key, colSpan(cell) - (endColumn - value.startColumn + 1))
          }
        } else {
          try remove(cell.key)
        }
      }
    }
    let focusRow = map[focusValue.startRow]
    let nextColumn =
      anchorValue.startColumn > focusValue.startColumn
      ? anchorValue.startColumn + colSpan(anchorSpan) : focusValue.startColumn + colSpan(focusSpan)
    if focusRow.indices.contains(nextColumn), let next = focusRow[nextColumn] {
      moveSelection(toCell: next.cell.key)
    } else {
      let previous = min(focusValue.startColumn, anchorValue.startColumn) - 1
      moveSelection(toCell: try entry(focusRow, previous).cell.key)
    }
    if var widths = colWidths(of: table) {
      widths.removeSubrange(min(startColumn, widths.count)..<min(startColumn + selectedCount, widths.count))
      setColWidths(table, widths)
    }
  }

  /// `$moveSelectionToCell`.
  private mutating func moveSelection(toCell cell: NodeKey) {
    if let first = firstDescendant(of: cell) {
      selectStart(state.parent(of: first)!)
    } else {
      selectStart(cell)
    }
  }

  // MARK: The selection

  /// `$fixRangeSelectionForSelectedTable`: a range reaching into a table
  /// from outside takes in the whole table, and one from cell to cell of a
  /// table becomes a table selection.
  mutating func fixRangeSelectionForSelectedTable(_ selection: RangeSelection) throws {
    let anchorCell = findParent(from: selection.anchor.key, where: isCell)
    let focusCell = findParent(from: selection.focus.key, where: isCell)
    let anchorTable = anchorCell.flatMap { findParent(from: $0, where: isTable) }
    let focusTable = focusCell.flatMap { findParent(from: $0, where: isTable) }
    let isBackward = try state.isBackward(selection)
    if let focusCell, let focusTable, anchorTable.map({ hasAncestor(focusTable, $0) }) ?? true {
      let moved = selection.clone()
      let (first, last) = try cornerCells(focusTable, focusCell)
      moved.focus.set(isBackward ? first : last, isBackward ? 0 : state.childCount(of: last), .element)
      setSelection(moved)
    } else if let anchorCell, let anchorTable, focusTable.map({ hasAncestor(anchorTable, $0) }) ?? true {
      let moved = selection.clone()
      let (first, last) = try cornerCells(anchorTable, anchorCell)
      moved.anchor.set(isBackward ? last : first, isBackward ? state.childCount(of: last) : 0, .element)
      setSelection(moved)
    } else if let anchorCell, let focusCell, let anchorTable, anchorTable == focusTable, anchorCell != focusCell {
      setSelection(TableSelection(table: anchorTable, anchor: anchorCell, focus: focusCell))
    }
  }

  /// A table's first cell and its last.
  private func cornerCells(_ table: NodeKey, _ cell: NodeKey) throws -> (NodeKey, NodeKey) {
    let (map, _, _) = try computeTableMap(table, cell, cell)
    guard let first = map.first?.first ?? nil, let last = map.last?.last ?? nil else {
      throw EditorError.invalidState("A table without cells")
    }
    return (first.cell.key, last.cell.key)
  }

  /// The tables in the order TablePlugin gives each its handlers.
  private func tables() -> [NodeKey] {
    var tables: [NodeKey] = []
    var stack = [EditorState.rootKey]
    while let node = stack.popLast() {
      if isTable(node) { tables.append(node) }
      stack.append(contentsOf: state.children(of: node).reversed())
    }
    return tables
  }

  /// Each table's KEY_BACKSPACE_COMMAND and KEY_DELETE_COMMAND handler, a
  /// deleted character's: a range with one end in a table grows around it,
  /// so the delete takes the table whole; a table selection's cells are
  /// cleared. True where that handled it.
  mutating func deleteCellHandler() throws -> Bool {
    for table in tables() {
      guard let (anchor, focus) = try? selectionPoints() else { return false }
      let isAnchorInside = hasAncestor(anchor.key, table)
      let isFocusInside = hasAncestor(focus.key, table)
      if isAnchorInside != isFocusInside {
        let (tablePoint, outerPoint) = isAnchorInside ? (anchor, focus) : (focus, anchor)
        let outer = outerPoint.value
        let grown = try state.isBefore(tablePoint, outerPoint) ? selectPrevious(table) : selectNext(table)
        (isAnchorInside ? grown.focus : grown.anchor).set(outer)
        continue
      }
      guard isAnchorInside, let tableSelection else { continue }
      try clearText(tableSelection)
      return true
    }
    return false
  }

  /// `TableObserver.$clearText`: the selected cells keep an empty paragraph
  /// each, or the table goes where every cell is selected.
  mutating func clearText(_ selection: TableSelection) throws {
    guard isTable(selection.table) else { throw EditorError.invalidState("Expected TableNode.") }
    let table = selection.table
    let cells = try cells(of: selection)
    let firstRow = state.firstChild(of: table)
    let lastRow = state.lastChild(of: table)
    if let firstRow, let lastRow, isRow(firstRow), isRow(lastRow), !cells.isEmpty,
      cells.first == state.firstChild(of: firstRow), cells.last == state.lastChild(of: lastRow)
    {
      selectPrevious(table)
      let parent = state.parent(of: table)
      try remove(table)
      if let parent, state[parent].isRoot, isEmpty(parent), let range = self.selection {
        try insertParagraph(range)
      }
      return
    }
    for cell in cells {
      let first = state.firstChild(of: cell)
      let paragraph =
        first.flatMap { state[$0].type == SerializedParagraphNode.type ? copyNode($0) : nil }
        ?? create(SerializedParagraphNode.type)
      try append(paragraph, [createText("")])
      try append(cell, [paragraph])
      for child in state.children(of: cell) where child != paragraph {
        try remove(child)
      }
    }
    clearSelection()
  }

  /// Each table's FORMAT_TEXT_COMMAND handler, `$formatCells`: every
  /// selected cell's content, toggled as its first cell's paragraph has
  /// the format.
  mutating func formatCells(_ selection: TableSelection, _ type: TextFormatType) throws {
    let cells = try cells(of: selection)
    guard let firstCell = cells.first else { throw EditorError.invalidState("No table cells present") }
    let align = state.firstChild(of: firstCell).flatMap { paragraph in
      state[paragraph].type == SerializedParagraphNode.type
        ? type.toggled(in: textFormat(of: paragraph), aligningWith: nil) : nil
    }
    let cellRange = RangeSelection(
      anchor: SelectionPoint(EditorState.rootKey, 0, .element), focus: SelectionPoint(EditorState.rootKey, 0, .element),
      format: [], style: "")
    for cell in cells {
      cellRange.anchor.set(cell, 0, .element)
      cellRange.focus.set(cell, state.childCount(of: cell), .element)
      try formatText(cellRange, type, aligningWith: align)
    }
    setSelection(selection)
  }

  /// Each table's KEY_TAB_COMMAND handler: a caret in a cell moves to the
  /// end of the next cell or the previous, and out of the table past its
  /// last or first. False where the table doesn't take the Tab.
  mutating func tabHandler(backward: Bool) throws -> Bool {
    guard let selection, selection.isCollapsed,
      let cell = findParent(from: selection.anchor.key, where: isCell),
      findParent(from: cell, where: isTable) != nil
    else { return false }
    try selectAdjacentCell(cell, backward ? .previous : .next)
    return true
  }

  /// `$selectAdjacentCell`.
  private mutating func selectAdjacentCell(_ cell: NodeKey, _ direction: CaretDirection) throws {
    let state = self.state
    let sibling = { (key: NodeKey) in
      direction == .next ? state.nextSibling(of: key) : state.previousSibling(of: key)
    }
    if let adjacent = sibling(cell), state[adjacent].isElement {
      selectEnd(adjacent)
      return
    }
    guard let row = findParent(from: cell, where: isRow) else {
      throw EditorError.invalidState("selectAdjacentCell: Cell not in table row")
    }
    var nextRow = sibling(row)
    while let current = nextRow, isRow(current) {
      if let child = direction == .next ? state.firstChild(of: current) : state.lastChild(of: current),
        state[child].isElement
      {
        selectEnd(child)
        return
      }
      nextRow = sibling(current)
    }
    guard let table = findParent(from: row, where: isTable) else {
      throw EditorError.invalidState("selectAdjacentCell: Row not in table")
    }
    if direction == .next {
      selectNext(table)
    } else {
      selectPrevious(table)
    }
  }

  /// TablePlugin's SELECT_ALL_COMMAND handler: in a document of only a
  /// table, every cell. False where it leaves select all to rich text.
  mutating func selectAllCells() throws -> Bool {
    guard let selection, let table = findParent(from: selection.anchor.key, where: isTable),
      state.parent(of: table) == EditorState.rootKey, state.childCount(of: EditorState.rootKey) == 1
    else { return false }
    let (map, _, _) = try computeTableMapSkipCellCheck(table, nil, nil)
    guard let first = map.first?.first ?? nil, let last = map.last?.last ?? nil else { return false }
    setSelection(TableSelection(table: table, anchor: first.cell.key, focus: last.cell.key))
    return true
  }
}
