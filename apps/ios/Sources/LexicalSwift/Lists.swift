/// Lists, checklists, indenting and Tab, ported from lexical@0.51.0 and
/// `registerDocumentEditing` in @packages/lexical-nodes: @lexical/list's
/// commands and ListItemNode's overrides, rich text's indent handlers and
/// Tab indentation.
extension Update {
  // MARK: Nodes

  func isList(_ key: NodeKey) -> Bool { state[key].type == SerializedListNode.type }

  func isListItem(_ key: NodeKey) -> Bool { state[key].type == SerializedListItemNode.type }

  /// `$createListNode`.
  mutating func createList(_ listType: ListType) -> NodeKey {
    let list = create(SerializedListNode.type)
    if case .list(var payload) = state[list].payload {
      payload.listType = listType
      payload.tag = listType.tag
      state.nodes[list]!.payload = .list(payload)
    }
    return list
  }

  /// Lexical's `$copyNode`: a node like `key` under a new key, in no parent
  /// and without children. A copy of a checked item starts unchecked.
  mutating func copyNode(_ key: NodeKey) -> NodeKey {
    let node = state[key]
    var payload = node.payload
    if case .listItem(var item) = payload, isChecked(key) == true {
      item.checked = false
      payload = .listItem(item)
    }
    return create(payload, type: node.type, children: node.isElement ? [] : nil)
  }

  /// `ListItemNode.getChecked`, which is nil outside a checklist.
  private func isChecked(_ item: NodeKey) -> Bool? {
    guard case .listItem(let payload) = state[item].payload, let list = state.parent(of: item),
      listType(list) == .check
    else { return nil }
    return payload.checked ?? false
  }

  private mutating func modifyList(_ key: NodeKey, _ change: (inout SerializedListNode) -> Void) {
    guard case .list(var list) = state[key].payload else { return }
    change(&list)
    modify(key) { $0.payload = .list(list) }
  }

  /// `getIndent`: a list item's is how deep its list nests.
  func indent(of block: NodeKey) -> Int {
    if isListItem(block), state.isAttached(block) { return state.listItemDepth(block) }
    return state[block].payload.elementFields?.indent ?? 0
  }

  /// `setIndent`: a list item nests or unnests until it's as deep as asked.
  mutating func setIndent(_ block: NodeKey, _ indent: Int) throws {
    guard isListItem(block) else { return modifyElement(block) { $0.indent = indent } }
    var current = self.indent(of: block)
    while current != indent {
      if current < indent {
        try indentListItem(block)
        current += 1
      } else {
        try outdentListItem(block)
        current -= 1
      }
    }
  }

  /// ElementNode's `canIndent`, which a list turns down.
  private func canIndent(_ block: NodeKey) -> Bool { !isList(block) }

  /// `$getListDepth`.
  private func listDepth(_ list: NodeKey) throws -> Int {
    var depth = 1
    var parent = state.parent(of: list)
    while let item = parent, isListItem(item) {
      guard let parentList = state.parent(of: item), isList(parentList) else { throw notInList }
      depth += 1
      parent = state.parent(of: parentList)
    }
    return depth
  }

  /// `$getTopListNode`: the outermost list an item is in.
  private func topList(of item: NodeKey) throws -> NodeKey {
    guard let parentList = state.parent(of: item), isList(parentList) else { throw notInList }
    return parents(of: parentList).last(where: isList) ?? parentList
  }

  private var notInList: EditorError { .invalidState("A ListItemNode must have a ListNode for a parent.") }

  /// `$getAllListItems`: the items holding content, nested ones included.
  private func allListItems(_ list: NodeKey) -> [NodeKey] {
    state.children(of: list).filter(isListItem).flatMap { item in
      state.firstChild(of: item).map { isList($0) ? allListItems($0) : [item] } ?? [item]
    }
  }

  /// `$removeHighestEmptyListParent`.
  private mutating func removeHighestEmptyListParent(_ sublist: NodeKey) throws {
    var empty = sublist
    while state.nextSibling(of: empty) == nil, state.previousSibling(of: empty) == nil,
      let parent = state.parent(of: empty), isListItem(parent) || isList(parent)
    {
      empty = parent
    }
    try remove(empty)
  }

