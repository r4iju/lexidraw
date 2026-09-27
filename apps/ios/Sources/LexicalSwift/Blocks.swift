import OrderedCollections

/// Headings and quotes: `$setBlocksType` from @lexical/selection, as the web
/// toolbar's block menu calls it, and what @lexical/rich-text's HeadingNode
/// and QuoteNode do when Enter splits them and Backspace reaches their start.
extension Update {
  /// `$setBlockType` in @packages/lexical-nodes.
  mutating func setBlockType(_ selection: RangeSelection, _ type: BlockType) throws {
    try setBlocksType(selection) { update in
      switch type {
      case .paragraph: update.create(SerializedParagraphNode.type)
      case .quote: update.create(SerializedQuoteNode.type)
      case .h1, .h2, .h3, .h4, .h5, .h6: update.createHeading(HeadingTag(rawValue: type.rawValue)!)
      }
    }
  }

  /// `$setBlocksType`: every block the selection touches is replaced by a new
  /// one that takes its children, leaving out a block the selection's focus
  /// only reaches the near edge of.
  private mutating func setBlocksType(_ selection: RangeSelection, _ create: (inout Update) -> NodeKey) throws {
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
    for block in blocks {
      let element = create(&self)
      copyBlockFormatIndent(from: block, to: element)
      try replace(block, with: element, includingChildren: true)
    }
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
  private mutating func copyBlockFormatIndent(from source: NodeKey, to destination: NodeKey) {
    let json = state[source].payload.json
    let format = json["format"]?.stringValue.flatMap(ElementFormat.init(rawValue:)) ?? .empty
    let indent = json["indent"]?.intValue ?? 0
    let destinationJSON = state[destination].payload.json
    if format.rawValue != destinationJSON["format"]?.stringValue ?? "" {
      modifyBlock(destination) { $0.format = format }
    }
    if indent != destinationJSON["indent"]?.intValue ?? 0 {
      modifyBlock(destination) { $0.indent = indent }
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
      modifyBlock(newElement) { $0.format = old.format }
    }
    modifyBlock(newElement) { $0.direction = old.direction }
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

  /// A paragraph's, heading's or quote's own properties.
  mutating func modifyBlock(_ key: NodeKey, _ change: (inout BlockFields) -> Void) {
    modify(key) { node in
      switch node.payload {
      case .paragraph(var block):
        var fields = BlockFields(direction: block.direction, format: block.format, indent: block.indent)
        change(&fields)
        (block.direction, block.format, block.indent) = (fields.direction, fields.format, fields.indent)
        node.payload = .paragraph(block)
      case .heading(var block):
        var fields = BlockFields(direction: block.direction, format: block.format, indent: block.indent)
        change(&fields)
        (block.direction, block.format, block.indent) = (fields.direction, fields.format, fields.indent)
        node.payload = .heading(block)
      case .quote(var block):
        var fields = BlockFields(direction: block.direction, format: block.format, indent: block.indent)
        change(&fields)
        (block.direction, block.format, block.indent) = (fields.direction, fields.format, fields.indent)
        node.payload = .quote(block)
      default: break
      }
    }
  }
}

/// The properties every block of text has, as ElementNode keeps them.
struct BlockFields {
  var direction: Nullable<Direction>
  var format: ElementFormat?
  var indent: Int?
}
