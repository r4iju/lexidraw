extension Node {
  /// A `LinkNode`, which an `AutoLinkNode` is too.
  var isLink: Bool { type == SerializedLinkNode.type || isAutoLink }

  var isAutoLink: Bool { type == SerializedAutoLinkNode.type }

  /// Lexical's `canInsertTextBefore`: whether typing at the start of the
  /// node goes into it.
  var canInsertTextBefore: Bool { !isLink && type != SerializedTabNode.type }

  var canInsertTextAfter: Bool { !isLink && type != SerializedTabNode.type }
}

/// `@lexical/link`'s `TOGGLE_LINK_COMMAND` handlers and `LinkNode`'s
/// transform, ported from lexical@0.51.0, with the web editor's
/// `validateUrl`.
extension Update {
  /// `TOGGLE_LINK_COMMAND` with a URL or nil, handled as the web editor
  /// registers its handlers: the AutoLink plugin's, then the Link plugin's
  /// with the web's `validateUrl`.
  mutating func toggleLinkCommand(_ selection: RangeSelection, url: String?) throws {
    if url == nil {
      for node in try extract(selection) {
        guard let parent = state.parent(of: node), case .autoLink(var link) = state[parent].payload else { continue }
        link.isUnlinked = !(link.isUnlinked ?? false)
        modify(parent) { $0.payload = .autoLink(link) }
      }
    }
    guard url.map(WebLinks.validateUrl) ?? true else { return }
    try toggleLink(url)
  }

  /// `saveLink`, the web's link editor saving a URL: the link takes it
  /// sanitized, and an autolink becomes a link that typing no longer relinks.
  mutating func editLink(_ selection: RangeSelection, url: String) throws {
    try toggleLinkCommand(selection, url: WebLinks.sanitizeUrl(url))
    guard let selection = self.selection, let parent = state.parent(of: try selectedNode(selection)),
      case .autoLink(let autoLink) = state[parent].payload
    else { return }
    let link = createLink(autoLink.url ?? "", rel: autoLink.rel, target: autoLink.target, title: autoLink.title)
    try replace(parent, with: link, includingChildren: true)
  }

  /// `getSelectedNode` in the web editor's utils.
  private func selectedNode(_ selection: RangeSelection) throws -> NodeKey {
    let (anchor, focus) = (selection.anchor.key, selection.focus.key)
    if anchor == focus { return anchor }
    let isAtEnd = { (point: SelectionPoint) in
      point.offset == (point.type == .text ? self.state.textSize(of: point.key) : self.state.childCount(of: point.key))
    }
    return try state.isBackward(selection)
      ? (isAtEnd(selection.focus) ? anchor : focus) : (isAtEnd(selection.anchor) ? anchor : focus)
  }

  /// `$toggleLink` with no attributes, as `TOGGLE_LINK_COMMAND` passes it.
  private mutating func toggleLink(_ url: String?) throws {
    guard let selection else { return }
    if selection.isCollapsed, url == nil, let node = try nodes(in: selection).first {
      if let link = findParent(from: node, where: isNonAutoLink) {
        try splice(
          state.parent(of: link)!, state.index(of: link)!, deleting: 0, inserting: Array(state.children(of: link)))
        try remove(link)
      }
      return
    }
    let nodes = try extract(selection)
    guard let url else {
      var processed: Set<NodeKey> = []
      for node in nodes {
        guard let link = findParent(from: node, where: isNonAutoLink), !processed.contains(link) else { continue }
        try splitLink(link, at: nodes)
        processed.insert(link)
      }
      return
    }
    var updated: Set<NodeKey> = []
    if nodes.count == 1, let link = findParent(from: nodes[0], where: { state[$0].isLink }) {
      return updateLink(link, url, &updated)
    }
    let preserved = preserveSelectedNodes()
    var link: NodeKey?
    for node in nodes where state.isAttached(node) {
      if let parent = findParent(from: node, where: { state[$0].isLink }) {
        updateLink(parent, url, &updated)
        continue
      }
      if state[node].isElement, !state[node].isInline { continue }
      if let previous = state.previousSibling(of: node), previous == link {
        try append(previous, [node])
        continue
      }
      let created = createLink(url, rel: .value("noreferrer"), target: .null, title: .null)
      link = created
      try insert(created, after: node)
      try append(created, [node])
    }
    restoreSelectedNodes(preserved)
  }

