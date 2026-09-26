extension Node {
  var textNode: SerializedTextNode? {
    if case .text(let node) = payload { node } else { nil }
  }

  /// Plain text Lexical merges with its neighbours: a `text` node in normal mode.
  var isSimpleText: Bool { textNode?.mode == .normal }

  var isUnmergeable: Bool { textNode.map { Int($0.detail ?? 0) & 2 != 0 } ?? false }

  var text: String { textNode?.text ?? "" }
}

extension Update {
  /// Lexical's `$normalizeTextNode`: empty simple text goes, and simple text
  /// merges into a neighbour it can't be told apart from.
  mutating func normalizeText(_ key: NodeKey) throws {
    var node = key
    if self[node].text.isEmpty, self[node].isSimpleText, !self[node].isUnmergeable {
      try remove(node)
      return
    }
    while let previous = state.previousSibling(of: node), self[previous].isSimpleText, !self[previous].isUnmergeable {
      if self[previous].text.isEmpty {
        try remove(previous)
      } else if canMerge(previous, node) {
        node = try merge(previous, node)
        break
      } else {
        break
      }
    }
    while let next = state.nextSibling(of: node), self[next].isSimpleText, !self[next].isUnmergeable {
      if self[next].text.isEmpty {
        try remove(next)
      } else if canMerge(node, next) {
        node = try merge(node, next)
        break
      } else {
        break
      }
    }
  }

  private func canMerge(_ first: NodeKey, _ second: NodeKey) -> Bool {
    guard let a = self[first].textNode, let b = self[second].textNode else { return false }
    let state = a.unknownFields["$"]
    return a.mode == b.mode && a.format == b.format && a.style == b.style
      && (state == nil || state == b.unknownFields["$"])
  }

  /// `first.mergeWithSibling(second)`, for `second` right after `first`.
  private mutating func merge(_ first: NodeKey, _ second: NodeKey) throws -> NodeKey {
    try setText(first, self[first].text + self[second].text)
    markDirty(first)
    try remove(second)
    return first
  }

  /// Lexical's `setTextContent`.
  mutating func setText(_ key: NodeKey, _ text: String) throws {
    guard case .text(var node) = self[key].payload else {
      throw EditorError.unsupported("Setting the text of a \(self[key].type) node")
    }
    guard node.text != text else { return }
    node.text = text
    modify(key) { $0.payload = .text(node) }
  }

  /// Every node class's `$transform` that runs on elements.
  mutating func transformElement(_ key: NodeKey) throws {
    try wrapInlineChildren(key)
    guard state.isAttached(key) else { return }
    switch self[key].type {
    case SerializedListNode.type:
      if let next = state.nextSibling(of: key), let listType = listType(key), listType == self.listType(next) {
        try mergeLists(key, next)
      }
      numberListItems(key)
    case SerializedListItemNode.type:
      try wrapInList(key)
    default: break
    }
  }

  /// ElementNode's transform: a root or shadow root holds blocks, so runs of
  /// inline children go into paragraphs.
  private mutating func wrapInlineChildren(_ key: NodeKey) throws {
    guard self[key].isRootOrShadowRoot, hasTouchedInlineChild(key) else { return }
    var block: NodeKey?
    for child in self[key].children! {
      guard self[child].isInline else {
        block = nil
        continue
      }
      if block == nil {
        block = try replace(child, with: create(SerializedParagraphNode.type))
      }
      try append(block!, [child])
    }
  }

  /// Every committed state holds blocks alone at its roots, so an inline
  /// child can only be one this update marked. Looking at those alone keeps
  /// Lexical's walk over every child of the root off each keystroke.
  private func hasTouchedInlineChild(_ key: NodeKey) -> Bool {
    let children = self[key].children!
    if touched.count < children.count {
      return touched.contains { state.nodes[$0]?.parent == key && self[$0].isInline }
    }
    return children.contains { touched.contains($0) && self[$0].isInline }
  }

  // MARK: Lists

  private func listType(_ key: NodeKey) -> ListType? {
    if case .list(let list) = self[key].payload { list.listType } else { nil }
  }

  /// A list item whose first child is a list, holding a nested list.
  private func isNestedListItem(_ key: NodeKey) -> Bool {
    self[key].type == SerializedListItemNode.type
      && self[key].children!.first.map { self[$0].type == SerializedListNode.type } == true
  }

  /// `mergeLists` from @lexical/list.
  private mutating func mergeLists(_ first: NodeKey, _ second: NodeKey) throws {
    if let last = self[first].children!.last, let next = self[second].children!.first,
      isNestedListItem(last), isNestedListItem(next),
      listType(self[last].children![0]) == listType(self[next].children![0])
    {
      try mergeLists(self[last].children![0], self[next].children![0])
      try remove(next)
    }
    let moving = self[second].children!
    if !moving.isEmpty { try append(first, Array(moving)) }
    try remove(second)
  }

  /// `updateChildrenListItemValue` from @lexical/list.
  private mutating func numberListItems(_ key: NodeKey) {
    guard case .list(let list) = self[key].payload else { return }
    var value = list.start ?? 1
    for child in self[key].children! {
      guard case .listItem(var item) = self[child].payload else { continue }
      if item.value != value {
        item.value = value
        modify(child) { $0.payload = .listItem(item) }
      }
      if list.listType != .check, item.checked != nil {
        item.checked = nil
        modify(child) { $0.payload = .listItem(item) }
      }
      if !isNestedListItem(child) { value += 1 }
    }
  }

  /// ListItemNode's transform: a list item outside a list goes into a bullet
  /// list, with the list items beside it.
  private mutating func wrapInList(_ key: NodeKey) throws {
    guard let parent = self[key].parent, self[parent].type != SerializedListNode.type else { return }
    guard self[parent].isRootOrShadowRoot else {
      throw EditorError.unsupported("A list item in a \(self[parent].type) node rather than a list")
    }
    let list = create(SerializedListNode.type)
    if case .list(var payload) = self[list].payload {
      payload.listType = .bullet
      state.nodes[list]!.payload = .list(payload)
    }
    let siblings = self[parent].children!
    let index = siblings.firstIndex(of: key)!
    let items = siblings.map { self[$0].type == SerializedListItemNode.type }
    let first = items[..<index].lastIndex(of: false).map { $0 + 1 } ?? 0
    let end = items[(index + 1)...].firstIndex(of: false) ?? siblings.count
    try insert(list, before: key)
    try splice(list, 0, deleting: 0, inserting: Array(siblings[first..<end]))
  }
}
