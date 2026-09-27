/// `@lexical/clipboard`'s copy and rich text's paste, ported from
/// lexical@0.51.0 as the web editor registers them, with no text/html: that
/// needs a DOM to write, and to read.
extension Update {
  // MARK: Copying

  /// `$getClipboardDataFromSelection`, which a collapsed selection puts
  /// nothing on the clipboard from.
  func copy(_ selection: RangeSelection) throws -> Clipboard? {
    guard !selection.isCollapsed else { return nil }
    let selected = try nodes(in: selection)
    var nodes: [JSONValue] = []
    if !selected.isEmpty {
      let selectedSet = Set(selected)
      for child in state.children(of: EditorState.rootKey) {
        try appendJSON(child, selection, selectedSet, into: &nodes)
      }
    }
    return Clipboard(
      plainText: try textContent(selection, selected),
      lexical: selected.isEmpty ? nil : ["namespace": .string(editorNamespace), "nodes": .array(nodes)])
  }

  /// The first of rich text's two cut updates: a selection of the whole
  /// document widens to its blocks, and is copied.
  mutating func copyForCut() throws {
    guard let selection else { throw EditorError.noSelection }
    if !selection.isCollapsed { try expandToWholeDocument(selection) }
    clipboard = try copy(selection)
  }

  /// `$appendNodesToJSON`: a node goes in where it's selected or keeps a
  /// selected child with it, and otherwise its selected descendants go in
  /// its place.
  @discardableResult
  private func appendJSON(
    _ key: NodeKey, _ selection: RangeSelection, _ selected: Set<NodeKey>, into target: inout [JSONValue]
  ) throws -> Bool {
    var shouldInclude = isSelected(key, selection, selected)
    guard case .object(var json) = state.json(of: key, includingChildren: false) else { return false }
    if state[key].isText {
      let text = try slicedText(key, selection, isSelected: shouldInclude)
      json["text"] = .string(text)
      if text.isEmpty { shouldInclude = false }
    }
    var children: [JSONValue] = []
    for child in state.children(of: key) {
      let includesChild = try appendJSON(child, selection, selected, into: &children)
      if !shouldInclude, includesChild, try extractsWithChild(key, selection) { shouldInclude = true }
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
  private func isSelected(_ key: NodeKey, _ selection: RangeSelection, _ selected: Set<NodeKey>) -> Bool {
    let isSelected = selected.contains(key)
    let node = state[key]
    guard !node.isText, selection.anchor.type == .element, selection.focus.type == .element else { return isSelected }
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
    let text = state[key].text
    let (anchor, focus) = (selection.anchor.key, selection.focus.key)
    guard isSelected, !isTokenOrSegmented(key), key == anchor || key == focus else { return text }
    let (anchorOffset, focusOffset) = characterOffsets(selection)
    let isBackward = try state.isBackward(selection)
    let size = state.textSize(of: key)
    let range: Range<Int> =
      if anchor == focus {
        min(anchorOffset, focusOffset)..<max(anchorOffset, focusOffset)
      } else if key == (isBackward ? focus : anchor) {
        min(isBackward ? focusOffset : anchorOffset, size)..<size
      } else {
        0..<min(isBackward ? anchorOffset : focusOffset, size)
      }
    return Self.slice(text, range)
  }

  /// `extractWithChild`: a link keeps a selection inside it, and a paragraph
  /// holding alignment or indent that's wholly selected goes as a block
  /// rather than as its text.
  private func extractsWithChild(_ key: NodeKey, _ selection: RangeSelection) throws -> Bool {
    let node = state[key]
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
        let content = node.text
        let size = state.textSize(of: key)
        var range = 0..<size
        if key == first, key == last {
          if anchor.type != .element || focus.type != .element || focus.offset == anchor.offset {
            range = min(anchorOffset, focusOffset)..<max(anchorOffset, focusOffset)
          }
        } else if key == first {
          range = min(isBefore ? anchorOffset : focusOffset, size)..<size
        } else if key == last {
          range = 0..<min(isBefore ? focusOffset : anchorOffset, size)
        }
        text += Self.slice(content, range)
      } else if node.isDecorator || node.isLineBreak, key != last || !selection.isCollapsed {
        text += state.textContent(of: key)
      }
    }
    return text
  }

  /// JavaScript's `slice`, over UTF-16 code units: bounds past the end stop
  /// at it, as an element point's offset, counted over all its text, can be.
  private static func slice(_ text: String, _ range: Range<Int>) -> String {
    let units = text.utf16
    let start = units.index(units.startIndex, offsetBy: min(range.lowerBound, units.count))
    let end = units.index(units.startIndex, offsetBy: min(range.upperBound, units.count))
    return String(units[start..<end])!
  }

  // MARK: Pasting

  /// The web editor's `PASTE_COMMAND`: its Link plugin links selected text to
  /// a pasted URL, and otherwise rich text inserts the clipboard, as Lexical
  /// nodes where they're from an editor of the same namespace, else as the
  /// plain text.
  mutating func paste(_ selection: RangeSelection, _ clipboard: Clipboard) throws {
    if try pastesAsLink(selection, clipboard.plainText) {
      return try toggleLinkCommand(selection, url: clipboard.plainText)
    }
    tags.insert(.paste)
    if let nodes = pastedNodes(clipboard.lexical) {
      let parsed = try nodes.map { try parse($0) }
      guard parsed.allSatisfy(isEditableTree) else {
        throw EditorError.unsupported("Pasting nodes LexicalSwift doesn't edit")
      }
      try insertNodes(selection, parsed)
      try updateSelectionOnInsert(selection)
      return
    }
    try insertRawText(clipboard.plainText)
  }

  /// The Link plugin's paste handler: a URL over selected simple text.
  private func pastesAsLink(_ selection: RangeSelection, _ text: String) throws -> Bool {
    guard !selection.isCollapsed, WebLinks.validateUrl(text) else { return false }
    return try !nodes(in: selection).contains { state[$0].isElement || (state[$0].isText && !state[$0].isSimpleText) }
  }

  /// The nodes of a Lexical payload that `$generateNodesFromSerializedNodes`
  /// reads: of this editor's namespace, and of types it registers.
  private func pastedNodes(_ payload: JSONValue?) -> [JSONValue]? {
    guard let payload, payload["namespace"]?.stringValue == editorNamespace,
      let nodes = payload["nodes"]?.arrayValue, nodes.allSatisfy(Self.isRegistered)
    else { return nil }
    return nodes
  }

  private static func isRegistered(_ json: JSONValue) -> Bool {
    guard let type = json["type"]?.stringValue, NodeTraits.byType[type] != nil else { return false }
    return (json["children"]?.arrayValue ?? []).allSatisfy(isRegistered)
  }

  private func isEditableTree(_ key: NodeKey) -> Bool {
    state[key].isEditable && state.children(of: key).allSatisfy(isEditableTree)
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
  private mutating func insertRawText(_ text: String) throws {
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
        if let selection { try insertParagraph(selection) }
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