  private func isNonAutoLink(_ key: NodeKey) -> Bool { state[key].isLink && !state[key].isAutoLink }

  /// `$toggleLink`'s `updateLinkNode`: each link takes the URL once.
  private mutating func updateLink(_ link: NodeKey, _ url: String, _ updated: inout Set<NodeKey>) {
    guard updated.insert(link).inserted else { return }
    modifyLink(link) {
      $0.url = url
      $0.rel = .value("noreferrer")
    }
  }

  /// The nodes beside `$withSelectedNodes`' element points, and which way the
  /// selection ran.
  private struct SelectedNodes {
    var anchor: NodeKey?
    var focus: NodeKey?
    var isBackward: Bool
  }

  /// The first half of `$withSelectedNodes`: element points at either end of
  /// the selection are to stay beside the nodes they're beside.
  private func preserveSelectedNodes() -> SelectedNodes? {
    guard let selection else { return nil }
    normalizeSelection(selection)
    guard let isBackward = try? state.isBackward(selection) else { return nil }
    let pointNode = { (point: SelectionPoint, delta: Int) -> NodeKey? in
      point.type == .element ? self.state.child(of: point.key, at: point.offset + delta) : nil
    }
    return SelectedNodes(
      anchor: pointNode(selection.anchor, isBackward ? -1 : 0), focus: pointNode(selection.focus, isBackward ? 0 : -1),
      isBackward: isBackward)
  }

  private mutating func restoreSelectedNodes(_ preserved: SelectedNodes?) {
    guard let preserved, preserved.anchor != nil || preserved.focus != nil, let updated = selection else { return }
    let final = updated.clone()
    if let anchor = preserved.anchor, let parent = state.parent(of: anchor) {
      final.anchor.set(parent, state.index(of: anchor)! + (preserved.isBackward ? 1 : 0), .element)
    }
    if let focus = preserved.focus, let parent = state.parent(of: focus) {
      final.focus.set(parent, state.index(of: focus)! + (preserved.isBackward ? 0 : 1), .element)
    }
    normalizeSelection(final)
    setSelection(final)
  }

  /// `$splitLinkAtSelection`: takes the extracted children out of `link`,
  /// leaving the rest linked on either side.
  private mutating func splitLink(_ link: NodeKey, at extracted: [NodeKey]) throws {
    let inLink = extracted.filter { hasAncestor($0, link) }
    let isExtracted = { (child: NodeKey) in
      inLink.contains(child) || (self.state[child].isElement && inLink.contains { self.hasAncestor($0, child) })
    }
    let children = Array(state.children(of: link))
    let extractedChildren = children.filter(isExtracted)
    if extractedChildren.count == children.count {
      for child in children { try insert(child, before: link) }
      try remove(link)
      return
    }
    guard let first = children.firstIndex(where: isExtracted), let last = children.lastIndex(where: isExtracted) else {
      throw EditorError.invalidState("No child of the link is extracted, so Lexical has none to put the rest after")
    }
    if first == 0 {
      for child in extractedChildren { try insert(child, before: link) }
      return
    }
    for child in extractedChildren.reversed() { try insert(child, after: link) }
    if last < children.count - 1 {
      let copy = copyNode(link)
      try insert(copy, after: extractedChildren.last!)
      for child in children[(last + 1)...] { try append(copy, [child]) }
    }
  }

