/// `@lexical/clipboard`'s copy and rich text's paste, ported from
/// lexical@0.51.0 as the web editor registers them.
extension Update {
  // MARK: Copying

  /// `$getClipboardDataFromSelection`, which a collapsed selection puts
  /// nothing on the clipboard from.
  func copy(_ selection: RangeSelection) throws -> Clipboard? {
    guard !selection.isCollapsed else { return nil }
    let selected = try nodes(in: selection)
    return Clipboard(
      plainText: try textContent(selection, selected), lexical: try lexicalContent(.range(selection), selected))
  }

  /// `$getClipboardDataFromSelection` for selected cells.
  func copy(_ selection: TableSelection) throws -> Clipboard {
    Clipboard(
      plainText: try textContent(selection), lexical: try lexicalContent(.cells(selection), nodes(in: selection)))
  }

  /// `$getClipboardDataFromSelection` for selected nodes: their text, and
  /// the nodes.
  func copy(_ selection: NodeSelection) throws -> Clipboard {
    let selected = nodes(in: selection)
    return Clipboard(
      plainText: selected.map(state.textContent(of:)).joined(), lexical: try lexicalContent(.nodes(selection), selected))
  }

  /// A selection a copy is of or a paste goes into.
  enum ClipboardSelection {
    case range(RangeSelection)
    case cells(TableSelection)
    case nodes(NodeSelection)
  }

  /// `$getLexicalContent`: nothing where nothing is selected.
  private func lexicalContent(_ copied: ClipboardSelection, _ selected: [NodeKey]) throws -> LexicalClipboardPayload? {
    guard !selected.isEmpty else { return nil }
    let selectedSet = Set(selected)
    var nodes: [JSONValue] = []
    for child in state.children(of: EditorState.rootKey) {
      try appendJSON(child, copied, selectedSet, into: &nodes)
    }
    return LexicalClipboardPayload(namespace: editorNamespace, nodes: nodes)
  }

  /// A cut's copy: a selection of the whole document widens to its blocks
  /// first.
  mutating func copyForCut() throws {
    if let nodeSelection {
      clipboard = try copy(nodeSelection)
      return
    }
    guard let selection else { throw EditorError.noSelection }
    if !selection.isCollapsed { try expandToWholeDocument(selection) }
    clipboard = try copy(selection)
  }

  /// `$appendNodesToJSON`: a node goes in where it's selected or keeps a
  /// selected child with it, and otherwise its selected descendants go in
  /// its place.
  @discardableResult
  private func appendJSON(
    _ key: NodeKey, _ copied: ClipboardSelection, _ selected: Set<NodeKey>, into target: inout [JSONValue]
  ) throws -> Bool {
    var shouldInclude = isSelected(key, copied, selected)
    guard case .object(var json) = state.json(of: key, includingChildren: false) else {
      preconditionFailure("A node's JSON is an object")
    }
    if state[key].isText {
      let text =
        if case .range(let selection) = copied {
          try slicedText(key, selection, isSelected: shouldInclude)
        } else {
          state[key].text
        }
      json["text"] = .string(text)
      if text.isEmpty { shouldInclude = false }
    }
    var children: [JSONValue] = []
    for child in state.children(of: key) {
      let includesChild = try appendJSON(child, copied, selected, into: &children)
      if !shouldInclude, includesChild, try extractsWithChild(key, child, copied) { shouldInclude = true }
    }
    guard shouldInclude else {
      target += children
      return false
    }
    if json["children"] != nil { json["children"] = .array(children) }
    target.append(.object(json))
    return true
  }

  /// `LexicalNode.isSelected`.
  private func isSelected(_ key: NodeKey, _ copied: ClipboardSelection, _ selected: Set<NodeKey>) -> Bool {
    let isSelected = selected.contains(key)
    let node = state[key]
    guard case .range(let selection) = copied, !node.isText, selection.anchor.type == .element, selection.focus.type == .element else { return isSelected }
    if selection.isCollapsed { return false }
    if node.isDecorator, node.isInline, let parent = state.parent(of: key),
      let firstPoint = try? state.startEnd(selection).start, firstPoint.key == parent,
      firstPoint.offset == state.childCount(of: parent), state.lastChild(of: parent) == key
    {
      return false
    }
    return isSelected
  }

  /// `$sliceSelectedTextNodeContent`: the part of a text the selection
  /// starts or ends in that it covers.
  private func slicedText(_ key: NodeKey, _ selection: RangeSelection, isSelected: Bool) throws -> String {
    let (start, end) = try ends(of: selection)
    guard isSelected, !isTokenOrSegmented(key), key == start.point.key || key == end.point.key else {
      return state[key].text
    }
    return slice(
      key, from: key == start.point.key ? start.offset : nil, to: key == end.point.key ? end.offset : nil)
  }

