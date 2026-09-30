import OrderedCollections

/// Headings and quotes: `$setBlocksType` from @lexical/selection, as the web
/// toolbar's block menu calls it, and what @lexical/rich-text's HeadingNode
/// and QuoteNode do when Enter splits them and Backspace reaches their start.
extension Update {
  mutating func formatElement(_ selection: RangeSelection, _ format: EditorCommand.ElementAlignment) throws {
    formatElements(try nodes(in: selection), format)
  }

  mutating func formatElements(_ nodes: [NodeKey], _ format: EditorCommand.ElementAlignment) {
    for node in nodes {
      if let element = findParent(from: node, where: { state[$0].isElement && !state[$0].isInline }) {
        modifyElement(element) { $0.format = ElementFormat(rawValue: format.rawValue)! }
      }
    }
  }

  mutating func formatElement(_ selection: TableSelection, _ format: EditorCommand.ElementAlignment) throws {
    let (map, anchor, focus) = try computeTableMap(selection.table, selection.anchor, selection.focus)
    let rect = rectBoundary(map, anchor, focus)
    let value = ElementFormat(rawValue: format.rawValue)!
    if rect.minRow == 0 && rect.minColumn == 0 && rect.maxRow == map.count - 1 && rect.maxColumn == map[0].count - 1 {
      modifyElement(selection.table) { $0.format = value }
      return
    }
    for cell in try cells(of: selection) {
      modifyElement(cell) { $0.format = value }
      for child in state.children(of: cell) where state[child].isElement && !state[child].isInline {
        modifyElement(child) { $0.format = value }
      }
    }
  }

  mutating func setWritingDirection(_ selection: RangeSelection, _ direction: EditorCommand.WritingDirection) throws {
    for block in try blocks(in: selection) {
      modifyElement(block) { $0.direction = direction == .auto ? .null : .value(direction == .rtl ? .rtl : .ltr) }
    }
  }

  mutating func formatCode(_ selection: RangeSelection) throws {
    if state.isCollapsed(try state.caretRange(from: selection)) {
      for block in try blocks(in: selection) {
        let code = create(SerializedDocumentCodeNode.type)
        try copyBlockFormatIndent(from: block, to: code)
        try replace(block, with: code, includingChildren: true)
      }
    } else {
      let text = try textContent(selection)
      try insertNodes(selection, [create(SerializedDocumentCodeNode.type)])
      if let next = self.selection { try insertCodeSource(text, at: next) }
    }
  }

  mutating func insertCodeSource(_ text: String, at selection: RangeSelection) throws {
    var nodes: [NodeKey] = []
    for (index, line) in text.components(separatedBy: "\n").enumerated() {
      if index > 0 { nodes.append(create(SerializedLineBreakNode.type)) }
      for (tabIndex, part) in line.components(separatedBy: "\t").enumerated() {
        if tabIndex > 0 { nodes.append(create(SerializedTabNode.type)) }
        if !part.isEmpty { nodes.append(createText(part)) }
      }
    }
    try insertNodes(selection, nodes)
  }

  /// `$setBlockType` in @packages/lexical-nodes.
  mutating func setBlockType(_ selection: RangeSelection, _ type: BlockType) throws {
    try replace(try blocks(in: selection), with: type)
  }

  /// `$setBlockType` over cells. A table selection's points are on cells,
  /// which aren't blocks, so `$setBlocksType` takes the blocks among the
  /// selected cells' nodes alone, in `getNodes`' order.
  mutating func setBlockType(_ selection: TableSelection, _ type: BlockType) throws {
    var blocks: [NodeKey] = []
    func visit(_ node: NodeKey) {
      if state[node].isElement, isBlock(node) { blocks.append(node) }
      state.children(of: node).reversed().forEach(visit)
    }
    try cells(of: selection).forEach(visit)
    try replace(blocks, with: type)
  }

  /// Each of `blocks` replaced by a new block of `type` that takes its
  /// children, format and indent.
  private mutating func replace(_ blocks: some Sequence<NodeKey>, with type: BlockType) throws {
    for block in blocks {
      let element =
        switch type {
        case .paragraph: create(SerializedParagraphNode.type)
        case .quote: create(SerializedQuoteNode.type)
        case .h1, .h2, .h3, .h4, .h5, .h6: createHeading(HeadingTag(rawValue: type.rawValue)!)
        }
      try copyBlockFormatIndent(from: block, to: element)
      try replace(block, with: element, includingChildren: true)
    }
  }

