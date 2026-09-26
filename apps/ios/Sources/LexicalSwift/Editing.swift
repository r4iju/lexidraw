/// `RangeSelection`'s editing methods and the Lexical helpers they call,
/// ported from lexical@0.51.0 for documents of paragraphs, text and line
/// breaks.
extension Update {
  // MARK: Nodes

  /// Lexical's `INTERNAL_$isBlock`.
  func isBlock(_ key: NodeKey) -> Bool {
    let node = state[key]
    if node.isDecorator, !node.isInline { return true }
    guard node.isElement, !node.isRootOrShadowRoot else { return false }
    let first = state.firstChild(of: key).map { state[$0] }
    let isLeafElement = first.map { $0.isLineBreak || $0.isText || $0.isInline } ?? true
    return !node.isInline && node.canBeEmpty && isLeafElement
  }

  /// Lexical's `$findMatchingParent`, which never returns the root.
  func findParent(from key: NodeKey, where predicate: (NodeKey) -> Bool) -> NodeKey? {
    var current: NodeKey? = key
    while let node = current, !state[node].isRoot {
      if predicate(node) { return node }
      current = state.parent(of: node)
    }
    return nil
  }

  func isEmpty(_ key: NodeKey) -> Bool { state.childCount(of: key) == 0 }

  func nextSiblings(of key: NodeKey) -> [NodeKey] {
    guard let parent = state.parent(of: key), let children = state[parent].children,
      let index = children.firstIndex(of: key)
    else { return [] }
    return Array(children[(index + 1)...])
  }

  /// Ancestors from the parent up, as `getParents`.
  func parents(of key: NodeKey) -> [NodeKey] {
    Array(sequence(first: state.parent(of: key)) { $0.flatMap(state.parent(of:)) }.prefix { $0 != nil }.map { $0! })
  }

  func nearestRootOrShadowRoot(_ key: NodeKey) -> NodeKey {
    var current = key
    while let parent = state.parent(of: current) {
      if state[parent].isRootOrShadowRoot { return parent }
      current = parent
    }
    return current
  }

  /// Lexical's `$restoreEmptyContainerParagraph`.
  @discardableResult
  mutating func restoreEmptyContainerParagraph(_ container: NodeKey?, removed child: NodeKey?) throws -> NodeKey? {
    guard let container, state[container].isRootOrShadowRoot, state.isAttached(container), isEmpty(container),
      state[container].isRoot || child.map(isBlock) == true
    else { return nil }
    let paragraph = create(SerializedParagraphNode.type)
    try append(container, [paragraph])
    return paragraph
  }

  func textFormat(of element: NodeKey) -> Int {
    switch state[element].payload {
    case .paragraph(let node): Int(node.textFormat ?? 0)
    case .root(let node): Int(node.textFormat ?? 0)
    default: 0
    }
  }

  func textStyle(of element: NodeKey) -> String {
    switch state[element].payload {
    case .paragraph(let node): node.textStyle ?? ""
    case .root(let node): node.textStyle ?? ""
    default: ""
    }
  }

  mutating func setTextFormat(_ element: NodeKey, _ format: Int) throws {
    switch state[element].payload {
    case .paragraph(var node):
      node.textFormat = Double(format)
      modify(element) { $0.payload = .paragraph(node) }
    case .root(var node):
      node.textFormat = Double(format)
      modify(element) { $0.payload = .root(node) }
    default:
      throw EditorError.unsupported("The text format of a \(state[element].type) node")
    }
  }

  /// `ParagraphNode.insertNewAfter`, the only block LexicalSwift splits.
  mutating func insertNewAfter(_ block: NodeKey, _ selection: RangeSelection, restoringSelection: Bool) throws
    -> NodeKey
  {
    guard case .paragraph(let old) = state[block].payload else {
      throw EditorError.unsupported("Splitting a \(state[block].type) node")
    }
    let paragraph = create(SerializedParagraphNode.type)
    if case .paragraph(var node) = state[paragraph].payload {
      node.textFormat = Double(selection.format)
      node.textStyle = selection.style
      node.direction = old.direction
      node.format = old.format
      state.nodes[paragraph]!.payload = .paragraph(node)
    }
    try insert(paragraph, after: block, restoringSelection: restoringSelection)
    return paragraph
  }