  /// `$isSelectingEmptyListItem`.
  private func isSelectingEmptyListItem(_ anchor: NodeKey, _ nodes: [NodeKey]) -> Bool {
    isListItem(anchor) && (nodes.isEmpty || (nodes == [anchor] && isEmpty(anchor)))
  }

  // MARK: ListItemNode's overrides

  /// `ListItemNode.insertAfter` of anything but a list item, which splits
  /// the list around it.
  mutating func insert(_ node: NodeKey, afterListItem item: NodeKey, restoringSelection: Bool) throws {
    guard let list = state.parent(of: item), isList(list) else {
      throw EditorError.invalidState("insertAfter: list node is not parent of list item node")
    }
    let siblings = nextSiblings(of: item)
    try insert(node, after: list, restoringSelection: restoringSelection)
    guard let first = siblings.first else { return }
    let newList = copyNode(list)
    if listType(newList) == .number, case .listItem(let firstItem) = state[first].payload {
      modifyList(newList) { $0.start = firstItem.value }
    }
    for sibling in siblings { try append(newList, [sibling]) }
    try insert(newList, after: node, restoringSelection: restoringSelection)
  }

  /// `ListItemNode.replace` with anything but a list item, which takes the
  /// item's place out of the list, splitting it where the item was in the
  /// middle, and with `includingChildren` its children after its own.
  mutating func replace(listItem item: NodeKey, with replacement: NodeKey, includingChildren: Bool) throws
    -> NodeKey
  {
    try setIndent(item, 0)
    guard let list = state.parent(of: item), isList(list) else { return replacement }
    if state.firstChild(of: list) == item {
      try insert(replacement, before: list)
    } else if state.lastChild(of: list) == item {
      try insert(replacement, after: list)
    } else {
      let newList = copyNode(list)
      for sibling in nextSiblings(of: item) { try append(newList, [sibling]) }
      try insert(replacement, after: list)
      try insert(newList, after: replacement)
    }
    if includingChildren {
      let sizeBefore = state.childCount(of: replacement)
      try splice(replacement, sizeBefore, deleting: 0, inserting: Array(state.children(of: item)))
      if let selection {
        for point in [selection.anchor, selection.focus] where point.key == item && point.type == .element {
          point.set(replacement, sizeBefore + point.offset, .element)
        }
      }
    }
    try remove(item)
    if isEmpty(list) { try remove(list) }
    return replacement
  }

  /// `ListItemNode.remove`: the nested lists either side of the item join.
  mutating func remove(listItem item: NodeKey, preservingEmptyParent: Bool) throws {
    let previous = state.previousSibling(of: item)
    let next = state.nextSibling(of: item)
    try removeNode(item, restoringSelection: true, preservingEmptyParent: preservingEmptyParent)
    guard let previous, let next, isNestedListItem(previous), isNestedListItem(next) else { return }
    let previousList = state.firstChild(of: previous)!
    let nextList = state.firstChild(of: next)!
    guard listType(previousList) == listType(nextList) else { return }
    try mergeLists(previousList, nextList)
    try remove(next)
  }

  /// `ListItemNode.collapseAtStart`: backspace at an item's start outdents
  /// a nested item, and turns another into a paragraph after its list.
  mutating func collapseListItemAtStart(_ item: NodeKey) throws -> Bool {
    if isNestedListItem(item) { return false }
    guard let list = state.parent(of: item), let listParent = state.parent(of: list) else { throw notInList }
    if isListItem(listParent) {
      try outdentListItem(item)
      return true
    }
    let paragraph = create(SerializedParagraphNode.type)
    try append(paragraph, Array(state.children(of: item)))
    let siblings = nextSiblings(of: item)
    if !siblings.isEmpty {
      let newList = copyNode(list)
      try append(newList, siblings)
      try insert(newList, after: list)
    }
    try insert(paragraph, after: list)
    try remove(item)
    if isEmpty(list) { try remove(list) }
    selectStart(paragraph)
    return true
  }

  // MARK: Nesting