  /// `$setBlocksType`'s blocks: every block the selection touches, leaving
  /// out a block the selection's focus only reaches the near edge of.
  private func blocks(in selection: RangeSelection) throws -> OrderedSet<NodeKey> {
    let (anchor, focus) = (selection.anchor, selection.focus)
    let anchorBlock = findParent(from: anchor.key, where: isBlock)
    let focusBlock = findParent(from: focus.key, where: isBlock)
    let direction: CaretDirection = try state.isBackward(selection) ? .previous : .next
    var skipFocus = false
    if let focusBlock, state[focusBlock].isElement, focusBlock != anchorBlock {
      skipFocus = try isPointAtBlockEdge(focus, focusBlock, direction.flipped)
    }
    var blocks: OrderedSet<NodeKey> = []
    if let anchorBlock, state[anchorBlock].isElement { blocks.append(anchorBlock) }
    if let focusBlock, state[focusBlock].isElement, !skipFocus { blocks.append(focusBlock) }
    for node in try nodes(in: selection) where state[node].isElement && isBlock(node) {
      if skipFocus, node == focusBlock { continue }
      blocks.append(node)
    }
    return blocks
  }

  /// `$isPointAtBlockEdge`: an empty block counts as wholly selected rather
  /// than touched at an edge.
  private func isPointAtBlockEdge(_ point: SelectionPoint, _ block: NodeKey, _ direction: CaretDirection) throws
    -> Bool
  {
    if state[point.key].isElement, isEmpty(point.key) { return false }
    return try isAtEdge(point, of: block, direction)
  }

  /// `$isAtEdgeOfElement`: nothing lies between the point and that edge of
  /// `element`.
  private func isAtEdge(_ point: SelectionPoint, of element: NodeKey, _ direction: CaretDirection) throws -> Bool {
    var caret: Caret? = try state.caret(from: point, direction)
    if let caret, state.isExtendableTextCaret(caret) { return false }
    while let current = caret {
      guard let parent = state.parentAtCaret(current), state.nodeAtCaret(current) == nil else { return false }
      if parent == element { return true }
      caret = state.parentCaret(current)
    }
    return false
  }

  /// `$copyBlockFormatIndent`.
  private mutating func copyBlockFormatIndent(from source: NodeKey, to destination: NodeKey) throws {
    let json = state[source].payload.json
    let format = json["format"]?.stringValue.flatMap(ElementFormat.init(rawValue:)) ?? .empty
    let indent = try requireWholeIndent(of: source)
    let destinationJSON = state[destination].payload.json
    if format.rawValue != destinationJSON["format"]?.stringValue ?? "" {
      modifyElement(destination) { $0.format = format }
    }
    if indent != self.indent(of: destination) {
      modifyElement(destination) { $0.editorIndent = indent }
    }
  }

  // MARK: HeadingNode and QuoteNode

  /// `$createHeadingNode`.
  mutating func createHeading(_ tag: HeadingTag) -> NodeKey {
    let heading = create(SerializedHeadingNode.type)
    if case .heading(var node) = state[heading].payload {
      node.tag = tag
      state.nodes[heading]!.payload = .heading(node)
    }
    return heading
  }

  /// `HeadingNode.insertNewAfter`: a paragraph after a heading's end, and the
  /// rest of the heading as another heading of its tag inside it. Split at
  /// its start, the heading becomes a paragraph, which is left empty once the
  /// split moves what it held on.
  mutating func insertAfterHeading(_ heading: NodeKey, _ selection: RangeSelection, restoringSelection: Bool)
    throws -> NodeKey
  {
    guard case .heading(let old) = state[heading].payload else {
      throw EditorError.invalidState("Not a heading")
    }
    let anchorOffset = selection.anchor.offset
    let isAtEnd = lastDescendant(of: heading).map { last in
      selection.anchor.key == last && anchorOffset == state.textContent(of: last).utf16.count
    } ?? true
    let newElement: NodeKey
    if isAtEnd {
      newElement = create(SerializedParagraphNode.type)
    } else {
      newElement = createHeading(old.tag ?? .h1)
      modifyElement(newElement) { $0.format = old.format }
    }
    modifyElement(newElement) { $0.direction = old.direction }
    try insert(newElement, after: heading, restoringSelection: restoringSelection)
    if anchorOffset == 0, !isEmpty(heading) {
      let paragraph = create(SerializedParagraphNode.type)
      selectElement(paragraph)
      try replace(heading, with: paragraph, includingChildren: true)
    }
    return newElement
  }

  /// `HeadingNode.collapseAtStart`: an empty heading becomes a paragraph, and
  /// one with text stays as it is.
  mutating func collapseHeadingAtStart(_ heading: NodeKey) throws {
    guard isEmpty(heading) else { return }
    try replace(heading, with: create(SerializedParagraphNode.type))
  }

  /// `QuoteNode.collapseAtStart`: the quote becomes a paragraph holding what
  /// it held.
  mutating func collapseQuoteAtStart(_ quote: NodeKey) throws {
    let paragraph = create(SerializedParagraphNode.type)
    for child in state.children(of: quote) {
      try append(paragraph, [child])
    }
    try replace(quote, with: paragraph)
  }