  /// `extractWithChild`: a heading goes with any of its text, a list with
  /// any of its items, a list item with all of its text selected from inside
  /// it, a link keeps a selection inside it, and a paragraph holding
  /// alignment or indent that's wholly selected goes as a block rather than
  /// as its text. Only a heading and a list go with a child over selected
  /// cells.
  private func extractsWithChild(_ key: NodeKey, _ child: NodeKey, _ copied: ClipboardSelection) throws -> Bool {
    let node = state[key]
    if node.type == SerializedHeadingNode.type { return true }
    if isList(key) { return isListItem(child) }
    guard case .range(let selection) = copied else { return false }
    if isListItem(key) {
      guard hasAncestor(selection.anchor.key, key), hasAncestor(selection.focus.key, key) else { return false }
      return try state.textContent(of: key).utf16.count == textContent(selection).utf16.count
    }
    if node.type == SerializedMarkNode.type {
      guard hasAncestor(selection.anchor.key, key), hasAncestor(selection.focus.key, key) else { return false }
      let length = try state.isBackward(selection)
        ? selection.anchor.offset - selection.focus.offset : selection.focus.offset - selection.anchor.offset
      return state.textContent(of: key).utf16.count == length
    }
    if node.isLink {
      let holds = { (point: SelectionPoint) in point.key == key || self.hasAncestor(point.key, key) }
      guard holds(selection.anchor), holds(selection.focus) else { return false }
      return try !textContent(selection).isEmpty
    }
    guard case .paragraph(let paragraph) = node.payload,
      (paragraph.format ?? .empty) != .empty || (paragraph.indent ?? 0) != 0
    else { return false }
    guard try isFullySelected(key, selection) else { return false }
    let text = state.textContent(of: key)
    guard !text.isEmpty else { return false }
    return try textContent(selection) == text
  }

  /// `RangeSelection.getTextContent`: blocks are set apart by a newline.
  func textContent(_ selection: RangeSelection, _ selected: [NodeKey]? = nil) throws -> String {
    let nodes = try selected ?? self.nodes(in: selection)
    guard let first = nodes.first, let last = nodes.last else { return "" }
    let (anchor, focus) = (selection.anchor, selection.focus)
    let isBefore = try state.isBefore(anchor, focus)
    let (anchorOffset, focusOffset) = characterOffsets(selection)
    let (startOffset, endOffset) = isBefore ? (anchorOffset, focusOffset) : (focusOffset, anchorOffset)
    var text = ""
    var previousWasElement = true
    for key in nodes {
      let node = state[key]
      if node.isElement, !node.isInline {
        if !previousWasElement { text += "\n" }
        previousWasElement = !isEmpty(key)
        continue
      }
      previousWasElement = false
      if node.isText {
        let isWhole = key == first && key == last && anchor.type == .element && focus.type == .element
          && focus.offset != anchor.offset
        text +=
          isWhole ? node.text : slice(key, from: key == first ? startOffset : nil, to: key == last ? endOffset : nil)
      } else if node.isDecorator || node.isLineBreak, key != last || !selection.isCollapsed {
        text += state.textContent(of: key)
      }
    }
    return text
  }

  /// The text of `key` from the selection's start offset where it starts
  /// in `key`, to its end offset where it ends there, as JavaScript's `slice`
  /// takes it over UTF-16 code units: offsets past the end stop at it, as an
  /// element point's, counted over all its text, can be.
  private func slice(_ key: NodeKey, from start: Int?, to end: Int?) -> String {
    let units = state[key].text.utf16
    let (lower, upper) = (min(start ?? 0, units.count), min(end ?? units.count, units.count))
    let (from, to) = (min(lower, upper), max(lower, upper))
    return String(units[units.index(units.startIndex, offsetBy: from)..<units.index(units.startIndex, offsetBy: to)])!
  }

  // MARK: Pasting

  /// The web editor's `PASTE_COMMAND`: its Link plugin links selected text to
  /// a pasted URL, and otherwise rich text inserts the clipboard.
  mutating func paste(_ selection: RangeSelection, _ clipboard: Clipboard) throws {
    if try pastesAsLink(selection, clipboard.plainText) {
      return try toggleLinkCommand(selection, url: clipboard.plainText)
    }
    try paste(clipboard, into: .range(selection))
  }

  /// `PASTE_COMMAND` over selected nodes, which rich text answers.
  mutating func paste(_ selection: NodeSelection, _ clipboard: Clipboard) throws {
    try paste(clipboard, into: .nodes(selection))
  }

  /// `PASTE_COMMAND` over selected cells, which rich text answers.
  mutating func paste(_ selection: TableSelection, _ clipboard: Clipboard) throws {
    try paste(clipboard, into: .cells(selection))
  }