  /// `$handleIndent`: an item nests into the nested list beside it, or into
  /// a new one.
  private mutating func indentListItem(_ item: NodeKey) throws {
    if isNestedListItem(item) { return }
    let parent = state.parent(of: item)
    let next = state.nextSibling(of: item)
    let previous = state.previousSibling(of: item)
    if let next, let previous, isNestedListItem(next), isNestedListItem(previous) {
      let innerList = state.firstChild(of: previous)!
      try append(innerList, [item])
      let nextInnerList = state.firstChild(of: next)!
      if listType(innerList) == listType(nextInnerList) {
        try append(innerList, Array(state.children(of: nextInnerList)))
        try remove(next)
      }
    } else if let next, isNestedListItem(next) {
      if let first = state.firstChild(of: state.firstChild(of: next)!) {
        try insert(item, before: first)
      }
    } else if let previous, isNestedListItem(previous) {
      try append(state.firstChild(of: previous)!, [item])
    } else if let parent, isList(parent) {
      let newItem = copyNode(item)
      let newList = copyNode(parent)
      try append(newItem, [newList])
      try append(newList, [item])
      if let previous {
        try insert(newItem, after: previous)
      } else if let next {
        try insert(newItem, before: next)
      } else {
        try append(parent, [newItem])
      }
    }
  }

  /// `$handleOutdent`: a nested item moves out beside the item its list is
  /// nested in, splitting that list where the item was in the middle.
  private mutating func outdentListItem(_ item: NodeKey) throws {
    if isNestedListItem(item) { return }
    guard let parentList = state.parent(of: item), isList(parentList),
      let grandparent = state.parent(of: parentList), isListItem(grandparent),
      let greatGrandparent = state.parent(of: grandparent), isList(greatGrandparent)
    else { return }
    if state.firstChild(of: parentList) == item {
      try insert(item, before: grandparent)
      if isEmpty(parentList) { try remove(grandparent) }
    } else if state.lastChild(of: parentList) == item {
      try insert(item, after: grandparent)
      if isEmpty(parentList) { try remove(grandparent) }
    } else {
      let previousItem = copyNode(item)
      let previousList = copyNode(parentList)
      try append(previousItem, [previousList])
      for sibling in state.children(of: parentList).prefix(while: { $0 != item }) {
        try append(previousList, [sibling])
      }
      let nextItem = copyNode(item)
      let nextList = copyNode(parentList)
      try append(nextItem, [nextList])
      try append(nextList, nextSiblings(of: item))
      try insert(previousItem, before: grandparent)
      try insert(nextItem, after: grandparent)
      try replace(grandparent, with: item)
    }
  }

  // MARK: Commands

  /// `$insertList`: the selected blocks become items of a list of
  /// `listType`, and the selected lists become lists of it.
  mutating func insertList(_ listType: ListType) throws {
    guard let selection else { return }
    var nodes = try self.nodes(in: selection)
    let anchor = selection.anchor.key
    if state[anchor].isRootOrShadowRoot {
      if let first = state.firstChild(of: anchor) {
        nodes = try self.nodes(in: selectStart(first))
      } else {
        let paragraph = create(SerializedParagraphNode.type)
        try append(anchor, [paragraph])
        nodes = try self.nodes(in: selectElement(paragraph))
      }
    } else if isSelectingEmptyListItem(anchor, nodes) {
      guard let list = state.parent(of: anchor), isList(list) else { preconditionFailure("A list item outside a list") }
      try replaceList(list, listType)
      return
    }
    var handled: Set<NodeKey> = []
    for node in nodes {
      if state[node].isElement, isEmpty(node), !isListItem(node), !handled.contains(node) {
        try createListOrMerge(node, listType)
        continue
      }
      var parent =
        !state[node].isElement ? state.parent(of: node) : isListItem(node) && isEmpty(node) ? node : nil
      while let current = parent {
        if isList(current) {
          if !handled.contains(current) {
            try replaceList(current, listType)
            handled.insert(current)
          }
          break
        }
        let next = state.parent(of: current)
        if let next, state[next].isRootOrShadowRoot, !handled.contains(current) {
          handled.insert(current)
          try createListOrMerge(current, listType)
          break
        }
        parent = next
      }
    }
  }

  /// A list's items move to a copy of it of `listType`, which takes its place.
  private mutating func replaceList(_ list: NodeKey, _ listType: ListType) throws {
    let newList = copyNode(list)
    modifyList(newList) {
      $0.listType = listType
      $0.tag = listType.tag
    }
    try splice(newList, 0, deleting: 0, inserting: Array(state.children(of: list)))
    try replace(list, with: newList)
  }

