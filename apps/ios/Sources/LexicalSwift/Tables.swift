import OrderedCollections

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

  mutating func modifyCell(_ cell: NodeKey, _ change: (inout SerializedTableCellNode) -> Void) {
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
  mutating func createCell(headerState: Int) -> NodeKey {
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

  /// What reading a property of `map[row][column]` throws where there's no
  /// cell.
  static let noCell = EditorError.invalidState("Cannot read properties of undefined (reading 'cell')")

  /// `map[row][column]` where Lexical reads a property of it.
  private func entry(_ row: [TableMapValue?]?, _ column: Int) throws -> TableMapValue {
    guard let row, row.indices.contains(column), let value = row[column] else { throw Self.noCell }
    return value
  }

  func entry(_ map: TableMap, _ row: Int, _ column: Int) throws -> TableMapValue {
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
  func rectBoundary(_ map: TableMap, _ a: TableMapValue, _ b: TableMapValue) -> (
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
    Array(OrderedSet(try rectCells(of: selection)))
  }

  /// The cell at each place of a table selection's rectangle, row by row,
  /// a merged cell at each place it covers.
  private func rectCells(of selection: TableSelection) throws -> [NodeKey] {
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
        cells.append(try entry(map, row, column).cell.key)
      }
    }
    return cells
  }

  /// `TableSelection.getNodes()`: the table, then row by row each selected
  /// cell's row where it's a new one, and the cell with all it holds, as
  /// `$visitRecursively` visits it: last child first.
  func nodes(in selection: TableSelection) throws -> [NodeKey] {
    let cells = try rectCells(of: selection)
    guard !cells.isEmpty else { return [] }
    var nodes: OrderedSet<NodeKey> = [selection.table]
    var lastRow: NodeKey?
    func visit(_ node: NodeKey) {
      nodes.append(node)
      state.children(of: node).reversed().forEach(visit)
    }
    for cell in cells {
      guard let row = state.parent(of: cell), isRow(row) else {
        throw EditorError.invalidState("Expected TableCellNode parent to be a TableRowNode")
      }
      if row != lastRow {
        nodes.append(row)
        lastRow = row
      }
      if !nodes.contains(cell) { visit(cell) }
    }
    return Array(nodes)
  }

  /// `TableSelection.getTextContent`: each selected cell's text, and a tab
  /// after it or, before a cell of another row or at the end, a newline.
  func textContent(_ selection: TableSelection) throws -> String {
    let cells = try nodes(in: selection).filter(isCell)
    var text = ""
    for (index, cell) in cells.enumerated() {
      let next = index + 1 < cells.count ? state.parent(of: cells[index + 1]) : nil
      text += state.textContent(of: cell) + (next != state.parent(of: cell) ? "\n" : "\t")
    }
    return text
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
    if let tableSelection {
      return (
        SelectionPoint(KeyPoint(key: tableSelection.anchor, offset: 0, type: .element)),
        SelectionPoint(KeyPoint(key: tableSelection.focus, offset: 0, type: .element))
      )
    }
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
    let initial: Caret
    if let nodeSelection, let last = nodes(in: nodeSelection).last {
      initial = .sibling(last, .next)
    } else {
      guard tableSelection == nil, let selection, findParent(from: selection.anchor.key, where: isTable) == nil else {
        return
      }
      initial = try state.caret(from: selection.focus, .next)
    }
    let table = try createDocumentTable(rows: rows, columns: columns)
    try insertNodeToNearestRoot(table, from: initial)
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

  /// `$insertNodeToNearestRoot` from @lexical/utils, from a range
  /// selection's focus or after the last selected node.
  private mutating func insertNodeToNearestRoot(_ node: NodeKey, from initial: Caret) throws {
    let hasContentAfter =
      state.isExtendableTextCaret(initial)
      || adjacentSiblingOrParentSiblingCaret(initial.isText ? state.siblingCaret(initial) : initial) != nil
    let inserted = try insertNodeToNearestRoot(node, at: initial, splittingLast: !hasContentAfter)
    let adjacent = state.adjacentChildCaret(inserted)
    let caret = adjacent.map { $0.isChild ? state.normalize($0) : inserted } ?? inserted
    setSelection(from: CaretRange(anchor: caret, focus: caret))
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

  mutating func toggleTableRowHeaderFromMenu() throws {
    guard selection != nil || tableSelection != nil else { return }
    let (anchor, _) = try selectionPoints()
    let (_, row, _) = try nodeTriplet(anchor.key)
    for cell in Array(state.children(of: row)) {
      let value = headerState(of: cell) ^ HeaderState.row
      modifyCell(cell) { $0.headerState = Double(value) }
    }
    selectStart(EditorState.rootKey)
  }

  mutating func toggleTableColumnHeaderFromMenu() throws {
    guard selection != nil || tableSelection != nil else { return }
    let (anchor, _) = try selectionPoints()
    let (cell, row, table) = try nodeTriplet(anchor.key)
    let column = Array(state.children(of: row)).firstIndex(of: cell)!
    for row in Array(state.children(of: table)) {
      let children = Array(state.children(of: row))
      guard column < children.count else { continue }
      let cell = children[column]
      let value = headerState(of: cell) ^ HeaderState.column
      modifyCell(cell) { $0.headerState = Double(value) }
    }
    selectStart(EditorState.rootKey)
  }

  mutating func setTableCellBackgroundFromMenu(_ color: String) throws {
    guard selection != nil || tableSelection != nil else { return }
    let (anchor, _) = try selectionPoints()
    let cell = try nodeTriplet(anchor.key).cell
    var selected = [cell]
    if let tableSelection { selected += try nodes(in: tableSelection).filter(isCell) }
    for cell in Set(selected) { modifyCell(cell) { $0.backgroundColor = .value(color) } }
  }

  /// `$mergeDocumentTableCells`: the menu removes the first empty paragraph
  /// before gathering content, even when all selected cells are empty.
  mutating func mergeTableCellsFromMenu() throws {
    guard let tableSelection else { return }
    guard let anchor = try cellRect(tableSelection.anchor), let focus = try cellRect(tableSelection.focus) else {
      throw EditorError.invalidState("getCellRect: expected to find selection cell")
    }
    let columns = max(anchor.column + anchor.colSpan - 1, focus.column + focus.colSpan - 1) - min(anchor.column, focus.column) + 1
    let rows = max(anchor.row + anchor.rowSpan - 1, focus.row + focus.rowSpan - 1) - min(anchor.row, focus.row) + 1
    let selected = try nodes(in: tableSelection).filter(isCell)
    guard let first = selected.first else { return }
    setColSpan(first, columns)
    setRowSpan(first, rows)
    if containsEmptyParagraph(first), let child = state.firstChild(of: first) { try remove(child) }
    for cell in selected.dropFirst() {
      if !containsEmptyParagraph(cell) { try append(first, Array(state.children(of: cell))) }
      try remove(cell)
    }
    if isEmpty(first) { try append(first, [create(SerializedParagraphNode.type)]) }
    selectEnd(first)
  }

  mutating func unmergeTableCellFromMenu() throws {
    let (anchor, _) = try selectionPoints()
    try unmergeCell(read(try nodeTriplet(anchor.key).cell))
  }

  mutating func deleteTableFromMenu() throws {
    guard selection != nil || tableSelection != nil else { return }
    let (anchor, _) = try selectionPoints()
    let (_, _, table) = try nodeTriplet(anchor.key)
    try remove(table)
    selectStart(EditorState.rootKey)
  }

  // MARK: Rows and columns

  /// `$insertDocumentTableRows`, counting before insertion changes the selection.
  mutating func insertDocumentTableRows(after: Bool) throws {
    var count = 1
    if let tableSelection {
      guard let anchor = try cellRect(tableSelection.anchor), let focus = try cellRect(tableSelection.focus) else {
        throw EditorError.invalidState("getCellRect: expected to find cell")
      }
      count = max(anchor.row + anchor.rowSpan - 1, focus.row + focus.rowSpan - 1) - min(anchor.row, focus.row) + 1
    }
    for _ in 0..<count { try insertTableRowAtSelection(after: after) }
  }

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
  /// cell where `movingSelection`.
  private mutating func insertTableColumn(at cell: NodeKey, after: Bool, movingSelection: Bool = true) throws {
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
    if let firstInserted, movingSelection { moveSelection(toCell: firstInserted) }
    if var widths = colWidths(of: table) {
      let index = max(insertAfterColumn, 0)
      guard widths.indices.contains(index) else {
        throw EditorError.invalidState("After $tableTransform a table has a width for each column")
      }
      widths.insert(widths[index], at: index)
      setColWidths(table, widths)
    }
  }

  /// `$deleteTableRowAtSelection`.
  mutating func deleteTableRowAtSelection() throws {
    let (anchor, focus) = try selectionPoints()
    let isBackward = try selection.map(state.isBackward) ?? state.isBefore(focus, anchor)
    let (first, last) = isBackward ? (focus.key, anchor.key) : (anchor.key, focus.key)
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

  // MARK: The clipboard

  /// TablePlugin's SELECTION_INSERT_CLIPBOARD_NODES_COMMAND handler: over
  /// selected cells, pasted nodes without a table go in as their text, a
  /// table alone pasted into a grid is laid out over it, and a table with
  /// anything else is turned away. False where it leaves the nodes to the
  /// selection.
  mutating func tableSelectionInsertClipboardNodes(_ nodes: [NodeKey], _ target: ClipboardSelection) throws -> Bool {
    guard nodes.contains(where: holdsTable) else {
      guard case .cells(let selection) = target else { return false }
      var text = ""
      var lastWasBlock = false
      for node in nodes {
        let isBlock = state[node].isElement && !state[node].isInline
        if !text.isEmpty, isBlock || lastWasBlock { text += "\n" }
        text += state.textContent(of: node)
        lastWasBlock = isBlock
      }
      try insertRawText(selection, text)
      return true
    }
    switch target {
    case .range(let selection)
    where findParent(from: selection.anchor.key, where: isCell) == nil
      || findParent(from: selection.focus.key, where: isCell) == nil:
      return false
    // Selected nodes aren't a grid's.
    case .nodes: return false
    default: break
    }
    if nodes.count == 1, isTable(nodes[0]) { return try insertTableIntoGrid(nodes[0], target) }
    // The web's tables don't nest, so a table pasted with more is refused.
    return true
  }

  private func holdsTable(_ node: NodeKey) -> Bool {
    isTable(node) || state.children(of: node).contains(where: holdsTable)
  }

  /// `TableSelection.insertRawText`: the text cut into cells at tabs and
  /// into rows at line ends, and laid out over the grid from the anchor's
  /// cell as a pasted table is.
  mutating func insertRawText(_ selection: TableSelection, _ text: String) throws {
    var units = Array(text.utf16)
    guard !units.isEmpty else { return }
    if units.last == 10 { units.removeLast() }
    let table = create(SerializedTableNode.type)
    for line in units.split(separator: 10, omittingEmptySubsequences: false) {
      let row = create(SerializedTableRowNode.type)
      for cellText in line.split(separator: 9, omittingEmptySubsequences: false) {
        let cell = createCell(headerState: HeaderState.none)
        let paragraph = create(SerializedParagraphNode.type)
        if !cellText.isEmpty { try append(paragraph, [createText(String(decoding: cellText, as: UTF16.self))]) }
        try append(cell, [paragraph])
        try append(row, [cell])
      }
      try append(table, [row])
    }
    let anchorCell = try cellNodes(selection).anchor
    let range = selectElement(anchorCell, 0, state.childCount(of: anchorCell))
    _ = try insertTableIntoGrid(table, .range(range))
  }

  /// `TableSelection.insertNodes`: into the focus cell, its content selected
  /// whole.
  mutating func insertNodes(_ selection: TableSelection, _ nodes: [NodeKey]) throws {
    guard state[selection.focus].isElement else {
      throw EditorError.invalidState("Expected TableSelection focus to be an ElementNode")
    }
    let range = selectElement(selection.focus, 0, state.childCount(of: selection.focus))
    normalizeSelection(range)
    try insertNodes(range, nodes)
  }

  /// `$getCellNodes`: the cells a table selection's points are in, which
  /// are in one table.
  private func cellNodes(_ selection: TableSelection) throws -> (anchor: NodeKey, focus: NodeKey) {
    let anchor = try nodeTriplet(selection.anchor)
    let focus = try nodeTriplet(selection.focus)
    guard anchor.table == focus.table else {
      throw EditorError.invalidState("Expected TableSelection anchor and focus to be in the same table")
    }
    return (anchor.cell, focus.cell)
  }

  /// `$insertTableIntoGrid`: `template`'s cells laid out over the grid from
  /// the anchor's cell, growing it where they reach past it, and over no
  /// more than the selected cells of a table selection. The grid's merged
  /// cells there are split, the template's merged again, and each cell
  /// takes its template's content, fill and alignment.
  mutating func insertTableIntoGrid(_ template: NodeKey, _ target: ClipboardSelection) throws -> Bool {
    let (anchorKey, focusKey): (NodeKey, NodeKey)
    switch target {
    case .range(let selection): (anchorKey, focusKey) = (selection.anchor.key, selection.focus.key)
    case .cells(let selection): (anchorKey, focusKey) = (selection.anchor, selection.focus)
    case .nodes: return false
    }
    let (anchorCell, _, grid) = try nodeTriplet(anchorKey)
    guard let focusCell = findParent(from: focusKey, where: isCell) else { return false }
    let (initialMap, anchorValue, focusValue) = try computeTableMap(grid, anchorCell, focusCell)
    let (templateMap, _, _) = try computeTableMapSkipCellCheck(template, nil, nil)
    let initialRowCount = initialMap.count
    let initialColumnCount = initialMap.first?.count ?? 0
    var (startRow, startColumn) = (anchorValue.startRow, anchorValue.startColumn)
    var affectedRowCount = templateMap.count
    var affectedColumnCount = templateMap.first?.count ?? 0
    let isTableSelection = if case .cells = target { true } else { false }
    if isTableSelection {
      let boundary = rectBoundary(initialMap, anchorValue, focusValue)
      (startRow, startColumn) = (boundary.minRow, boundary.minColumn)
      affectedRowCount = min(affectedRowCount, boundary.maxRow - boundary.minRow + 1)
      affectedColumnCount = min(affectedColumnCount, boundary.maxColumn - boundary.minColumn + 1)
    }

    var didMerge = false
    var unmerged: Set<NodeKey> = []
    for row in stride(from: startRow, to: min(initialRowCount, startRow + affectedRowCount), by: 1) {
      for column in stride(from: startColumn, to: min(initialColumnCount, startColumn + affectedColumnCount), by: 1) {
        let cell = try entry(initialMap, row, column).cell
        guard !unmerged.contains(cell.key), rowSpan(cell) != 1 || colSpan(cell) != 1 else { continue }
        try unmergeCell(cell)
        unmerged.insert(cell.key)
        didMerge = true
      }
    }

    markDirty(grid)
    var (interimMap, _, _) = try computeTableMapSkipCellCheck(grid, nil, nil)
    for _ in stride(from: 0, to: affectedRowCount - initialRowCount + startRow, by: 1) {
      try insertTableRow(at: try entry(interimMap, initialRowCount - 1, 0).cell.key, after: true)
    }
    for _ in stride(from: 0, to: affectedColumnCount - initialColumnCount + startColumn, by: 1) {
      try insertTableColumn(
        at: try entry(interimMap, 0, initialColumnCount - 1).cell.key, after: true, movingSelection: false)
    }
    markDirty(grid)
    (interimMap, _, _) = try computeTableMapSkipCellCheck(grid, nil, nil)

    for row in startRow..<(startRow + affectedRowCount) {
      for column in startColumn..<(startColumn + affectedColumnCount) {
        let (templateRow, templateColumn) = (row - startRow, column - startColumn)
        let templateValue = try entry(templateMap, templateRow, templateColumn)
        guard templateValue.startRow == templateRow, templateValue.startColumn == templateColumn else { continue }
        let templateCell = templateValue.cell.key
        let (spanRows, spanColumns) = (rowSpan(templateValue.cell), colSpan(templateValue.cell))
        if spanRows != 1 || spanColumns != 1 {
          var cells: [NodeKey] = []
          for r in stride(from: row, to: min(row + spanRows, startRow + affectedRowCount), by: 1) {
            for c in stride(from: column, to: min(column + spanColumns, startColumn + affectedColumnCount), by: 1) {
              cells.append(try entry(interimMap, r, c).cell.key)
            }
          }
          try mergeCells(cells)
          didMerge = true
        }
        let cell = try entry(interimMap, row, column).cell.key
        if let fields = cellNode(templateCell) {
          if case .value(let color) = fields.backgroundColor { modifyCell(cell) { $0.backgroundColor = .value(color) } }
          if let align = fields.verticalAlign { modifyCell(cell) { $0.verticalAlign = align } }
        }
        let originalChildren = Array(state.children(of: cell))
        for child in Array(state.children(of: templateCell)) {
          // Lexical wraps a text in a paragraph and then appends the text
          // itself, leaving the paragraph empty and out of the document.
          if state[child].isText { try append(create(SerializedParagraphNode.type), [child]) }
          try append(cell, [child])
        }
        for child in originalChildren { try remove(child) }
      }
    }

    if isTableSelection, didMerge {
      markDirty(grid)
      let (finalMap, _, _) = try computeTableMapSkipCellCheck(grid, nil, nil)
      selectEnd(try entry(finalMap, anchorValue.startRow, anchorValue.startColumn).cell.key)
    }
    return true
  }

  /// `$unmergeCellNode`: a merged cell split into cells of one place each,
  /// the new ones empty copies of it, each a header where every cell of
  /// its column or row is one.
  private mutating func unmergeCell(_ read: CellRead) throws {
    let (cell, row, grid) = try nodeTriplet(read.key)
    let (spanColumns, spanRows) = (colSpan(read), rowSpan(read))
    guard spanColumns != 1 || spanRows != 1 else { return }
    let (map, value, _) = try computeTableMap(grid, cell, cell)
    let (startColumn, startRow) = (value.startColumn, value.startRow)
    let columnCount = map.first?.count ?? 0
    let colStyles = try (0..<spanColumns).map { i in
      var style = headerState(of: cell) & HeaderState.column
      var rowIndex = 0
      while style != 0, rowIndex < map.count {
        style &= headerState(of: try entry(map, rowIndex, i + startColumn).cell.key)
        rowIndex += 1
      }
      return style
    }
    let rowStyles = try (0..<spanRows).map { i in
      var style = headerState(of: cell) & HeaderState.row
      var columnIndex = 0
      while style != 0, columnIndex < columnCount {
        style &= headerState(of: try entry(map, i + startRow, columnIndex).cell.key)
        columnIndex += 1
      }
      return style
    }
    func splitCell(_ update: inout Update, _ headerState: Int) throws -> NodeKey {
      let split = update.copyNode(cell)
      update.modifyCell(split) {
        $0.colSpan = 1
        $0.rowSpan = 1
        $0.headerState = Double(headerState)
        $0.width = nil
      }
      try update.append(split, [update.create(SerializedParagraphNode.type)])
      return split
    }
    if spanColumns > 1 {
      for i in 1..<spanColumns {
        try insert(splitCell(&self, colStyles[i] | rowStyles[0]), after: cell)
      }
      setColSpan(cell, 1)
    }
    guard spanRows > 1 else { return }
    var currentRowNode = row
    for i in 1..<spanRows {
      let currentRow = startRow + i
      guard let next = state.nextSibling(of: currentRowNode), isRow(next) else {
        throw EditorError.invalidState("Expected row next sibling to be a row")
      }
      currentRowNode = next
      var insertAfterCell: NodeKey?
      var column = 0
      while column < startColumn {
        let beside = try entry(map, currentRow, column)
        if beside.startRow == currentRow { insertAfterCell = beside.cell.key }
        column += max(colSpan(beside.cell), 1)
      }
      for j in stride(from: spanColumns - 1, through: 0, by: -1) {
        let split = try splitCell(&self, colStyles[j] | rowStyles[i])
        if let insertAfterCell {
          try insert(split, after: insertAfterCell)
        } else {
          try insertFirst(next, split)
        }
      }
    }
    setRowSpan(cell, 1)
  }

  /// `$mergeCells`: the cells merged into the top left one of the rectangle
  /// they span, which takes in the content of those that have any.
  private mutating func mergeCells(_ cells: [NodeKey]) throws {
    guard let first = cells.first else { return }
    guard let table = findParent(from: first, where: isTable) else {
      throw EditorError.invalidState("Expected table cell to be inside of table.")
    }
    let (map, _, _) = try computeTableMapSkipCellCheck(table, nil, nil)
    var bounds: (minRow: Int, maxRow: Int, minColumn: Int, maxColumn: Int)?
    var processed: Set<NodeKey> = []
    for value in map.joined().compactMap(\.self) where !processed.contains(value.cell.key) {
      guard cells.contains(value.cell.key) else { continue }
      processed.insert(value.cell.key)
      let lastRow = value.startRow + max(rowSpan(value.cell), 1) - 1
      let lastColumn = value.startColumn + max(colSpan(value.cell), 1) - 1
      bounds = (
        min(bounds?.minRow ?? value.startRow, value.startRow), max(bounds?.maxRow ?? lastRow, lastRow),
        min(bounds?.minColumn ?? value.startColumn, value.startColumn), max(bounds?.maxColumn ?? lastColumn, lastColumn)
      )
    }
    guard let bounds else { return }
    let target = try entry(map, bounds.minRow, bounds.minColumn).cell.key
    setColSpan(target, bounds.maxColumn - bounds.minColumn + 1)
    setRowSpan(target, bounds.maxRow - bounds.minRow + 1)
    var seen: Set<NodeKey> = [target]
    for row in bounds.minRow...bounds.maxRow {
      for column in bounds.minColumn...bounds.maxColumn {
        let cell = try entry(map, row, column).cell.key
        guard seen.insert(cell).inserted else { continue }
        if !containsEmptyParagraph(cell) {
          // The target's own empty paragraph goes before content comes in.
          if containsEmptyParagraph(target) {
            for child in Array(state.children(of: target)) { try remove(child) }
          }
          try append(target, Array(state.children(of: cell)))
        }
        try remove(cell)
      }
    }
    if isEmpty(target) { try append(target, [create(SerializedParagraphNode.type)]) }
  }

  /// `$cellContainsEmptyParagraph`.
  private func containsEmptyParagraph(_ cell: NodeKey) -> Bool {
    guard state.childCount(of: cell) == 1, let child = state.firstChild(of: cell) else { return false }
    return state[child].type == SerializedParagraphNode.type && isEmpty(child)
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
  func tables() -> [NodeKey] {
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
    for table in tables() where try deleteCellHandler(table) { return true }
    return false
  }

  /// One table's `$deleteCellHandler`.
  private mutating func deleteCellHandler(_ table: NodeKey) throws -> Bool {
    guard let (anchor, focus) = try? selectionPoints() else { return false }
    let isAnchorInside = hasAncestor(anchor.key, table)
    let isFocusInside = hasAncestor(focus.key, table)
    if isAnchorInside != isFocusInside {
      let (tablePoint, outerPoint) = isAnchorInside ? (anchor, focus) : (focus, anchor)
      let outer = outerPoint.value
      let grown = try state.isBefore(tablePoint, outerPoint) ? selectPrevious(table) : selectNext(table)
      (isAnchorInside ? grown.focus : grown.anchor).set(outer)
      return false
    }
    guard isAnchorInside, let tableSelection else { return false }
    try clearText(tableSelection, observing: table)
    return true
  }

  /// Each table's CUT_COMMAND handler, which takes a cut from rich text in
  /// a document with a table: the selection is copied, then deleted as that
  /// table's `$deleteCellHandler` deletes, and a range's text removed. True
  /// where a table's handler took the cut.
  mutating func cutHandler() throws -> Bool {
    guard hasEditorPlugin("TablePlugin") else { return false }
    for table in tables() {
      if let selection {
        clipboard = try copy(selection) ?? Clipboard(plainText: "")
        _ = try deleteCellHandler(table)
        try removeText(selection)
        return true
      }
      guard let tableSelection else { return false }
      clipboard = try copy(tableSelection)
      if try deleteCellHandler(table) { return true }
    }
    return false
  }

  /// `TableObserver.$clearText`, the observer's of `table`: the selected
  /// cells keep an empty paragraph each, or the table goes where its first
  /// and last cells are the first and last selected.
  mutating func clearText(_ selection: TableSelection, observing table: NodeKey? = nil) throws {
    let table = table ?? selection.table
    guard isTable(table) else { throw EditorError.invalidState("Expected TableNode.") }
    let cells = try nodes(in: selection).filter(isCell)
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
    let cells = try nodes(in: selection).filter(isCell)
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
