import OrderedCollections

/// One update to a state, as Lexical runs `editor.update`: nodes change
/// through the same operations, marking the same nodes dirty, so transforms,
/// garbage collection and the change set see what Lexical's would.
struct Update {
  var state: EditorState
  private(set) var nextKey: NodeKey
  /// In the order Lexical first marks them, which is the order its
  /// transforms visit them in.
  var dirtyLeaves: OrderedSet<NodeKey> = []
  /// True where the element itself changed, false where only a descendant did.
  var dirtyElements: OrderedDictionary<NodeKey, Bool> = [:]
  /// Every node marked in this update, which the transforms' rounds forget.
  private(set) var touched: Set<NodeKey> = []

  init(_ state: EditorState, nextKey: NodeKey) {
    self.state = state
    self.nextKey = nextKey
  }

  subscript(key: NodeKey) -> Node { state[key] }

  // MARK: Dirty nodes

  /// Lexical's `getWritable`: the node and, unintentionally, its ancestors.
  mutating func markDirty(_ key: NodeKey) {
    let node = state[key]
    touched.insert(key)
    var ancestor = node.parent
    while let parentKey = ancestor, dirtyElements[parentKey] == nil, let parent = state.nodes[parentKey] {
      dirtyElements[parentKey] = false
      ancestor = parent.parent
    }
    if node.isElement {
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
    let node = Node(payload, type: type, children: children)
    state.nodes[key] = node
    touched.insert(key)
    if node.isElement {
      dirtyElements[key] = true
    } else {
      dirtyLeaves.append(key)
    }
    return key
  }

  /// A node of `type` with every property at Lexical's default.
  mutating func create(_ type: String) -> NodeKey {
    let traits = NodeTraits.byType[type] ?? .unregistered
    return create(
      SerializedNode(json: ["type": .string(type)]).resolved(), type: type,
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
      guard nodes.allSatisfy({ state[$0].isElement || state[$0].isDecorator }) else {
        throw EditorError.invalidState("Only element or decorator nodes can be inserted to the root node")
      }
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
    for _ in 0..<deleteCount {
      let doomed = state[parent].children![before.flatMap { state[parent].children!.firstIndex(of: $0) }.map { $0 + 1 } ?? 0]
      markDirty(doomed)
      detach(doomed)
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
  mutating func insert(_ node: NodeKey, before sibling: NodeKey) throws {
    try checkInsertion(node, besides: sibling)
    markDirty(sibling)
    markDirty(node)
    detach(node)
    let parent = state[sibling].parent!
    let index = state[parent].children!.firstIndex(of: sibling)!
    if index > 0 { markDirty(state[parent].children![index - 1]) }
    markDirty(parent)
    state.nodes[parent]!.children!.insert(node, at: index)
    state.nodes[node]!.parent = parent
  }

  /// Lexical's `insertAfter`.
  mutating func insert(_ node: NodeKey, after sibling: NodeKey) throws {
    try checkInsertion(node, besides: sibling)
    markDirty(sibling)
    markDirty(node)
    detach(node)
    let parent = state[sibling].parent!
    let index = state[parent].children!.firstIndex(of: sibling)!
    markDirty(parent)
    if index + 1 < state[parent].children!.count { markDirty(state[parent].children![index + 1]) }
    state.nodes[parent]!.children!.insert(node, at: index + 1)
    state.nodes[node]!.parent = parent
  }

  /// Lexical's `replace`, which leaves the replaced node's children with it.
  @discardableResult
  mutating func replace(_ node: NodeKey, with replacement: NodeKey) throws -> NodeKey {
    try checkInsertion(replacement, besides: node)
    let parent = state[node].parent!
    markDirty(replacement)
    markDirty(parent)
    detach(replacement)
    let index = state[parent].children!.firstIndex(of: node)!
    detach(node)
    let siblings = state[parent].children!
    if index > 0 { markDirty(siblings[index - 1]) }
    if index < siblings.count { markDirty(siblings[index]) }
    state.nodes[parent]!.children!.insert(replacement, at: index)
    state.nodes[replacement]!.parent = parent
    return replacement
  }

  /// Lexical's `remove`: a parent left empty that can't be goes too.
  mutating func remove(_ node: NodeKey, preservingEmptyParent: Bool = false) throws {
    guard let parent = state[node].parent else { return }
    detach(node)
    let emptied = state[parent]
    if !preservingEmptyParent, !emptied.isRootOrShadowRoot, !emptied.canBeEmpty, emptied.children!.isEmpty {
      try remove(parent)
    }
  }

  private func checkInsertion(_ node: NodeKey, besides sibling: NodeKey) throws {
    if state[node].isText, let parent = state[sibling].parent, state[parent].isRoot {
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
  /// document go, with everything under them.
  mutating func collectGarbage() {
    let dirty = Array(dirtyElements.keys) + Array(dirtyLeaves)
    for key in dirty where state.nodes[key] != nil && !state.isAttached(key) {
      var doomed = [key]
      while let next = doomed.popLast() {
        guard let node = state.nodes.removeValue(forKey: next) else { continue }
        doomed += node.children ?? []
      }
    }
  }

  /// The paths of what changed, in the document after the update.
  var changes: ChangeSet {
    let keys = Array(dirtyLeaves) + dirtyElements.filter(\.value).map(\.key)
    return ChangeSet(changed: Set(keys.compactMap { state.nodes[$0] == nil ? nil : state.path(of: $0) }))
  }
}