  /// `$createListOrMerge`: a block becomes an item of a list of `listType`,
  /// joining the lists of that type beside it.
  private mutating func createListOrMerge(_ block: NodeKey, _ listType: ListType) throws {
    if isList(block) { return }
    let previous = state.previousSibling(of: block)
    let next = state.nextSibling(of: block)
    let item = create(SerializedListItemNode.type)
    try splice(item, 0, deleting: 0, inserting: Array(state.children(of: block)))
    let target: NodeKey
    if let previous, self.listType(previous) == listType {
      try append(previous, [item])
      if let next, self.listType(next) == listType {
        try splice(previous, state.childCount(of: previous), deleting: 0, inserting: Array(state.children(of: next)))
        try remove(next)
      }
      target = previous
    } else if let next, self.listType(next) == listType {
      guard let first = state.firstChild(of: next) else { throw EditorError.invalidState("An empty list") }
      try insert(item, before: first)
      target = next
    } else {
      let list = createList(listType)
      try append(list, [item])
      try replace(block, with: list)
      target = list
    }
    let format = state[block].payload.elementFields?.format
    modifyElement(item) { $0.format = format }
    try setIndent(item, indent(of: block))
    if let selection {
      for point in [selection.anchor, selection.focus] where point.key == target {
        point.set(item, point.offset, .element)
      }
    }
    try remove(block)
  }

  /// `$removeList`: the items of the selected lists become paragraphs,
  /// indented as deep as they were nested.
  mutating func removeList() throws {
    guard let selection else { return }
    var lists: [NodeKey] = []
    let nodes = try self.nodes(in: selection)
    let anchor = selection.anchor.key
    if isSelectingEmptyListItem(anchor, nodes) {
      lists.append(try topList(of: anchor))
    } else {
      for node in nodes where !state[node].isElement {
        guard let item = ([node] + parents(of: node)).first(where: isListItem) else { continue }
        let list = try topList(of: item)
        if !lists.contains(list) { lists.append(list) }
      }
    }
    for list in lists {
      var insertionPoint = list
      for item in allListItems(list) {
        let paragraph = create(SerializedParagraphNode.type)
        let itemFields = state[item].payload.elementFields
        let indent = indent(of: item)
        modifyElement(paragraph) {
          $0.takeTextFormatAndStyle(of: selection)
          $0.format = itemFields?.format
          $0.indent = indent
          $0.direction = itemFields?.direction ?? .null
        }
        try splice(paragraph, 0, deleting: 0, inserting: Array(state.children(of: item)))
        try insert(paragraph, after: insertionPoint)
        insertionPoint = paragraph
        for point in [selection.anchor, selection.focus] where point.key == item {
          setPoint(point, from: state.normalize(.child(paragraph, .next)))
        }
        try remove(item)
      }
      try remove(list)
    }
  }

  /// The list's INSERT_PARAGRAPH_COMMAND handler (`$handleListInsertParagraph`),
  /// before rich text's: Enter in an empty item leaves its list, or its
  /// nested list.
  private mutating func insertParagraphLeavingList() throws -> Bool {
    guard let selection, selection.isCollapsed else { return false }
    let anchor = selection.anchor.key
    var emptyItem: NodeKey?
    if isListItem(anchor), isEmpty(anchor) {
      emptyItem = anchor
    } else if state[anchor].isText, let parent = state.parent(of: anchor), isListItem(parent), isBlank(parent) {
      emptyItem = parent
    }
    guard let item = emptyItem else { return false }
    let top = try topList(of: item)
    guard let list = state.parent(of: item), isList(list), let grandparent = state.parent(of: list) else {
      throw notInList
    }
    let replacement: NodeKey
    if state[grandparent].isRootOrShadowRoot {
      replacement = create(SerializedParagraphNode.type)
      try insert(replacement, after: top)
    } else if isListItem(grandparent) {
      replacement = copyNode(grandparent)
      try insert(replacement, after: grandparent)
    } else {
      return false
    }
    try setTextStyle(replacement, selection.style)
    try setTextFormat(replacement, selection.format)
    selectElement(replacement)
    let siblings = nextSiblings(of: item)
    if !siblings.isEmpty {
      let newList = copyNode(list)
      modifyList(newList) { $0.start = 1 }
      if isListItem(replacement) {
        let newItem = copyNode(replacement)
        try append(newItem, [newList])
        try insert(newItem, after: replacement)
      } else {
        try insert(newList, after: replacement)
      }
      try append(newList, siblings)
    }
    try removeHighestEmptyListParent(item)
    return true
  }