  // MARK: Carets

  /// Lexical's `$setPointFromCaret`.
  func setPoint(_ point: SelectionPoint, from caret: Caret) {
    switch caret {
    case .text(let origin, _, let offset):
      point.set(origin, offset, .text)
    case .sibling(let origin, let direction):
      if state[origin].isText {
        point.set(origin, state.textOffset(origin, direction), .text)
      } else {
        point.set(state.parent(of: origin)!, state.index(of: origin)! + (direction == .next ? 1 : 0), .element)
      }
    case .child(let origin, let direction):
      point.set(origin, direction == .next ? 0 : state.childCount(of: origin), .element)
    }
  }

  func updateSelection(_ selection: RangeSelection, from range: CaretRange) {
    setPoint(selection.anchor, from: range.anchor)
    setPoint(selection.focus, from: range.focus)
  }

  /// `NodeCaret.insert`.
  mutating func insert(_ node: NodeKey, at caret: Caret) throws {
    switch caret {
    case .child(let origin, .next): try splice(origin, 0, deleting: 0, inserting: [node])
    case .child(let origin, .previous): try splice(origin, state.childCount(of: origin), deleting: 0, inserting: [node])
    case .sibling(let origin, .next), .text(let origin, .next, _): try insert(node, after: origin)
    case .sibling(let origin, .previous), .text(let origin, .previous, _): try insert(node, before: origin)
    }
  }

  /// `NodeCaret.remove`.
  mutating func removeNode(at caret: Caret) throws {
    if let node = state.nodeAtCaret(caret) { try remove(node) }
  }

  /// `NodeCaret.splice` without deleting, the only way Lexical's text
  /// removal calls it.
  mutating func insert(_ nodes: [NodeKey], at caret: Caret) throws {
    var current = caret
    for node in caret.direction == .next ? nodes : nodes.reversed() {
      try insert(node, at: current)
      current = .sibling(node, caret.direction)
    }
  }

  // MARK: Reading a selection

  /// `RangeSelection.getNodes`.
  func nodes(in selection: RangeSelection) throws -> [NodeKey] {
    nodes(in: state.inDirection(try state.caretRange(from: selection), .next))
  }

  /// `$getNodesFromCaretRangeCompat`.
  private func nodes(in range: CaretRange) -> [NodeKey] {
    var nodes: [NodeKey] = []
    let (before, after) = state.textSlices(range)
    if let before { nodes.append(before.origin) }
    var seenAncestors: Set<NodeKey> = []
    var seenElements: Set<NodeKey> = []
    for caret in state.nodeCarets(range) {
      let origin = caret.origin
      if caret.isChild {
        if nodes.isEmpty {
          seenAncestors.insert(origin)
        } else {
          seenElements.insert(origin)
          nodes.append(origin)
        }
      } else if !state[origin].isElement || !seenElements.contains(origin) {
        nodes.append(origin)
      }
    }
    if let after { nodes.append(after.origin) }
    if range.focus.isSibling, state[range.focus.origin].isElement, state.nodeAtCaret(range.focus) == nil {
      var reverse: Caret? = .child(range.focus.origin, .previous)
      while let caret = reverse, caret.isChild, seenAncestors.contains(caret.origin), !isEmpty(caret.origin),
        caret.origin == nodes.last
      {
        seenAncestors.remove(caret.origin)
        nodes.removeLast()
        reverse = state.adjacentChildCaret(caret)
      }
    }
    while nodes.count > 1, let last = nodes.last, state[last].isElement,
      !(seenElements.contains(last) || isEmpty(last) || seenAncestors.contains(last))
    {
      nodes.removeLast()
    }
    if nodes.isEmpty, state.isCollapsed(range) {
      let normalized = state.normalize(range.anchor)
      let flipped = state.normalize(state.flipped(range.anchor))
      let candidate = { (caret: Caret) -> NodeKey? in caret.isText ? caret.origin : state.nodeAtCaret(caret) }
      nodes.append(
        candidate(normalized) ?? candidate(flipped)
          ?? (state.nodeAtCaret(range.anchor) != nil ? normalized.origin : flipped.origin))
    }
    return nodes
  }