  /// Changes the properties an element keeps, where `key` is an element that
  /// keeps them.
  mutating func modifyElement(_ key: NodeKey, _ change: (inout any ElementFields) -> Void) {
    modify(key) { node in
      guard var fields = node.payload.elementFields else { return }
      change(&fields)
      node.payload.elementFields = fields
    }
  }
}

/// The properties ElementNode keeps, which a paragraph, a heading, a quote,
/// a list, a list item, a link, the root and a table's nodes save.
protocol ElementFields {
  var direction: Nullable<Direction> { get set }
  var format: ElementFormat? { get set }
  var editorIndent: Int? { get set }
  var textFormat: Double? { get set }
  var textStyle: String? { get set }
}

protocol IntegerElementFields: ElementFields { var indent: Int? { get set } }
extension IntegerElementFields {
  var editorIndent: Int? {
    get { indent }
    set { indent = newValue }
  }
}
protocol FloatingElementFields: ElementFields { var indent: Double? { get set } }
extension FloatingElementFields {
  var editorIndent: Int? {
    get { indent.flatMap { $0.isFinite && $0.rounded(.towardZero) == $0 && $0 >= Double(Int.min) && $0 < Double(Int.max) ? Int($0) : nil } }
    set { indent = newValue.map(Double.init) }
  }
}
extension SerializedCalloutNode: IntegerElementFields {}
extension SerializedLayoutContainerNode: IntegerElementFields {}
extension SerializedLayoutItemNode: FloatingElementFields {}
extension SerializedCollapsibleContainerNode: FloatingElementFields {}
extension SerializedCollapsibleContentNode: FloatingElementFields {}
extension SerializedCollapsibleTitleNode: FloatingElementFields {}

extension SerializedDocumentCodeNode: IntegerElementFields {}
extension SerializedParagraphNode: IntegerElementFields {}
extension SerializedHeadingNode: IntegerElementFields {}
extension SerializedQuoteNode: IntegerElementFields {}
extension SerializedListNode: IntegerElementFields {}
extension SerializedListItemNode: IntegerElementFields {}
extension SerializedRootNode: IntegerElementFields {}
extension SerializedLinkNode: IntegerElementFields {}
extension SerializedAutoLinkNode: IntegerElementFields {}
extension SerializedTableNode: IntegerElementFields {}
extension SerializedTableRowNode: IntegerElementFields {}
extension SerializedTableCellNode: IntegerElementFields {}
extension SerializedFootnoteDefinitionNode: IntegerElementFields {}

extension SerializedNode {
  var elementFields: (any ElementFields)? {
    get {
      switch self {
      case .paragraph(let node): node
      case .documentCode(let node): node
      case .footnoteDefinition(let node): node
      case .heading(let node): node
      case .quote(let node): node
      case .list(let node): node
      case .listItem(let node): node
      case .root(let node): node
      case .link(let node): node
      case .autoLink(let node): node
      case .table(let node): node
      case .tableRow(let node): node
      case .tableCell(let node): node
      case .collapsibleTitle(let node): node
      case .collapsibleContent(let node): node
      case .collapsibleContainer(let node): node
      case .layoutItem(let node): node
      case .layoutContainer(let node): node
      case .callout(let node): node
      default: nil
      }
    }
    set {
      switch newValue {
      case let node as SerializedDocumentCodeNode: self = .documentCode(node)
      case let node as SerializedParagraphNode: self = .paragraph(node)
      case let node as SerializedFootnoteDefinitionNode: self = .footnoteDefinition(node)
      case let node as SerializedHeadingNode: self = .heading(node)
      case let node as SerializedQuoteNode: self = .quote(node)
      case let node as SerializedListNode: self = .list(node)
      case let node as SerializedListItemNode: self = .listItem(node)
      case let node as SerializedRootNode: self = .root(node)
      case let node as SerializedLinkNode: self = .link(node)
      case let node as SerializedAutoLinkNode: self = .autoLink(node)
      case let node as SerializedTableNode: self = .table(node)
      case let node as SerializedTableRowNode: self = .tableRow(node)
      case let node as SerializedTableCellNode: self = .tableCell(node)
      case let node as SerializedCollapsibleTitleNode: self = .collapsibleTitle(node)
      case let node as SerializedCollapsibleContentNode: self = .collapsibleContent(node)
      case let node as SerializedCollapsibleContainerNode: self = .collapsibleContainer(node)
      case let node as SerializedLayoutItemNode: self = .layoutItem(node)
      case let node as SerializedLayoutContainerNode: self = .layoutContainer(node)
      case let node as SerializedCalloutNode: self = .callout(node)
      default: break
      }
    }
  }
}