  /// INSERT_PARAGRAPH_COMMAND: Enter.
  mutating func insertParagraphCommand(_ selection: RangeSelection) throws {
    if try !insertParagraphLeavingList() { try insertParagraph(selection) }
  }

  /// KEY_BACKSPACE_COMMAND's handlers: the list's, at the start of an item,
  /// then rich text's, which outdents a block the caret is at the front of
  /// and otherwise deletes a character.
  mutating func backspace(_ selection: RangeSelection) throws {
    if try collapseListItemAtStartOfSelection(selection) { return }
    if try isCollapsedAtFrontOfIndentedBlock(selection) { return try outdentContent() }
    try deleteCharacter(selection, backward: true)
  }

  private mutating func collapseListItemAtStartOfSelection(_ selection: RangeSelection) throws -> Bool {
    guard selection.isCollapsed, selection.anchor.offset == 0 else { return false }
    var current = selection.anchor.key
    while !isListItem(current) {
      guard state.previousSibling(of: current) == nil, let parent = state.parent(of: current) else { return false }
      current = parent
    }
    return try collapseListItemAtStart(current)
  }

  /// `$isSelectionCollapsedAtFrontOfIndentedBlock`.
  private func isCollapsedAtFrontOfIndentedBlock(_ selection: RangeSelection) throws -> Bool {
    guard selection.isCollapsed, selection.anchor.offset == 0 else { return false }
    let anchor = selection.anchor.key
    if state[anchor].isRoot { return false }
    let block = try nearestBlockElement(anchor)
    return indent(of: block) > 0 && (block == anchor || anchor == firstDescendant(of: block))
  }

  /// `$getNearestBlockElementAncestorOrThrow`.
  private func nearestBlockElement(_ key: NodeKey) throws -> NodeKey {
    guard let block = findParent(from: key, where: isBlockElement) else {
      throw EditorError.invalidState("Expected node \(key) to have closest block element node.")
    }
    return block
  }

  /// `$isBlockElementNode`.
  private func isBlockElement(_ key: NodeKey) -> Bool { state[key].isElement && !state[key].isInline }

  /// INDENT_CONTENT_COMMAND: nothing past `maxListDepth` levels of list
  /// (`registerListMaxIndentLevel`), and otherwise every selected block one
  /// deeper.
  mutating func indentContent() throws {
    if try isIndentTooDeep() { return }
    _ = try indentSelectedBlocks(outdenting: false)
  }

  /// OUTDENT_CONTENT_COMMAND: every selected block that's indented, one less.
  mutating func outdentContent() throws {
    _ = try indentSelectedBlocks(outdenting: true)
  }

  /// `$handleIndentAndOutdent`, which says whether it found a block to
  /// indent.
  private mutating func indentSelectedBlocks(outdenting: Bool) throws -> Bool {
    guard let selection else { return false }
    var handled: Set<NodeKey> = []
    for node in try nodes(in: selection) where !handled.contains(node) {
      guard let block = findParent(from: node, where: isBlockElement), canIndent(block), !handled.contains(block)
      else { continue }
      handled.insert(block)
      let indent = indent(of: block)
      if !outdenting {
        try setIndent(block, indent + 1)
      } else if indent > 0 {
        try setIndent(block, indent - 1)
      }
    }
    return !handled.isEmpty
  }

  /// How deep lists nest before indenting stops, `MAX_LIST_DEPTH` in
  /// @packages/lexical-nodes.
  private static let maxListDepth = 6