  /// Rich text's paste: the clipboard as Lexical nodes where they're from an
  /// editor of the same namespace, then HTML, else the plain text.
  private mutating func paste(_ clipboard: Clipboard, into target: ClipboardSelection) throws {
    tags.insert(.paste)
    if let nodes = pastedNodes(clipboard.lexical) {
      // `$defaultLexicalEditorImporter` catches what reading and inserting
      // the nodes throws, keeps what it did so far, and hands the paste on to
      // the plain text.
      do {
        let parsed = try nodes.map { try parse($0) }
        if let refused = parsed.lazy.compactMap(firstUneditable).first {
          let type = state[refused].type
          throw EditorError.unsupported(
            state[refused].portingIssue.map { "Pasting \(type) nodes isn't supported yet (#\($0))" }
              ?? "Pasting \(type) nodes LexicalSwift doesn't edit isn't supported")
        }
        try insertGeneratedNodes(parsed, target)
        return
      } catch EditorError.invalidState {}
    }
    if let html = clipboard.html, !html.isEmpty, html != clipboard.plainText {
      let parsed = try HTMLImport.nodes(html).map { try parse($0) }
      if let refused = parsed.lazy.compactMap(firstUneditable).first {
        let node = state[refused]
        throw EditorError.unsupported("Pasting \(node.type) HTML isn't supported yet (#\(node.portingIssue ?? 168))")
      }
      try insertGeneratedNodes(parsed, target)
      return
    }
    switch target {
    case .range: try insertRawText(clipboard.plainText)
    case .cells(let selection): try insertRawText(selection, clipboard.plainText)
    // `NodeSelection.insertRawText` does nothing.
    case .nodes: break
    }
  }

  /// `$insertGeneratedNodes`, which the table plugin's handler answers
  /// first.
  private mutating func insertGeneratedNodes(_ nodes: [NodeKey], _ target: ClipboardSelection) throws {
    if try tableSelectionInsertClipboardNodes(nodes, target) { return }
    switch target {
    case .range(let selection):
      try insertNodes(selection, nodes)
      try updateSelectionOnInsert(selection)
    case .cells(let selection):
      try insertNodes(selection, nodes)
    case .nodes(let selection):
      try insertNodes(selection, nodes)
    }
  }

  /// The Link plugin's paste handler: a URL over selected simple text.
  private func pastesAsLink(_ selection: RangeSelection, _ text: String) throws -> Bool {
    guard !selection.isCollapsed, WebLinks.validateUrl(text) else { return false }
    return try !nodes(in: selection).contains { state[$0].isElement || (state[$0].isText && !state[$0].isSimpleText) }
  }

  /// The nodes of a Lexical payload that `$generateNodesFromSerializedNodes`
  /// reads: of this editor's namespace, and of types it registers.
  private func pastedNodes(_ payload: LexicalClipboardPayload?) -> [JSONValue]? {
    guard let payload, payload.namespace == editorNamespace, payload.nodes.allSatisfy(Self.isRegistered) else {
      return nil
    }
    return payload.nodes
  }

  private static func isRegistered(_ json: JSONValue) -> Bool {
    guard let type = json["type"]?.stringValue, NodeTraits.byType[type] != nil else { return false }
    return (json["children"]?.arrayValue ?? []).allSatisfy(isRegistered)
  }

  private func firstUneditable(_ key: NodeKey) -> NodeKey? {
    state[key].isEditable ? state.children(of: key).lazy.compactMap(firstUneditable).first : key
  }

  /// `$updateSelectionOnInsert`: a caret takes the format and style of the
  /// text before it.
  private func updateSelectionOnInsert(_ selection: RangeSelection) throws {
    guard selection.isCollapsed else { return }
    let anchor = try state.caret(from: selection.anchor, .previous)
    var inspected: NodeKey?
    if anchor.isText {
      inspected = anchor.origin
    } else {
      let range = CaretRange(anchor: anchor, focus: state.flipped(.child(EditorState.rootKey, .next)))
      for caret in state.nodeCarets(range) {
        let node = state[caret.origin]
        if node.isText {
          inspected = caret.origin
          break
        }
        if node.isElement, !node.isInline { break }
      }
    }
    guard let inspected, state[inspected].isText else { return }
    let (format, style) = (format(of: inspected), style(of: inspected))
    if selection.format != format || selection.style != style {
      selection.format = format
      selection.style = style
      selection.dirty = true
    }
  }

  /// The plain-text importer: `tokenizeRawText`, each part inserted at the
  /// selection the last left.
  mutating func insertRawText(_ text: String, lineBreaks: Bool = false) throws {
    var part: [UInt16] = []
    func insertPart() throws {
      guard !part.isEmpty, let selection else { return }
      try insertText(selection, String(decoding: part, as: UTF16.self))
      part = []
    }
    let units = Array(text.utf16)
    var index = 0
    while index < units.count {
      let unit = units[index]
      let isCRLF = unit == 13 && index + 1 < units.count && units[index + 1] == 10
      if unit == 10 || isCRLF {
        try insertPart()
        if let selection {
          if lineBreaks { try insertLineBreak(selection) } else { try insertParagraph(selection) }
        }
        index += isCRLF ? 2 : 1
      } else if unit == 9 {
        try insertPart()
        if let selection { try insertNodes(selection, [create(SerializedTabNode.type)]) }
        index += 1
      } else {
        part.append(unit)
        index += 1
      }
    }
    try insertPart()
  }
}
