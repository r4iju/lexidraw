import OrderedCollections

/// The original structural plugins' command handlers and repair transforms.
/// The reference bundle executes those unchanged plugins through its hook adapter.
extension Update {
  /// The structural plugins' DELETE_CHARACTER_COMMAND handlers, in the order
  /// the web runs them.
  mutating func structuralDelete(_ selection: RangeSelection, backward: Bool) throws -> Bool {
    if hasEditorPlugin("CollapsiblePlugin"), try toggleDelete(selection, backward: backward) { return true }
    return try hasEditorPlugin("CalloutPlugin") && calloutDelete(selection, backward: backward)
  }

  /// CollapsiblePlugin's DELETE_CHARACTER_COMMAND handlers. Removing a
  /// selection that runs into folded content opens the toggles that fold it
  /// instead. Backspace at the start of a title turns the toggle back into
  /// its title's block followed by what it held, and at the start of a block
  /// after a closed toggle it opens the toggle.
  private mutating func toggleDelete(_ selection: RangeSelection, backward: Bool) throws -> Bool {
    if try revealSelected(selection) { return true }
    guard backward, selection.isCollapsed else { return false }
    if let caret = titleCaret(selection) {
      guard atStart(selection, caret.block) else { return false }
      if let block = try unwrapToggle(caret.container) { selectStart(block) }
      return true
    }
    guard let block = caretBlock(selection), atStart(selection, block),
      let previous = state.previousSibling(of: block), isToggle(previous), !toggleIsOpen(previous)
    else { return false }
    setToggleOpen(previous, true)
    return true
  }

  private mutating func revealSelected(_ selection: RangeSelection) throws -> Bool {
    guard !selection.isCollapsed else { return false }
    var closed: OrderedSet<NodeKey> = []
    for node in try nodes(in: selection) { for container in closedToggles(around: node) { closed.append(container) } }
    for container in closed { setToggleOpen(container, true) }
    return !closed.isEmpty
  }