  // MARK: Normalizing

  /// Lexical's `$normalizeSelection`: element points beside text or in an
  /// element move down into them.
  func normalizeSelection(_ selection: RangeSelection) {
    normalizePoint(selection.anchor)
    normalizePoint(selection.focus)
  }

  private func normalizePoint(_ point: SelectionPoint) {
    while point.type == .element {
      let count = state.childCount(of: point.key)
      let atEnd = point.offset == count
      guard let next = state.child(of: point.key, at: atEnd ? point.offset - 1 : point.offset) else { break }
      if state[next].isText {
        point.set(next, atEnd ? state.textSize(of: next) : 0, .text, onlyIfChanged: true)
        break
      }
      guard state[next].isElement else { break }
      point.set(next, atEnd ? state.childCount(of: next) : 0, .element, onlyIfChanged: true)
    }
  }

  /// Lexical's `$normalizeSelectionPointsForBoundaries`: a point at the edge
  /// of text moves into the text before it.
  func normalizePointsForBoundaries(_ anchor: SelectionPoint, _ focus: SelectionPoint) throws {
    guard anchor.type == .text, focus.type == .text else { return }
    let isBackward = try state.isBefore(anchor, focus)
    let isCollapsed = anchor.is(focus)
    resolvePointOnBoundary(anchor, isBackward: isBackward, isCollapsed: isCollapsed)
    resolvePointOnBoundary(focus, isBackward: !isBackward, isCollapsed: isCollapsed)
    if isCollapsed { focus.set(anchor.key, anchor.offset, anchor.type) }
  }

  private func resolvePointOnBoundary(_ point: SelectionPoint, isBackward: Bool, isCollapsed: Bool) {
    let node = point.key
    let parent = state.parent(of: node)
    let parentIsInline = parent.map { state[$0].isElement && state[$0].isInline } ?? false
    if point.offset == 0 {
      let previous = state.previousSibling(of: node)
      if !isBackward {
        if let previous, state[previous].isElement, !isCollapsed, state[previous].isInline {
          point.set(previous, state.childCount(of: previous), .element)
        } else if let previous, state[previous].isText, !(state[node].isText && state[node].isUnmergeable) {
          point.set(previous, state.textSize(of: previous), .text)
        }
      } else if isCollapsed || !isBackward, previous == nil, parentIsInline, let parent,
        let parentPrevious = state.previousSibling(of: parent), state[parentPrevious].isText
      {
        point.set(parentPrevious, state.textSize(of: parentPrevious), .text)
      }
    } else if point.offset == state.textSize(of: node), isBackward, let next = state.nextSibling(of: node),
      state[next].isElement, state[next].isInline
    {
      point.set(next, 0, .element)
    }
  }

  /// Lexical's `$internalRefreshSelectionFormatAndStyle`.
  private func refreshFormatAndStyle(_ selection: RangeSelection, previousAnchor: NodeKey) {
    let anchor = selection.anchor.key
    guard anchor != previousAnchor else { return }
    let node = state[anchor]
    let format = node.isText ? self.format(of: anchor) : node.isElement ? textFormat(of: anchor) : 0
    let style = node.isText ? self.style(of: anchor) : node.isElement ? textStyle(of: anchor) : ""
    if selection.format != format || !selection.style.isIdentical(to: style) {
      selection.format = format
      selection.style = style
      selection.dirty = true
    }
  }

  // MARK: Removing text

  /// `RangeSelection.removeText`.
  mutating func removeText(_ selection: RangeSelection) throws {
    let isCurrent = self.selection === selection
    let previousAnchor = selection.anchor.key
    let range = try removeText(in: try state.caretRange(from: selection))
    updateSelection(selection, from: range)
    if selection.isCollapsed { refreshFormatAndStyle(selection, previousAnchor: previousAnchor) }
    if isCurrent, self.selection !== selection { setSelection(selection) }
  }

