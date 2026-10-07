/// The web editor's GFM table transformer (`createTableTransformer` in
/// @packages/lexical-nodes), as a markdown shortcut runs it.
extension Update {
  /// Its `replace`: a divider row under a table makes the table's last row
  /// its header, aligned as the divider says; any other row makes a table,
  /// taking the rows typed in the paragraphs above it and joining a table
  /// above with as many columns. Each cell's text is imported as markdown.
  mutating func replaceWithTable(_ parent: NodeKey, _ groups: [String?]) throws {
    guard let line = groups[0] else { throw EditorError.invalidState("TABLE matched nothing") }
    if Self.tableRowDivider.firstMatch(in: line) != nil {
      return try makeLastRowAHeader(parent, divider: line)
    }
    // Every row is read before anything changes, so a cell that can't be
    // imported leaves the paragraphs as they are.
    guard let cells = try Self.tableCells(line) else { return }
    var rows = [cells]
    var siblings: [NodeKey] = []
    var sibling = state.previousSibling(of: parent)
    while let current = sibling, state[current].type == SerializedParagraphNode.type,
      state.childCount(of: current) == 1, let text = state.firstChild(of: current), state[text].isText,
      let cells = try Self.tableCells(state[text].text)
    {
      rows.insert(cells, at: 0)
      siblings.append(current)
      sibling = state.previousSibling(of: current)
    }
    let columns = rows.map(\.count).max() ?? 0
    let emptyCell = try MarkdownImport.lines("")
    for sibling in siblings { try remove(sibling) }

    let table = create(SerializedTableNode.type)
    for cells in rows {
      let row = create(SerializedTableRowNode.type)
      for column in 0..<columns {
        let cell = createCell(headerState: HeaderState.none)
        try importMarkdown(cells[safe: column] ?? emptyCell, into: cell)
        try append(row, [cell])
      }
      try append(table, [row])
    }

    if let previous = state.previousSibling(of: parent), isTable(previous), try tableColumnsSize(previous) == columns {
      let header = state.firstChild(of: previous).map { Array(state.children(of: $0)) } ?? []
      for row in state.children(of: table) {
        for (index, cell) in state.children(of: row).enumerated() {
          let format = header[safe: index].flatMap { state[$0].payload.elementFields?.format } ?? .empty
          modifyElement(cell) { $0.format = format }
        }
      }
      try append(previous, Array(state.children(of: table)))
      try remove(parent)
      selectEnd(previous)
    } else {
      try replace(parent, with: table)
      selectEnd(table)
    }
  }

  /// The divider's branch: the last row's cells become row headers,
  /// aligned as their column's dashes say, the divider goes and the caret
  /// ends the table. Under no table the divider just goes.
  private mutating func makeLastRowAHeader(_ parent: NodeKey, divider: String) throws {
    guard let table = state.previousSibling(of: parent), isTable(table) else { return }
    guard let lastRow = state.lastChild(of: table), isRow(lastRow) else {
      throw EditorError.invalidState("A table ends in something other than a row")
    }
    let delimiters = Array(divider.utf16).split(separator: Self.pipe, omittingEmptySubsequences: false)
    for (index, cell) in state.children(of: lastRow).enumerated() {
      guard isCell(cell) else { throw EditorError.invalidState("A row holds something other than a cell") }
      let delimiter = MarkdownImport.trimmed(delimiters[safe: index + 1] ?? [])
      let (opens, closes) = (delimiter.first == Self.colon, delimiter.last == Self.colon)
      let format: ElementFormat = opens ? (closes ? .center : .left) : closes ? .right : .empty
      modifyElement(cell) { $0.format = format }
      modifyCell(cell) { $0.headerState = Double(Int($0.headerState ?? 0) | HeaderState.row) }
    }
    try remove(parent)
    selectEnd(table)
  }

  /// `getTableColumnsSize`: how many cells the first row has.
  private func tableColumnsSize(_ table: NodeKey) throws -> Int {
    guard let row = state.firstChild(of: table), isRow(row) else {
      throw EditorError.invalidState("A table starts with something other than a row")
    }
    return state.childCount(of: row)
  }

  /// `mapToTableCells` and `$createTableCell` up to where they make nodes:
  /// a row's cells, split at each pipe not escaped, each trimmed, with
  /// `\|` a pipe and `<br>` a new line, and read as markdown. Nil where the
  /// text isn't a row.
  private static func tableCells(_ text: String) throws -> [[MarkdownImport.Line]]? {
    guard let row = tableRow.firstMatch(in: text)?.groups[1] else { return nil }
    var cells: [MarkdownImport.Text] = [[]]
    for unit in row.utf16 {
      if unit == pipe, cells[cells.count - 1].last != MarkdownImport.backslash {
        cells.append([])
      } else {
        cells[cells.count - 1].append(unit)
      }
    }
    return try cells.map { cell in
      let pipes = replacing([MarkdownImport.backslash, pipe], with: [pipe], in: cell)
      let lines = lineBreak.replacingMatches(in: MarkdownImport.string(MarkdownImport.trimmed(pipes)), with: "\n")
      return try MarkdownImport.lines(lines)
    }
  }

  /// JavaScript's `text.replace(/target/g, replacement)` for a literal
  /// target.
  private static func replacing(
    _ target: MarkdownImport.Text, with replacement: MarkdownImport.Text, in text: MarkdownImport.Text
  ) -> MarkdownImport.Text {
    var result: MarkdownImport.Text = []
    var index = 0
    while index < text.count {
      if text[index...].starts(with: target) {
        result += replacement
        index += target.count
      } else {
        result.append(text[index])
        index += 1
      }
    }
    return result
  }

  private static let tableRow = MarkdownTransformer.regExp(of: .table)
  private static let tableRowDivider = MarkdownTransformer.tableRowDividerRegExp
  private static let pipe = "|".utf16.first!
  private static let colon = ":".utf16.first!
  /// `CELL_LINE_BREAK` in @packages/lexical-nodes.
  private static let lineBreak = JSRegExp("<br\\s*\\/?>", flags: "gi")
}
