import OrderedCollections

/// One update to a state, as Lexical runs `editor.update`: nodes change
/// through the same operations, marking the same nodes dirty, so transforms,
/// garbage collection and the change set see what Lexical's would.
struct Update {
  var state: EditorState
  /// The committed state the update started from.
  let base: EditorState
  /// Lexical's `$getSelection()` in an update: a copy of the committed
  /// selection until the update sets another.
  var selection: RangeSelection?
  private(set) var nextKey: NodeKey
  /// What sets this update apart from every other on the same editor.
  let revision: Int
  /// In the order Lexical first marks them, which is the order its
  /// transforms visit them in.
  var dirtyLeaves: OrderedSet<NodeKey> = []
  /// True where the element itself changed, false where only a descendant did.
  var dirtyElements: OrderedDictionary<NodeKey, Bool> = [:]
  /// Every node marked in this update, which the transforms' rounds forget.
  private(set) var touched: Set<NodeKey> = []

  init(_ state: EditorState, nextKey: NodeKey, revision: Int) {
    self.state = state
    base = state
    selection = state.selection.map(RangeSelection.init)
    self.nextKey = nextKey
    self.revision = revision
  }

  /// Whether the update marked any node, which is what makes Lexical commit
  /// it even where the nodes it marked have gone again.
  var hasDirtyNodes: Bool { !touched.isEmpty }

  subscript(key: NodeKey) -> Node { state[key] }

  // MARK: Dirty nodes

  /// Lexical's `getWritable`: the node and, unintentionally, its ancestors.
  mutating func markDirty(_ key: NodeKey) {
    var ancestor = state[key].parent
    while let parentKey = ancestor, dirtyElements[parentKey] == nil, let parent = state.nodes[parentKey] {
      dirtyElements[parentKey] = false
      ancestor = parent.parent
    }
    markOwnDirty(key)
  }

  private mutating func markOwnDirty(_ key: NodeKey) {
    touched.insert(key)
    state.nodes[key]!.revision = revision
    if state[key].isElement {
      dirtyElements[key] = true
    } else {
      dirtyLeaves.append(key)
    }
  }

  mutating func modify(_ key: NodeKey, _ change: (inout Node) -> Void) {
    markDirty(key)
    change(&state.nodes[key]!)
  }

  /// A new node, as a Lexical constructor makes one: dirty, and in no parent.
  mutating func create(_ payload: SerializedNode, type: String, children: OrderedSet<NodeKey>?) -> NodeKey {
    let key = nextKey
    nextKey += 1
    state.nodes[key] = Node(payload, type: type, children: children)
    markOwnDirty(key)
    return key
  }

  /// A node of `type` with every property at Lexical's default.
  mutating func create(_ type: String) -> NodeKey {
    let traits = NodeTraits.byType[type] ?? .unregistered
    return create(
      SerializedNode(json: ["type": .string(type)]).asLoaded(), type: type,
      children: traits.kind == .element ? [] : nil)
  }

  // MARK: Tree

  /// Lexical's `$removeFromParent`.
  mutating func detach(_ key: NodeKey) {
    guard let parent = state[key].parent else { return }
    markDirty(key)
    markDirty(parent)
    let siblings = state[parent].children!
    let index = siblings.firstIndex(of: key)!
    if index > 0 { markDirty(siblings[index - 1]) }
    if index + 1 < siblings.count { markDirty(siblings[index + 1]) }
    state.nodes[parent]!.children!.remove(at: index)
    state.nodes[key]!.parent = nil
  }

  /// Lexical's `ElementNode.splice`, with the list overrides of it.
  mutating func splice(_ parent: NodeKey, _ start: Int, deleting deleteCount: Int, inserting nodes: [NodeKey]) throws {
    var nodes = nodes
    switch state[parent].type {
    case SerializedRootNode.type:
      for node in nodes { try checkChild(node, of: parent) }
    case SerializedListNode.type:
      nodes = try nodes.map { node in
        if state[node].type == SerializedListItemNode.type { return node }
        let item = create(SerializedListItemNode.type)
        let child = state[node]
        if child.isElement, child.type != SerializedListNode.type, !child.isInline {
          try append(item, Array(child.children!))
        } else {
          try append(item, [node])
        }
        return item
      }
    default: break
    }
    try spliceChildren(parent, start, deleting: deleteCount, inserting: nodes)
  }