  /// Lexical's `$removeTextFromCaretRange`: removes what the range covers,
  /// merges the blocks it ends in, and returns where a caret goes after.
  private mutating func removeText(in initialRange: CaretRange) throws -> CaretRange {
    guard !state.isCollapsed(initialRange) else { return initialRange }
    let range = state.inDirection(initialRange, .next)
    var container: NodeKey? = range.anchor.origin
    while let node = container, !state[node].isRootOrShadowRoot { container = state.parent(of: node) }
    let containerChild = container.flatMap { state[$0].isElement ? state.firstChild(of: $0) : nil }
    var anchorCandidates = candidates(from: range.anchor)
    var focusCandidates = candidates(from: state.flipped(range.focus))

    var seenStart: Set<NodeKey> = []
    var removed: [NodeKey] = []
    for caret in state.nodeCarets(range) {
      if caret.isChild {
        seenStart.insert(caret.origin)
      } else if !state[caret.origin].isElement || seenStart.contains(caret.origin) {
        removed.append(caret.origin)
      }
    }
    var removedParents: [NodeKey] = []
    for node in removed {
      if let parent = state.parent(of: node), !seenStart.contains(parent), !removedParents.contains(parent) {
        removedParents.append(parent)
      }
      detach(node)
    }
    for parent in removedParents {
      let node = state[parent]
      if !node.canBeEmpty, !node.isRootOrShadowRoot, node.children!.isEmpty, state.isAttached(parent) {
        try remove(parent)
      }
    }

    let (first, second) = state.textSlices(range)
    for slice in [first, second].compactMap({ $0 }) {
      let origin = slice.origin
      let before = state.rewind(.sibling(origin, .next))
      if abs(slice.distance) == state.textSize(of: origin) {
        try removeNode(at: before)
      } else if slice.distance != 0 {
        var units = Array(state[origin].text.utf16)
        let indices = slice.indices
        units.removeSubrange(indices)
        try setText(origin, String(decoding: units, as: UTF16.self))
        let next = Caret.text(origin, slice.direction, offset: indices.lowerBound)
        if origin == anchorCandidates[0].origin { anchorCandidates[0] = next }
        if origin == focusCandidates[0].origin { focusCandidates[0] = state.flipped(next) }
      }
    }

    let anchorCandidate = anchorCandidates.first(where: state.isCaretAttached).map(state.normalize)
    let focusCandidate = focusCandidates.first(where: state.isCaretAttached).map(state.normalize)
    if let (anchorBlock, focusBlock) = blockMergeTargets(anchorCandidate, focusCandidate, seenStart) {
      try insert(Array(state.children(of: focusBlock)), at: .child(anchorBlock, .previous))
      var parent = state.parent(of: focusBlock)
      try remove(focusBlock, preservingEmptyParent: true)
      while let element = parent, isEmpty(element) {
        parent = state.parent(of: element)
        try remove(element, preservingEmptyParent: true)
      }
    } else if let focusCandidate, let focusBlock = block(at: focusCandidate),
      let focusBlockParent = state.parent(of: focusBlock), !state[focusBlockParent].isRoot, isEmpty(focusBlock),
      seenStart.contains(focusBlock),
      parents(of: focusBlock).last(where: { state[$0].isShadowRoot && !state[$0].isRoot }).map(seenStart.contains)
        ?? true
    {
      try remove(focusBlock, preservingEmptyParent: true)
      var parent: NodeKey? = focusBlockParent
      while let element = parent, !state[element].isRoot, isEmpty(element) {
        let grandparent = state.parent(of: element)
        if let grandparent, state[grandparent].isRoot, state.childCount(of: grandparent) <= 1,
          state[element].canBeEmpty
        {
          break
        }
        parent = grandparent
        try remove(element, preservingEmptyParent: true)
      }
    }

    if try restoreEmptyContainerParagraph(container, removed: containerChild) == nil {
      try restoreEmptyContainerParagraph(EditorState.rootKey, removed: nil)
    }

    let best = ([anchorCandidate, focusCandidate] + anchorCandidates + focusCandidates).first(
      where: state.isCaretAttached)
    guard let best = best.flatMap({ $0 }) else {
      throw EditorError.invalidState("$removeTextFromCaretRange: selection was lost")
    }
    let anchor = state.inDirection(state.normalize(best), initialRange.direction)
    return CaretRange(anchor: anchor, focus: anchor)
  }

