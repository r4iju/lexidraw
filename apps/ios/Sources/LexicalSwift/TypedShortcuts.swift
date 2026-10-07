/// `HR_TYPED` and `CHECK_ITEM_IN_BULLET` from @packages/lexical-nodes: the
/// text match shortcuts that finish blocks as they are typed.
extension Update {
  /// `HR_TYPED`'s `replace`: `---` alone on a line becomes a divider before
  /// the line, which is left empty with the caret in it.
  mutating func replaceTypedRule(_ matched: NodeKey) throws {
    guard let line = state.parent(of: matched), state[line].type == SerializedParagraphNode.type,
      state.textContent(of: line) == "---", let container = state.parent(of: line),
      state[container].isRootOrShadowRoot, toggleOfTitle(line) == nil
    else { return }
    try remove(matched)
    try insert(create(SerializedHorizontalRuleNode.type), before: line)
    _ = select(line)
  }

  /// `CHECK_ITEM_IN_BULLET`'s `replace`: `[ ] ` or `[x] ` at the start of a
  /// bullet makes it a check item.
  mutating func checkBulletItem(_ matched: NodeKey, _ groups: [String?]) throws {
    guard let item = state.parent(of: matched), isListItem(item), let list = state.parent(of: item),
      listType(list) == .bullet, state.firstChild(of: item) == matched
    else { return }
    try remove(matched)
    try retypeListItem(item, .check)
    if case .listItem(var payload) = state[item].payload {
      payload.checked = groups[1]?.lowercased() == "x"
      modify(item) { $0.payload = .listItem(payload) }
    }
    _ = selectStart(item)
  }

  /// `$retypeListItem`: `item` moves into a list of `type` of its own, in
  /// place, splitting the list it was in around it, and joins a list of
  /// `type` before it.
  private mutating func retypeListItem(_ item: NodeKey, _ type: ListType) throws {
    guard let list = state.parent(of: item), let listType = listType(list) else { return }
    let nested = state.parent(of: list).map(isListItem) ?? false
    let holder = nested ? state.parent(of: list)! : list
    func place(_ piece: NodeKey, after: NodeKey) throws -> NodeKey {
      if !nested {
        try insert(piece, after: after)
        return piece
      }
      let wrapper = create(SerializedListItemNode.type)
      try append(wrapper, [piece])
      try insert(wrapper, after: after)
      return wrapper
    }
    let later = nextSiblings(of: item)
    let retyped = createList(type)
    let placed = try place(retyped, after: holder)
    if !later.isEmpty {
      let rest = createList(listType)
      try append(rest, later)
      _ = try place(rest, after: placed)
    }
    try append(retyped, [item])
    if isEmpty(list) { try remove(holder) }
    if nested { return }
    if let before = state.previousSibling(of: retyped), self.listType(before) == type {
      try append(before, Array(state[retyped].children ?? []))
      try remove(retyped)
    }
  }
}