  /// `$isIndentTooDeep` in @packages/lexical-nodes.
  private func isIndentTooDeep() throws -> Bool {
    guard let selection else { return false }
    let nodes = try self.nodes(in: selection)
    let elements = try (nodes.isEmpty ? [selection.anchor.key, selection.focus.key] : nodes).map { node in
      if !nodes.isEmpty, state[node].isElement { return node }
      guard let parent = state.parent(of: node) else {
        throw EditorError.invalidState("Expected node to have a parent")
      }
      return parent
    }
    var depth = 0
    for element in elements {
      if isList(element) {
        depth = max(try listDepth(element) + 1, depth)
      } else if isListItem(element) {
        guard let list = state.parent(of: element), isList(list) else { throw notInList }
        depth = max(try listDepth(list) + 1, depth)
      }
    }
    return depth > Self.maxListDepth
  }

  /// KEY_TAB_COMMAND: rich text's handler drops the case formats the caret
  /// would type in, then Tab indentation's indents on Tab, and outdents on
  /// Shift-Tab, where the selection takes in a block or starts at the start
  /// of one, and otherwise either inserts a tab.
  mutating func tab(_ selection: RangeSelection, backward: Bool) throws {
    for format in [TextFormatType.capitalize, .lowercase, .uppercase] where selection.format.contains(format.format) {
      selection.setFormat(format.toggled(in: selection.format, aligningWith: nil))
    }
    guard try indentsOverTab(selection) else { return try insertTab(selection) }
    if backward {
      try outdentContent()
    } else {
      try indentContent()
    }
  }

  /// `$indentOverTab`.
  private func indentsOverTab(_ selection: RangeSelection) throws -> Bool {
    if try nodes(in: selection).contains(where: { isBlockElement($0) && canIndent($0) }) { return true }
    let first = try state.startEnd(selection).start
    let block = try nearestBlockElement(first.key)
    guard canIndent(block) else { return false }
    let start = RangeSelection(
      anchor: SelectionPoint(block, 0, .element), focus: SelectionPoint(block, 0, .element), format: [], style: "")
    normalizeSelection(start)
    return start.anchor.is(first)
  }

  /// INSERT_TAB_COMMAND: a TabNode, formatted as the selection is.
  private mutating func insertTab(_ selection: RangeSelection) throws {
    let tab = create(SerializedTabNode.type)
    setFormat(tab, selection.format)
    setStyle(tab, selection.style)
    try insertNodes(selection, [tab])
  }

  /// `ListItemNode.toggleChecked`, which a tap on an item's box calls.
  mutating func toggleChecked(at path: [Int]) throws {
    guard let item = state.key(at: path) else { throw EditorError.noNode(path: path) }
    guard case .listItem(var payload) = state[item].payload else { throw EditorError.invalidState("Not a list item") }
    payload.checked = !(payload.checked ?? false)
    modify(item) { $0.payload = .listItem(payload) }
  }

  // MARK: Transforms

  /// The list item transform `registerList` adds: an item's text format and
  /// style are its first text's, or, while it's empty, what the caret in it
  /// types.
  mutating func syncListItemTextStyle(_ item: NodeKey) throws {
    if let first = state.firstChild(of: item) {
      guard state[first].isText else { return }
      let style = style(of: first)
      let format = format(of: first)
      if !textStyle(of: item).isIdentical(to: style) { try setTextStyle(item, style) }
      if textFormat(of: item) != format { try setTextFormat(item, format) }
    } else if let selection,
      !selection.style.isIdentical(to: textStyle(of: item)) || selection.format != textFormat(of: item),
      selection.isCollapsed, selection.anchor.key == item
    {
      try setTextStyle(item, selection.style)
      try setTextFormat(item, selection.format)
    }
  }

  /// The text transform `registerList` adds: an item's text format and style
  /// follow its first text.
  mutating func syncListItem(withFirstText text: NodeKey) throws {
    guard let item = state.parent(of: text), isListItem(item), state.firstChild(of: item) == text else { return }
    let style = style(of: text)
    let format = format(of: text)
    guard !style.isIdentical(to: textStyle(of: item)) || format != textFormat(of: item) else { return }
    try setTextStyle(item, style)
    try setTextFormat(item, format)
  }
}

extension ListType {
  init(_ listType: EditorCommand.ListType) {
    switch listType {
    case .bullet: self = .bullet
    case .number: self = .number
    case .check: self = .check
    }
  }

  /// The tag Lexical gives a list of this type.
  var tag: ListTag { self == .number ? .ol : .ul }
}