  /// `$getAnchorCandidates`: the caret, then the carets before each of its
  /// ancestors, for when what it was in has gone.
  private func candidates(from anchor: Caret) -> [Caret] {
    var carets = [anchor]
    var parent = anchor.isChild ? state.parentCaret(anchor) : state.siblingCaret(anchor)
    while let caret = parent {
      carets.append(state.rewind(caret))
      parent = state.parentCaret(caret)
    }
    return carets
  }

  /// `$getBlockMergeTargets`.
  private func blockMergeTargets(_ anchor: Caret?, _ focus: Caret?, _ seenStart: Set<NodeKey>) -> (NodeKey, NodeKey)? {
    guard let anchor, let focus, let anchorParent = state.parentAtCaret(anchor),
      let focusParent = state.parentAtCaret(focus)
    else { return nil }
    let anchorElements = parents(of: anchorParent).reversed() + [anchorParent]
    let focusElements = parents(of: focusParent).reversed() + [focusParent]
    var common = 0
    while common < min(anchorElements.count, focusElements.count), anchorElements[common] == focusElements[common] {
      common += 1
    }
    func block(_ elements: [NodeKey], _ predicate: (NodeKey) -> Bool) -> NodeKey? {
      var block: NodeKey?
      for element in elements[common...] {
        if state[element].isRootOrShadowRoot { return nil }
        if block == nil, predicate(element) { block = element }
      }
      return block
    }
    guard let anchorBlock = block(anchorElements, isBlock),
      let focusBlock = block(focusElements, { seenStart.contains($0) && isBlock($0) })
    else { return nil }
    return (anchorBlock, focusBlock)
  }

  /// `$getBlockFromCaret`.
  private func block(at caret: Caret) -> NodeKey? {
    let candidate = caret.isChild ? caret.origin : state.parentAtCaret(caret)
    return candidate.flatMap { isBlock($0) ? $0 : nil }
  }

  // MARK: Inserting text

  /// `RangeSelection.insertText`.
  mutating func insertText(_ selection: RangeSelection, _ text: String) throws {
    var format = selection.format
    var style = selection.style
    if !selection.isCollapsed {
      let first = try state.isBefore(selection.focus, selection.anchor) ? selection.focus : selection.anchor
      if state[first.key].isText {
        format = self.format(of: first.key)
        style = self.style(of: first.key)
      }
      try removeText(selection)
      selection.format = format
      selection.style = style
      if text.isEmpty { return }
      if selection.anchor.type == .element {
        try transferElementPointToText(selection.anchor, selection.focus, format: format, style: style)
      }
      try insertTextAtPoint(selection, text, format: format, style: style)
      return
    }
    if selection.anchor.type == .element {
      try transferElementPointToText(selection.anchor, selection.focus, format: format, style: style)
    }
    let anchor = selection.anchor.key
    guard state[anchor].isText else { throw EditorError.invalidState("insertText: anchor is not a text node") }
    if text.isEmpty { return }
    let offset = selection.anchor.offset
    let parent = state[anchor].parent!
    let parentIsInline = state[parent].isInline
    let atStartOfInline = parentIsInline && offset == 0 && state.previousSibling(of: anchor) == nil
    let atEndOfInline = parentIsInline && offset == state.textSize(of: anchor) && state.nextSibling(of: anchor) == nil
    if atStartOfInline || atEndOfInline || self.format(of: anchor) != format
      || !self.style(of: anchor).isIdentical(to: style)
    {
      if state[anchor].text.isEmpty, !atStartOfInline, !atEndOfInline {
        setFormat(anchor, format)
        setStyle(anchor, style)
      } else {
        try insertTextAtPoint(selection, text, format: format, style: style)
        return
      }
    }
    spliceText(anchor, at: offset, deleting: 0, inserting: text, movingSelection: true)
  }

