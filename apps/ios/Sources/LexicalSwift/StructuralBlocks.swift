/// The original structural plugins' command handlers and repair transforms.
/// The reference bundle executes those unchanged plugins through its hook adapter.
extension Update {
  mutating func structuralDelete(_ selection: RangeSelection) -> Bool {
    guard selection.isCollapsed, selection.anchor.offset == 0,
      let topLevel = findParent(
        from: selection.anchor.key,
        where: { key in
          state.parent(of: key).map { state[$0].isRootOrShadowRoot } == true
        }),
      let previous = state.previousSibling(of: topLevel),
      case .collapsibleContainer(var container) = state[previous].payload
    else { return false }
    container.open = true
    modify(previous) { $0.payload = .collapsibleContainer(container) }
    return true
  }

  mutating func structuralEnter(_ selection: RangeSelection) throws -> Bool {
    if let title = findParent(from: selection.anchor.key, where: { state[$0].type == "collapsible-title" }),
      let container = state.parent(of: title), state[container].type == "collapsible-container"
    {
      // Rich text escapes case formats before dispatching INSERT_PARAGRAPH.
      escapeCaseFormats(selection)
      if case .collapsibleContainer(let current) = state[container].payload, !(current.open ?? false).isTruthy {
        modify(container) { node in
          guard case .collapsibleContainer(var value) = node.payload else { return }
          value.open = true
          node.payload = .collapsibleContainer(value)
        }
      }
      if let content = state.nextSibling(of: title) { selectEnd(content) }
      return true
    }
    if selection.isCollapsed,
      let callout = findParent(from: selection.anchor.key, where: { state[$0].type == "callout" }),
      state[selection.anchor.key].type == SerializedParagraphNode.type,
      isEmpty(selection.anchor.key), state.parent(of: selection.anchor.key) == callout,
      state.nextSibling(of: selection.anchor.key) == nil, state.previousSibling(of: selection.anchor.key) != nil
    {
      escapeCaseFormats(selection)
      let line = selection.anchor.key
      try insert(line, after: callout)
      select(line)
      return true
    }
    return false
  }
}

extension Update {
  mutating func structuralArrow(_ key: ArrowKey) throws {
    guard let selection, selection.isCollapsed else { return }
    let anchor = selection.anchor
    let before = key == .up || key == .left
    if anchor.offset == 0,
      let layout = findParent(from: anchor.key, where: { state[$0].type == "layout-container" }),
      let parent = state.parent(of: layout),
      (before ? state.firstChild(of: parent) : state.lastChild(of: parent)) == layout,
      (before ? firstDescendant(of: layout) : lastDescendant(of: layout)) == anchor.key
    {
      let paragraph = create(SerializedParagraphNode.type)
      if before { try insert(paragraph, before: layout) } else { try insert(paragraph, after: layout) }
    }
    if let section = findParent(from: anchor.key, where: { state[$0].type == "collapsible-container" }),
      let parent = state.parent(of: section)
    {
      if before, anchor.offset == 0, state.firstChild(of: parent) == section, firstDescendant(of: section) == anchor.key
      {
        try insert(create(SerializedParagraphNode.type), before: section)
      } else if !before, state.lastChild(of: parent) == section {
        let title = firstDescendant(of: section)
        let content = lastDescendant(of: section)
        if [title, content].compactMap({ $0 }).contains(where: {
          $0 == anchor.key && anchor.offset == state.textContent(of: $0).utf16.count
        }) {
          try insert(create(SerializedParagraphNode.type), after: section)
        }
      }
    }
    if key == .up || key == .down,
      let callout = findParent(from: anchor.key, where: { state[$0].type == "callout" }),
      let edge = before ? firstDescendant(of: callout) : lastDescendant(of: callout),
      edge == anchor.key, anchor.offset == (before ? 0 : state.textContent(of: edge).utf16.count),
      (before ? state.previousSibling(of: callout) : state.nextSibling(of: callout)) == nil
    {
      let paragraph = create(SerializedParagraphNode.type)
      if before { try insert(paragraph, before: callout) } else { try insert(paragraph, after: callout) }
    }
  }
}