  private mutating func spliceChildren(_ parent: NodeKey, _ start: Int, deleting deleteCount: Int, inserting nodes: [NodeKey])
    throws
  {
    let children = state[parent].children!
    guard start + deleteCount <= children.count else {
      throw EditorError.invalidState("splice: start + deleteCount > oldSize")
    }
    markDirty(parent)
    var after = start + deleteCount < children.count ? children[start + deleteCount] : nil
    var before = start > 0 ? children[start - 1] : nil
    var removed: [NodeKey] = []
    var doomed = before.map(state.nextSibling(of:)) ?? children.first
    for _ in 0..<deleteCount {
      let key = doomed!
      doomed = state.nextSibling(of: key)
      markDirty(key)
      detach(key)
      removed.append(key)
    }
    var previous = before
    for node in nodes {
      if let current = previous, current == node {
        before = state.previousSibling(of: current)
        previous = before
      }
      if let current = after, current == node {
        after = state.nextSibling(of: current)
      }
      markDirty(node)
      detach(node)
      let index = previous.flatMap { state[parent].children!.firstIndex(of: $0) }.map { $0 + 1 } ?? 0
      if let previous { markDirty(previous) }
      guard node != parent else { throw EditorError.invalidState("append: attempting to append self") }
      state.nodes[parent]!.children!.insert(node, at: index)
      state.nodes[node]!.parent = parent
      previous = node
    }
    if let after {
      markDirty(after)
      if let previous { markDirty(previous) }
    } else if let previous {
      markDirty(previous)
    }
    guard !removed.isEmpty, let selection else { return }
    let spliced = state
    let isRemoved = { (point: SelectionPoint) -> Bool in
      var node: NodeKey? = point.key
      while let current = node {
        if removed.contains(current), !nodes.contains(current) { return true }
        node = spliced.parent(of: current)
      }
      return false
    }
    for point in [selection.anchor, selection.focus] where isRemoved(point) {
      moveSelectionPoint(point, toSiblingOf: point.key, in: parent, previous: before, next: after)
    }
    let emptied = state[parent]
    if emptied.children!.isEmpty, !emptied.canBeEmpty, !emptied.isRootOrShadowRoot {
      try remove(parent)
    }
  }

  /// Lexical's `ElementNode.append`, with the list item override of it.
  mutating func append(_ parent: NodeKey, _ nodes: [NodeKey]) throws {
    guard state[parent].type == SerializedListItemNode.type else {
      return try splice(parent, state[parent].children!.count, deleting: 0, inserting: nodes)
    }
    for node in nodes {
      let child = state[node]
      if child.isElement, child.type == SerializedListItemNode.type || child.type == SerializedParagraphNode.type {
        try append(parent, Array(child.children!))
        try remove(node)
      } else {
        try splice(parent, state[parent].children!.count, deleting: 0, inserting: [node])
      }
    }
  }

  /// Lexical's `insertBefore`.
  mutating func insert(_ node: NodeKey, before sibling: NodeKey, restoringSelection: Bool = true) throws {
    try checkInsertion(node, besides: sibling)
    markDirty(sibling)
    markDirty(node)
    let selection = restoringSelection ? selection : nil
    let oldParent = state[node].parent
    let oldIndex = oldParent.flatMap { oldParent in
      selection.flatMap { touches($0, oldParent) ? state.index(of: node) : nil }
    }
    detach(node)
    if let selection, let oldParent, let oldIndex {
      try updateElementSelection(selection, onCreatingOrDeletingIn: oldParent, at: oldIndex, times: -1)
    }
    let previous = state.previousSibling(of: sibling)
    let parent = state[sibling].parent!
    markDirty(parent)
    let index = selection.flatMap { touches($0, parent) ? state.index(of: sibling) : nil }
    if let previous { markDirty(previous) }
    state.nodes[parent]!.children!.insert(node, at: state.index(of: sibling)!)
    state.nodes[node]!.parent = parent
    if let selection, let index {
      try updateElementSelection(selection, onCreatingOrDeletingIn: parent, at: index, times: 1)
    }
  }