  /// Lexical's `$transferStartingElementPointToTextPoint`: puts empty text
  /// where an element point is, to type into.
  private mutating func transferElementPointToText(
    _ start: SelectionPoint, _ end: SelectionPoint, format: Int, style: String
  ) throws {
    let element = start.key
    let placement = state.child(of: element, at: start.offset)
    let text = createText("", format: format, style: style)
    if let placement, state[placement].type == SerializedParagraphNode.type {
      try splice(placement, 0, deleting: 0, inserting: [text])
    } else if let placement {
      var target = text
      if state[element].isRootOrShadowRoot {
        target = create(SerializedParagraphNode.type)
        try append(target, [text])
      }
      try insert(target, before: placement)
    } else if state[element].isRootOrShadowRoot {
      if let last = state.lastChild(of: element), state[last].isElement, !state[last].isInline, isEmpty(last) {
        try append(last, [text])
      } else {
        let paragraph = create(SerializedParagraphNode.type)
        try append(paragraph, [text])
        try append(element, [paragraph])
      }
    } else {
      try append(element, [text])
    }
    if start.is(end) { end.set(text, 0, .text) }
    start.set(text, 0, .text)
  }

  /// Lexical's `$insertTextAtPoint`: typed text in its own node, beside or
  /// splitting the anchor's.
  private mutating func insertTextAtPoint(_ selection: RangeSelection, _ text: String, format: Int, style: String)
    throws
  {
    let anchor = selection.anchor.key
    guard state[anchor].isText else { throw EditorError.invalidState("insertText: anchor is not a text node") }
    let offset = selection.anchor.offset
    let node = createText(text, format: format, style: style)
    let parent = state[anchor].parent!
    if offset == 0 {
      if state[parent].isInline, state.previousSibling(of: anchor) == nil {
        try insert(node, before: parent)
      } else {
        try insert(node, before: anchor, restoringSelection: false)
      }
    } else if offset == state.textSize(of: anchor) {
      if state[parent].isInline, state.nextSibling(of: anchor) == nil {
        try insert(node, after: parent)
      } else {
        try insert(node, after: anchor, restoringSelection: false)
      }
    } else {
      let before = try splitText(anchor, at: [offset])[0]
      try insert(node, after: before, restoringSelection: false)
    }
    if state[anchor].text.isEmpty, state.isAttached(anchor) { try remove(anchor) }
    selectEnd(node)
  }

  // MARK: Splitting blocks

  /// `RangeSelection.insertParagraph`.
  mutating func insertParagraph(_ selection: RangeSelection) throws {
    if !selection.isCollapsed { try removeText(selection) }
    let anchor = selection.anchor
    if anchor.type == .element, state[anchor.key].isRootOrShadowRoot {
      let paragraph = create(SerializedParagraphNode.type)
      try splice(anchor.key, anchor.offset, deleting: 0, inserting: [paragraph])
      selectElement(paragraph)
      return
    }
    let (_, index) = try removeTextAndSplitBlock(selection)
    guard let block = findParent(from: selection.anchor.key, where: isBlock), state[block].isElement else {
      throw EditorError.invalidState("Expected ancestor to be a block ElementNode")
    }
    let moving = state.child(of: block, at: index).map { [$0] + nextSiblings(of: $0) } ?? []
    let newBlock = try insertNewAfter(block, selection, restoringSelection: false)
    try append(newBlock, moving)
    selectStart(newBlock)
  }

  /// Lexical's `$removeTextAndSplitBlock`: splits up to the block the
  /// selection is in, and says where in it the split is.
  private mutating func removeTextAndSplitBlock(_ selection: RangeSelection, stoppingAtUnsplittable: Bool = false)
    throws -> (NodeKey, Int)
  {
    if !selection.isCollapsed { try removeText(selection) }
    let current = self.selection ?? selection
    var node = current.anchor.key
    var offset = current.anchor.offset
    while !isBlock(node) {
      let previous = node
      (node, offset) = try splitNode(node, at: offset, stoppingAtUnsplittable: stoppingAtUnsplittable)
      if previous == node { break }
    }
    return (node, offset)
  }