  /// `RangeSelection.extract`: the selected nodes, splitting text the
  /// selection ends inside so it's selected whole.
  mutating func extract(_ selection: RangeSelection) throws -> [NodeKey] {
    var nodes = try self.nodes(in: selection)
    guard var first = nodes.first, var last = nodes.last else { return [] }
    let ((start, startOffset), (end, endOffset)) = try ends(of: selection)
    if nodes.count == 1 {
      guard state[first].isText, !selection.isCollapsed else { return [first] }
      let split = try splitText(first, at: [startOffset, endOffset])
      guard let node = startOffset == 0 ? split.first : split.dropFirst().first else { return [] }
      start.set(node, 0, .text)
      end.set(node, state.textSize(of: node), .text)
      return [node]
    }
    if state[first].isText {
      if startOffset == state.textSize(of: first) {
        nodes.removeFirst()
      } else if startOffset != 0 {
        first = try splitText(first, at: [startOffset])[1]
        nodes[0] = first
        start.set(first, 0, .text)
      }
    }
    if state[last].isText {
      if endOffset == 0 {
        nodes.removeLast()
      } else if endOffset != state.textSize(of: last) {
        last = try splitText(last, at: [endOffset])[0]
        nodes[nodes.count - 1] = last
        end.set(last, state.textSize(of: last), .text)
      }
    }
    return nodes
  }

  /// `$getCharacterOffsets`: an element point counts as the start of its
  /// text, or the end where it's after the last child.
  func characterOffsets(_ selection: RangeSelection) -> (Int, Int) {
    let (anchor, focus) = (selection.anchor, selection.focus)
    if anchor.type == .element, focus.type == .element, anchor.key == focus.key, anchor.offset == focus.offset {
      return (0, 0)
    }
    let offset = { (point: SelectionPoint) -> Int in
      guard point.type == .element else { return point.offset }
      return point.offset == self.state.childCount(of: point.key)
        ? self.state.textContent(of: point.key).utf16.count : 0
    }
    return (offset(anchor), offset(focus))
  }

  /// Where the selection starts and where it ends, in document order, each
  /// point with its offset as `characterOffsets` counts it.
  func ends(of selection: RangeSelection) throws
    -> (start: (point: SelectionPoint, offset: Int), end: (point: SelectionPoint, offset: Int))
  {
    let (anchor, focus) = (selection.anchor, selection.focus)
    let (anchorOffset, focusOffset) = characterOffsets(selection)
    return try state.isBackward(selection)
      ? ((focus, focusOffset), (anchor, anchorOffset)) : ((anchor, anchorOffset), (focus, focusOffset))
  }

  // MARK: Nodes

  /// `$createLinkNode`.
  mutating func createLink(_ url: String, rel: Nullable<String>, target: Nullable<String>, title: Nullable<String>)
    -> NodeKey
  {
    let key = create(SerializedLinkNode.type)
    modifyLink(key) { ($0.url, $0.rel, $0.target, $0.title) = (url, rel, target, title) }
    return key
  }

  /// The properties of `key`, which is a link or an autolink.
  func linkFields(of key: NodeKey) -> any LinkFields {
    guard let fields = state[key].payload.linkFields else { preconditionFailure("\(state[key].type) isn't a link") }
    return fields
  }

  /// Changes the properties of `key`, which is a link or an autolink.
  mutating func modifyLink(_ key: NodeKey, _ change: (inout any LinkFields) -> Void) {
    var fields = linkFields(of: key)
    change(&fields)
    modify(key) { $0.payload.linkFields = fields }
  }

  // MARK: Transform