  /// Lexical's `insertAfter`.
  mutating func insert(_ node: NodeKey, after sibling: NodeKey, restoringSelection: Bool = true) throws {
    try checkInsertion(node, besides: sibling)
    markDirty(sibling)
    markDirty(node)
    let selection = restoringSelection ? selection : nil
    let oldParent = state[node].parent
    var anchorOnNode = false
    var focusOnNode = false
    var oldIndex: Int?
    if let selection, let oldParent, touches(selection, oldParent) {
      let index = state.index(of: node)!
      oldIndex = index
      let isOnNode = { (point: SelectionPoint) in
        point.type == .element && point.key == oldParent && point.offset == index + 1
      }
      anchorOnNode = isOnNode(selection.anchor)
      focusOnNode = isOnNode(selection.focus)
    }
    detach(node)
    if let selection, let oldParent, let oldIndex {
      try updateElementSelection(selection, onCreatingOrDeletingIn: oldParent, at: oldIndex, times: -1)
    }
    let next = state.nextSibling(of: sibling)
    let parent = state[sibling].parent!
    markDirty(parent)
    if let next { markDirty(next) }
    state.nodes[parent]!.children!.insert(node, at: state.index(of: sibling)! + 1)
    state.nodes[node]!.parent = parent
    if let selection, anchorOnNode || focusOnNode || touches(selection, parent) {
      let index = state.index(of: sibling)!
      try updateElementSelection(selection, onCreatingOrDeletingIn: parent, at: index + 1, times: 1)
      if anchorOnNode { selection.anchor.set(parent, index + 2, .element) }
      if focusOnNode { selection.focus.set(parent, index + 2, .element) }
    }
  }

  /// Lexical's `replace`, which leaves the replaced node's children with it.
  /// The selection it restores is a copy, which then becomes the selection.
  @discardableResult
  mutating func replace(_ node: NodeKey, with replacement: NodeKey) throws -> NodeKey {
    let selection = selection?.clone()
    try checkInsertion(replacement, besides: node)
    markDirty(replacement)
    let parent = state[node].parent!
    markDirty(parent)
    let oldParent = state[replacement].parent
    let oldIndex = oldParent.flatMap { oldParent in
      selection.flatMap { touches($0, oldParent) ? state.index(of: replacement) : nil }
    }
    detach(replacement)
    if let selection, let oldParent, let oldIndex {
      try updateElementSelection(selection, onCreatingOrDeletingIn: oldParent, at: oldIndex, times: -1)
    }
    let previous = state.previousSibling(of: node)
    let next = state.nextSibling(of: node)
    let index = state.index(of: node)!
    try removeNode(node, restoringSelection: false, preservingEmptyParent: true)
    if let previous { markDirty(previous) }
    if let next { markDirty(next) }
    state.nodes[parent]!.children!.insert(replacement, at: index)
    state.nodes[replacement]!.parent = parent
    if let selection {
      setSelection(selection)
      for point in [selection.anchor, selection.focus] where point.key == node {
        movePoint(point, toEndOf: replacement)
      }
    }
    return replacement
  }

  /// Lexical's `remove`: a parent left empty that can't be goes too, and the
  /// selection moves off what goes.
  mutating func remove(_ node: NodeKey, preservingEmptyParent: Bool = false) throws {
    try removeNode(node, restoringSelection: true, preservingEmptyParent: preservingEmptyParent)
  }

  /// Lexical's `$removeNode`.
  mutating func removeNode(_ node: NodeKey, restoringSelection: Bool, preservingEmptyParent: Bool = false) throws {
    guard let parent = state[node].parent else { return }
    let selection = moveChildrenSelectionToParent(node)
    var moved = false
    if let selection, restoringSelection {
      for point in [selection.anchor, selection.focus] where point.key == node {
        moveSelectionPoint(
          point, toSiblingOf: node, in: parent, previous: state.previousSibling(of: node),
          next: state.nextSibling(of: node))
        moved = true
      }
    }
    if let selection, restoringSelection, !moved, touches(selection, parent) {
      let index = state.index(of: node)!
      detach(node)
      try updateElementSelection(selection, onCreatingOrDeletingIn: parent, at: index, times: -1)
    } else {
      detach(node)
    }
    let emptied = state[parent]
    if !preservingEmptyParent, !emptied.isRootOrShadowRoot, !emptied.canBeEmpty, emptied.children!.isEmpty {
      try removeNode(parent, restoringSelection: restoringSelection)
    }
    if restoringSelection, selection != nil, emptied.isRoot, state[parent].children!.isEmpty {
      selectEnd(parent)
    }
  }