  /// Lexical's `$splitNodeAtPoint`.
  private mutating func splitNode(_ node: NodeKey, at offset: Int, stoppingAtUnsplittable: Bool) throws -> (NodeKey, Int)
  {
    guard let parent = state.parent(of: node) else {
      let paragraph = create(SerializedParagraphNode.type)
      try append(EditorState.rootKey, [paragraph])
      selectElement(paragraph)
      return (EditorState.rootKey, 0)
    }
    if state[node].isText {
      let split = try splitText(node, at: [offset])
      guard let first = split.first else { return (parent, state.index(of: node)!) }
      return (parent, state.index(of: first)! + (offset == 0 ? 0 : 1))
    }
    guard state[node].isElement, offset != 0 else { return (parent, state.index(of: node)!) }
    if let first = state.child(of: node, at: offset) {
      let point = RangeSelection(
        anchor: SelectionPoint(node, offset, .element), focus: SelectionPoint(node, offset, .element), format: 0,
        style: "")
      let newElement = try insertNewAfter(node, point, restoringSelection: true)
      try append(newElement, [first] + nextSiblings(of: first))
    }
    return (parent, state.index(of: node)! + 1)
  }

  /// `RangeSelection.insertLineBreak`.
  mutating func insertLineBreak(_ selection: RangeSelection) throws {
    try insertNodes(selection, [create(SerializedLineBreakNode.type)])
  }

  /// `RangeSelection.insertNodes`, for inline nodes.
  private mutating func insertNodes(_ selection: RangeSelection, _ nodes: [NodeKey]) throws {
    guard let last = nodes.last else { return }
    if !selection.isCollapsed { try removeText(selection) }
    let anchor = selection.anchor
    if anchor.type == .element, state[anchor.key].isRootOrShadowRoot {
      let blocks = try wrapInlineNodes(nodes)
      let selected = lastDescendant(of: blocks)
      try splice(anchor.key, anchor.offset, deleting: 0, inserting: Array(state.children(of: blocks)))
      if let selected { selectEnd(selected) }
      return
    }
    let first = try state.isBackward(selection) ? selection.focus : selection.anchor
    let firstBlock = findParent(from: first.key, where: isBlock)
    guard nodes.allSatisfy({ state[$0].isInline }) else {
      throw EditorError.unsupported("Inserting blocks")
    }
    guard let firstBlock, state[firstBlock].isElement else {
      throw EditorError.invalidState("Expected a block ElementNode ancestor")
    }
    let (container, index) = try removeTextAndSplitBlock(selection, stoppingAtUnsplittable: true)
    try splice(state[container].isElement ? container : firstBlock, index, deleting: 0, inserting: nodes)
    selectEnd(last)
  }

  /// Lexical's `$wrapInlineNodes`: runs of inline nodes in paragraphs, under
  /// a paragraph standing in for the root they go into.
  private mutating func wrapInlineNodes(_ nodes: [NodeKey]) throws -> NodeKey {
    let root = create(SerializedParagraphNode.type)
    var block: NodeKey?
    for (index, node) in nodes.enumerated() {
      guard state[node].isInline else {
        try append(root, [node])
        block = nil
        continue
      }
      if block == nil {
        let paragraph = create(SerializedParagraphNode.type)
        block = paragraph
        try append(root, [paragraph])
        let next = index + 1 < nodes.count ? nodes[index + 1] : nil
        if state[node].isLineBreak, next.map({ !state[$0].isInline }) ?? true { continue }
      }
      try append(block!, [node])
    }
    return root
  }

  // MARK: Formatting

  /// Lexical's `$formatText`.
  mutating func formatText(_ selection: RangeSelection, _ type: TextFormat) throws {
    let align = type.toggled(in: selection.format, aligningWith: nil)
    try updateTextFormat(selection) { type.toggled(in: $0, aligningWith: align) }
  }