  mutating func structuralEnter(_ selection: RangeSelection) throws -> Bool {
    // CollapsiblePlugin's INSERT_PARAGRAPH_COMMAND handler. Enter at the end
    // of a title goes into the toggle, opening it; on a closed toggle that
    // holds something it starts the next toggle instead. At the start of a
    // title it opens a line above the toggle.
    if hasEditorPlugin("CollapsiblePlugin"), let caret = titleCaret(selection) {
      let (container, block) = caret
      let content = toggleContent(container)
      if !isEmpty(block), atStart(selection, block) {
        // Rich text escapes case formats before dispatching INSERT_PARAGRAPH.
        escapeCaseFormats(selection)
        try insert(create(SerializedParagraphNode.type), before: container)
        return true
      }
      guard atEnd(selection, block) else { return false }
      escapeCaseFormats(selection)
      if !toggleIsOpen(container), let content, !holdsNothing(content) {
        let next = try createToggle(level: state[block].type == SerializedHeadingNode.type ? block : nil)
        try insert(next.container, after: container)
        select(next.titleBlock)
        return true
      }
      setToggleOpen(container, true)
      try selectContentStart(container)
      return true
    }
    if hasEditorPlugin("CalloutPlugin"), selection.isCollapsed,
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
    if hasEditorPlugin("LayoutPlugin"), anchor.offset == 0,
      let layout = findParent(from: anchor.key, where: { state[$0].type == "layout-container" }),
      let parent = state.parent(of: layout),
      (before ? state.firstChild(of: parent) : state.lastChild(of: parent)) == layout,
      (before ? firstDescendant(of: layout) : lastDescendant(of: layout)) == anchor.key
    {
      let paragraph = create(SerializedParagraphNode.type)
      if before { try insert(paragraph, before: layout) } else { try insert(paragraph, after: layout) }
    }
    // CollapsiblePlugin's arrow handlers: a toggle last in the document
    // always has a line after it to move on to, and one first in it a line
    // before it.
    if hasEditorPlugin("CollapsiblePlugin") {
      if key == .down || key == .right, let container = atToggleEnd(selection), state.nextSibling(of: container) == nil {
        try insert(create(SerializedParagraphNode.type), after: container)
      }
      if key == .up, let caret = titleCaret(selection), atStart(selection, caret.block),
        state.previousSibling(of: caret.container) == nil
      {
        try insert(create(SerializedParagraphNode.type), before: caret.container)
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


extension Update {
  mutating func updateLayoutColumns(_ key: NodeKey, template: String) throws {
    guard case .layoutContainer(var container) = state[key].payload else { return }
    // Match LayoutPlugin's whitespace count, including one item for an empty
    // template. Imported function syntax retains the plugin's own behavior.
    let whitespace = JSRegExp(StructuralBlockConfiguration.columnWhitespacePattern, flags: "")
    let count = max(1, whitespace.split(template).filter { !$0.isEmpty }.count)
    let previous = max(1, whitespace.split(container.templateColumns?.stringValue ?? "").filter { !$0.isEmpty }.count)
    if count > previous {
      for _ in previous..<count {
        let item = create("layout-item")
        try append(item, [create(SerializedParagraphNode.type)])
        try append(key, [item])
      }
    } else if count < previous {
      for index in stride(from: previous - 1, through: count, by: -1) {
        let children = Array(state.children(of: key))
        if children.indices.contains(index), state[children[index]].type == "layout-item" { try remove(children[index]) }
      }
    }
    container.templateColumns = .string(template)
    modify(key) { $0.payload = .layoutContainer(container) }
  }
}

/// The toggle helpers of @packages/lexical-nodes, which CollapsiblePlugin's
/// transforms and commands use.
extension Update {
  func isToggle(_ key: NodeKey?) -> Bool { key.map { state[$0].type == SerializedCollapsibleContainerNode.type } ?? false }
  func isToggleTitle(_ key: NodeKey?) -> Bool { key.map { state[$0].type == SerializedCollapsibleTitleNode.type } ?? false }
  func isToggleContent(_ key: NodeKey?) -> Bool { key.map { state[$0].type == SerializedCollapsibleContentNode.type } ?? false }
  private func isTitleBlock(_ key: NodeKey) -> Bool {
    [SerializedParagraphNode.type, SerializedHeadingNode.type].contains(state[key].type)
  }
  /// A block, as against text and inline elements and decorators.
  private func isToggleBlock(_ key: NodeKey) -> Bool {
    let node = state[key]
    return (node.isElement || node.isDecorator) && !node.isInline && node.type != SerializedListItemNode.type
  }
  func toggleTitleBlock(_ container: NodeKey) -> NodeKey? {
    guard let title = state.firstChild(of: container), isToggleTitle(title),
      let block = state.firstChild(of: title), state[block].isElement
    else { return nil }
    return block
  }
  func toggleContent(_ container: NodeKey) -> NodeKey? { state.children(of: container).first(where: isToggleContent) }
  func toggleIsOpen(_ container: NodeKey) -> Bool {
    if case .collapsibleContainer(let node) = state[container].payload { return (node.open ?? false).isTruthy }
    return false
  }
  mutating func setToggleOpen(_ container: NodeKey, _ open: Bool) {
    modify(container) { node in
      guard case .collapsibleContainer(var value) = node.payload else { return }
      value.open = .bool(open)
      node.payload = .collapsibleContainer(value)
    }
  }
  /// The toggle whose title holds `key`, if any.
  func toggleOfTitle(_ key: NodeKey) -> NodeKey? {
    var at: NodeKey? = key
    while let node = at {
      if isToggleTitle(node) { return state.parent(of: node).flatMap { isToggle($0) ? $0 : nil } }
      at = state.parent(of: node)
    }
    return nil
  }
  /// The closed toggles whose content holds `key`, innermost first.
  func closedToggles(around key: NodeKey) -> [NodeKey] {
    var closed: [NodeKey] = []
    var at = state.parent(of: key)
    while let node = at {
      if isToggleContent(node), let container = state.parent(of: node), isToggle(container), !toggleIsOpen(container) {
        closed.append(container)
      }
      at = state.parent(of: node)
    }
    return closed
  }
  /// What `key` holds as text and inline nodes, its blocks flattened.
  private func inlineOf(_ key: NodeKey) -> [NodeKey] {
    state.children(of: key).flatMap { child in
      state[child].isElement && !state[child].isInline ? inlineOf(child) : [child]
    }
  }

  /// `$repairToggle`: a missing title or content is made, and what sits
  /// beside them goes into the content.
  mutating func repairToggle(_ container: NodeKey) throws {
    let title = state.children(of: container).first(where: isToggleTitle) ?? create(SerializedCollapsibleTitleNode.type)
    if state.firstChild(of: container) != title { try splice(container, 0, deleting: 0, inserting: [title]) }
    let content = state.children(of: container).first(where: isToggleContent) ?? create(SerializedCollapsibleContentNode.type)
    for child in Array(state.children(of: container)) where child != title && child != content {
      if isToggleContent(child) {
        try append(content, Array(state.children(of: child)))
        try remove(child)
      } else {
        try append(content, [child])
      }
    }
    if state.parent(of: content) == nil { try append(container, [content]) }
  }

  /// `$repairToggleTitle`: a title is one paragraph or heading. Inline
  /// content goes in a paragraph, another kind of block becomes a paragraph
  /// of what it says, and further blocks go to the top of the content,
  /// opening the toggle.
  mutating func repairToggleTitle(_ title: NodeKey) throws {
    let children = Array(state.children(of: title))
    guard let container = state.parent(of: title), isToggle(container) else {
      if children.contains(where: isToggleBlock) {
        try unwrapStructuralElement(title)
      } else {
        // The plugin moves children first so a text caret stays on its child.
        let paragraph = create(SerializedParagraphNode.type)
        try append(paragraph, children)
        try replace(title, with: paragraph)
      }
      return
    }
    if !children.contains(where: isToggleBlock) {
      let paragraph = create(SerializedParagraphNode.type)
      try append(paragraph, children)
      try append(title, [paragraph])
      return
    }
    var run: NodeKey?
    for child in children {
      if isToggleBlock(child) { run = nil; continue }
      if run == nil {
        let paragraph = create(SerializedParagraphNode.type)
        try insert(paragraph, before: child)
        run = paragraph
      }
      try append(run!, [child])
    }
    var rest = Array(state.children(of: title))
    guard !rest.isEmpty else { return }
    let first = rest.removeFirst()
    if !isTitleBlock(first) {
      if state[first].isElement {
        let paragraph = create(SerializedParagraphNode.type)
        try append(paragraph, inlineOf(first))
        try replace(first, with: paragraph)
      } else {
        try splice(title, 0, deleting: 0, inserting: [create(SerializedParagraphNode.type)])
        rest.insert(first, at: 0)
      }
    }
    guard !rest.isEmpty, let content = toggleContent(container) else { return }
    let top = state.firstChild(of: content)
    for block in rest {
      if let top { try insert(block, before: top) } else { try append(content, [block]) }
    }
    setToggleOpen(container, true)
  }

  /// `$repairToggleContent`: content outside a toggle is just its blocks;
  /// an empty one gets a line.
  mutating func repairToggleContent(_ content: NodeKey) throws {
    if let parent = state.parent(of: content), !isToggle(parent) {
      try unwrapStructuralElement(content)
    } else if isEmpty(content) {
      try append(content, [create(SerializedParagraphNode.type)])
    }
  }
}

/// CollapsiblePlugin's caret helpers.
extension Update {
  /// The block a caret is in: the nearest under a root or shadow root.
  func caretBlock(_ selection: RangeSelection) -> NodeKey? {
    let block = findParent(from: selection.anchor.key, where: { key in
      state.parent(of: key).map { state[$0].isRootOrShadowRoot } == true
    })
    return block.flatMap { state[$0].isElement ? $0 : nil }
  }
  /// The caret's toggle and its title's block, when the caret is in that title.
  func titleCaret(_ selection: RangeSelection) -> (container: NodeKey, block: NodeKey)? {
    guard selection.isCollapsed, let container = toggleOfTitle(selection.anchor.key),
      let block = toggleTitleBlock(container)
    else { return nil }
    return (container, block)
  }
  func atStart(_ selection: RangeSelection, _ block: NodeKey) -> Bool {
    let anchor = selection.anchor
    return anchor.offset == 0 && (anchor.key == block || anchor.key == firstDescendant(of: block))
  }
  func atEnd(_ selection: RangeSelection, _ block: NodeKey) -> Bool {
    let anchor = selection.anchor
    if anchor.key == block { return anchor.offset == state.childCount(of: block) }
    return anchor.key == lastDescendant(of: block) && anchor.offset == state.textContent(of: anchor.key).utf16.count
  }
  /// Content that is the empty line a new toggle starts with, or less.
  func holdsNothing(_ content: NodeKey) -> Bool {
    let children = state.children(of: content)
    guard let only = children.first else { return true }
    return children.count == 1 && state[only].type == SerializedParagraphNode.type && isEmpty(only)
  }
  /// The toggle holding the caret, when the caret is at its very end.
  func atToggleEnd(_ selection: RangeSelection) -> NodeKey? {
    guard selection.isCollapsed, let block = caretBlock(selection), atEnd(selection, block) else { return nil }
    var at: NodeKey? = block
    while let node = at {
      if let container = state.parent(of: node), isToggle(container) {
        let last = toggleIsOpen(container) ? toggleContent(container).flatMap { state.lastChild(of: $0) } : toggleTitleBlock(container)
        return last == block ? container : nil
      }
      at = state.parent(of: node)
    }
    return nil
  }
  /// `$createToggle`: a closed toggle whose title is an empty block of
  /// `level`'s kind (a paragraph without one), holding an empty line.
  mutating func createToggle(level: NodeKey?) throws -> (container: NodeKey, titleBlock: NodeKey) {
    var titleBlock = create(SerializedParagraphNode.type)
    if let level, case .heading(let heading) = state[level].payload, let tag = heading.tag {
      titleBlock = createHeading(tag)
    }
    let title = create(SerializedCollapsibleTitleNode.type)
    try append(title, [titleBlock])
    let content = create(SerializedCollapsibleContentNode.type)
    try append(content, [create(SerializedParagraphNode.type)])
    let container = create(SerializedCollapsibleContainerNode.type)
    setToggleOpen(container, false)
    try append(container, [title, content])
    return (container, titleBlock)
  }
  /// `$unwrapToggle`: the toggle's title's block followed by what it held,
  /// in its place.
  mutating func unwrapToggle(_ container: NodeKey) throws -> NodeKey? {
    let block = toggleTitleBlock(container)
    let held = toggleContent(container).map { Array(state.children(of: $0)) } ?? []
    for child in (block.map { [$0] } ?? []) + held { try insert(child, before: container) }
    try remove(container)
    return block
  }
  /// Puts the caret on an empty line at the top of a toggle's content.
  mutating func selectContentStart(_ container: NodeKey) throws {
    guard let content = toggleContent(container) else { return }
    let first = state.firstChild(of: content)
    if let first, state[first].type == SerializedParagraphNode.type, isEmpty(first) {
      select(first)
      return
    }
    let paragraph = create(SerializedParagraphNode.type)
    if let first { try insert(paragraph, before: first) } else { try append(content, [paragraph]) }
    select(paragraph)
  }
}