  /// `$linkNodeTransform`: a block in a link goes beside the top-level node
  /// the link is in, its children in a copy of the link, and a link merges
  /// with a like link beside it.
  mutating func transformLink(_ link: NodeKey) throws {
    let selection = self.selection
    var anchorPair = try selection.map { try caretPair($0.anchor) }
    var focusPair = try selection.map { try caretPair($0.focus) }
    var transformed = false
    var next = state.firstChild(of: link)
    while let child = next {
      next = state.nextSibling(of: child)
      guard state[child].isElement, !state[child].isInline else { continue }
      let blockChildren = Array(state.children(of: child))
      if !blockChildren.isEmpty {
        let innerLink = copyNode(link)
        try append(innerLink, blockChildren)
        try append(child, [innerLink])
        transformed = true
      }
      try insertAtNearestRoot(child, state.rewind(.sibling(child, .next)), SplitOptions(splitsAtEdges: false))
    }
    if state.isAttached(link) {
      if let previous = state.previousSibling(of: link), shouldMergeLinks(previous, link) {
        anchorPair = anchorPair.map { fixMergeBoundary($0, absorbing: previous, merging: link) }
        focusPair = focusPair.map { fixMergeBoundary($0, absorbing: previous, merging: link) }
        try append(previous, Array(state.children(of: link)))
        try remove(link)
        restoreSelection(selection, anchorPair, focusPair)
        return
      }
      if let next = state.nextSibling(of: link), shouldMergeLinks(link, next) {
        anchorPair = anchorPair.map { fixMergeBoundary($0, absorbing: link, merging: next) }
        focusPair = focusPair.map { fixMergeBoundary($0, absorbing: link, merging: next) }
        try append(link, Array(state.children(of: next)))
        try remove(next)
        transformed = true
      }
    }
    guard transformed else { return }
    if isEmpty(link) {
      let parent = state.parent(of: link)
      try remove(link)
      if let parent, isEmpty(parent) { try remove(parent) }
    }
    restoreSelection(selection, anchorPair, focusPair)
  }

  /// `LinkNode.shouldMergeAdjacentLink`, which an autolink never does.
  private func shouldMergeLinks(_ link: NodeKey, _ other: NodeKey) -> Bool {
    guard isNonAutoLink(link), isNonAutoLink(other) else { return false }
    let (a, b) = (linkFields(of: link), linkFields(of: other))
    return a.url == b.url && a.target == b.target && a.rel == b.rel && a.title == b.title
  }

  private typealias CaretPair = (next: Caret, previous: Caret)

  /// `$saveCaretPair`.
  private func caretPair(_ point: SelectionPoint) throws -> CaretPair {
    let next = try state.caret(from: point, .next)
    return (next, state.flipped(next))
  }

  /// `$fixMergeBoundaryCaret`: a caret after the absorbing link would move
  /// past what the merge appends to it, so it goes where that starts.
  private func fixMergeBoundary(_ pair: CaretPair, absorbing: NodeKey, merging: NodeKey) -> CaretPair {
    let isAffected = { (caret: Caret) in caret.isSibling && caret.origin == absorbing }
    guard isAffected(pair.next) || isAffected(pair.previous) else { return pair }
    let fixed = state.normalize(.child(merging, .next))
    return (fixed, state.flipped(fixed))
  }

  private func restoreSelection(_ selection: RangeSelection?, _ anchorPair: CaretPair?, _ focusPair: CaretPair?) {
    guard let selection, let anchorPair, let focusPair else { return }
    restore(selection.anchor, from: anchorPair)
    restore(selection.focus, from: focusPair)
    normalizeSelection(selection)
  }

  /// `$restoreCaretPair`.
  private func restore(_ point: SelectionPoint, from pair: CaretPair) {
    for caret in [pair.next, pair.previous] where state.isCaretAttached(caret) {
      setPoint(point, from: state.normalize(caret))
      return
    }
  }
}

/// The properties LinkNode keeps, which an AutoLinkNode keeps too.
protocol LinkFields {
  var url: String? { get set }
  var rel: Nullable<String> { get set }
  var target: Nullable<String> { get set }
  var title: Nullable<String> { get set }
}

extension SerializedLinkNode: LinkFields {}
extension SerializedAutoLinkNode: LinkFields {}

extension SerializedNode {
  var linkFields: (any LinkFields)? {
    get {
      switch self {
      case .link(let node): node
      case .autoLink(let node): node
      default: nil
      }
    }
    set {
      switch newValue {
      case let node as SerializedLinkNode: self = .link(node)
      case let node as SerializedAutoLinkNode: self = .autoLink(node)
      default: break
      }
    }
  }
}