  /// Lexical's `$updateTextFormat`: formats the selected text, splitting
  /// text the selection ends inside.
  private mutating func updateTextFormat(_ selection: RangeSelection, _ apply: (Int) -> Int) throws {
    if selection.isCollapsed {
      selection.setFormat(apply(selection.format))
      return
    }
    var texts: [NodeKey] = []
    for node in try nodes(in: selection) {
      if state[node].isText {
        texts.append(node)
      } else if state[node].isElement {
        try setTextFormat(node, apply(textFormat(of: node)))
      }
    }
    guard !texts.isEmpty else {
      selection.setFormat(apply(selection.format))
      return
    }
    let isBackward = try state.isBackward(selection)
    let start = isBackward ? selection.focus : selection.anchor
    let end = isBackward ? selection.anchor : selection.focus
    var firstIndex = 0
    var first = texts[0]
    var startOffset = start.type == .element ? 0 : start.offset
    if start.type == .text, startOffset == state.textSize(of: first) {
      firstIndex = 1
      guard texts.count > 1 else { return }
      first = texts[1]
      startOffset = 0
    }
    let lastIndex = texts.count - 1
    var last = texts[lastIndex]
    let endOffset = end.type == .text ? end.offset : state.textSize(of: last)
    if first == last {
      guard startOffset != endOffset else { return }
      let format = apply(self.format(of: first))
      if startOffset == 0, endOffset == state.textSize(of: first) {
        setFormat(first, format)
      } else {
        let split = try splitText(first, at: [startOffset, endOffset])
        let replacement = startOffset == 0 ? split[0] : split[1]
        setFormat(replacement, format)
        if start.type == .text { start.set(replacement, 0, .text) }
        if end.type == .text { end.set(replacement, endOffset - startOffset, .text) }
      }
      selection.format = format
      return
    }
    if startOffset != 0 {
      first = try splitText(first, at: [startOffset])[1]
      startOffset = 0
    }
    let firstFormat = apply(self.format(of: first))
    setFormat(first, firstFormat)
    let lastFormat = apply(self.format(of: last))
    if endOffset > 0 {
      if endOffset != state.textSize(of: last) {
        last = try splitText(last, at: [endOffset])[0]
      }
      setFormat(last, lastFormat)
    }
    for text in texts[min(firstIndex + 1, lastIndex)..<lastIndex] {
      setFormat(text, apply(self.format(of: text)))
    }
    if start.type == .text { start.set(first, startOffset, .text) }
    if end.type == .text { end.set(last, endOffset, .text) }
    selection.format = firstFormat | lastFormat
  }

  // MARK: Selecting everything

  /// Lexical's `$selectAll`, with no selection to start from.
  mutating func selectAll() {
    let root = EditorState.rootKey
    let selection = selectElement(root, 0, state.childCount(of: root))
    let (anchor, focus) = (selection.anchor.value, selection.focus.value)
    normalizeSelection(selection)
    if let top = rootChild(containing: selection.anchor.key), state[top].isElement, state[top].isShadowRoot,
      top == rootChild(containing: selection.focus.key)
    {
      selection.anchor.set(anchor.key, anchor.offset, anchor.type)
      selection.focus.set(focus.key, focus.offset, focus.type)
    }
    setSelection(selection)
  }

  private func rootChild(containing key: NodeKey) -> NodeKey? {
    var current = key
    while let parent = state.parent(of: current) {
      if state[parent].isRoot { return current }
      current = parent
    }
    return nil
  }
}

extension TextFormat {
  /// Lexical's `TEXT_TYPE_TO_FORMAT`.
  var flag: Int {
    switch self {
    case .bold: 1
    case .italic: 2
    case .strikethrough: 4
    case .underline: 8
    case .code: 16
    case .subscript: 32
    case .superscript: 64
    case .highlight: 128
    case .lowercase: 256
    case .uppercase: 512
    case .capitalize: 1024
    }
  }

  /// Lexical's `toggleTextFormatType`: flips this format, leaving it as
  /// `align` has it where given, and clears formats it excludes.
  func toggled(in format: Int, aligningWith align: Int?) -> Int {
    if let align, format & flag == align & flag { return format }
    var toggled = format ^ flag
    let excluded: [TextFormat] =
      switch self {
      case .subscript: [.superscript]
      case .superscript: [.subscript]
      case .lowercase: [.uppercase, .capitalize]
      case .uppercase: [.lowercase, .capitalize]
      case .capitalize: [.lowercase, .uppercase]
      default: []
      }
    for other in excluded { toggled &= ~other.flag }
    return toggled
  }
}