  private func checkInsertion(_ node: NodeKey, besides sibling: NodeKey) throws {
    if let parent = state[sibling].parent { try checkChild(node, of: parent) }
  }

  private func checkChild(_ node: NodeKey, of parent: NodeKey) throws {
    if state[parent].isRoot, !state[node].isElement, !state[node].isDecorator {
      throw EditorError.invalidState("Only element or decorator nodes can be inserted to the root node")
    }
  }

  // MARK: Committing

  /// Lexical's transform cycle: text normalization and every node class's
  /// transform, over dirty leaves first and then dirty elements, until
  /// nothing new is dirty.
  mutating func applyTransforms() throws {
    var untransformedLeaves = dirtyLeaves
    var allLeaves = dirtyLeaves
    var allElements: OrderedDictionary<NodeKey, Bool>?
    var rounds = 0
    while !untransformedLeaves.isEmpty || !dirtyElements.isEmpty {
      rounds += 1
      guard rounds < 100 else { throw EditorError.invalidState("Transforms never settled") }
      if !untransformedLeaves.isEmpty {
        dirtyLeaves = []
        for key in untransformedLeaves {
          if let node = state.nodes[key], node.isSimpleText, !node.isUnmergeable, state.isAttached(key) {
            try normalizeText(key)
          }
          allLeaves.append(key)
        }
        untransformedLeaves = dirtyLeaves
        if !untransformedLeaves.isEmpty { continue }
      }
      // The root goes last, and counts as changed whenever anything in it did.
      var untransformedElements = dirtyElements
      if untransformedElements.removeValue(forKey: EditorState.rootKey) != nil {
        untransformedElements[EditorState.rootKey] = true
      }
      if allElements == nil { allElements = untransformedElements }
      dirtyLeaves = []
      dirtyElements = [:]
      for (key, intentional) in untransformedElements {
        allElements![key] = intentional
        guard intentional, state.nodes[key] != nil, state.isAttached(key) else { continue }
        try transformElement(key)
      }
      untransformedLeaves = dirtyLeaves
    }
    dirtyLeaves = allLeaves
    if let allElements { dirtyElements = allElements }
  }

  /// Lexical's `$garbageCollectDetachedNodes`: dirty nodes left out of the
  /// document go, with everything under them, and those the update created
  /// are no longer counted as changed.
  mutating func collectGarbage() {
    var doomed: [NodeKey] = []
    for key in dirtyElements.keys where state.nodes[key] != nil && !state.isAttached(key) {
      collect(key, into: &doomed)
      if base.nodes[key] == nil { dirtyElements.removeValue(forKey: key) }
      doomed.append(key)
    }
    for key in dirtyLeaves where state.nodes[key] != nil && !state.isAttached(key) {
      if base.nodes[key] == nil { dirtyLeaves.remove(key) }
      doomed.append(key)
    }
    for key in doomed { state.nodes.removeValue(forKey: key) }
  }

  /// `$garbageCollectDetachedDeepChildNodes`.
  private mutating func collect(_ element: NodeKey, into doomed: inout [NodeKey]) {
    for child in state.children(of: element) where state[child].parent == element {
      if state[child].isElement { collect(child, into: &doomed) }
      if base.nodes[child] == nil { dirtyElements.removeValue(forKey: child) }
      doomed.append(child)
    }
  }

  /// The paths of what changed, in the document after the update.
  var changes: ChangeSet {
    let keys = Array(dirtyLeaves) + dirtyElements.filter(\.value).map(\.key)
    return ChangeSet(changed: Set(keys.compactMap { state.nodes[$0] == nil ? nil : state.path(of: $0) }))
  }
}
