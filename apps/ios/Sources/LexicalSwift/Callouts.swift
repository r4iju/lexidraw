/// CalloutPlugin's handlers for a callout's edges, and the callout helpers of
/// @packages/lexical-nodes they and the markdown shortcuts use.
extension Update {
  /// CalloutPlugin's DELETE_CHARACTER_COMMAND handler: a selection across a
  /// callout's edge, else Backspace or Delete at one.
  mutating func calloutDelete(_ selection: RangeSelection, backward: Bool) throws -> Bool {
    if try removeAcrossCallouts(selection) { return true }
    guard selection.isCollapsed else { return false }
    return try backward ? calloutBackspace(selection) : calloutForwardDelete(selection)
  }

  /// CalloutPlugin's REMOVE_TEXT, CONTROLLED_TEXT_INSERTION and CUT
  /// handlers, which remove a selection across a callout's edge first.
  mutating func structuralRemoveText(_ selection: RangeSelection) throws -> Bool {
    try hasEditorPlugin("CalloutPlugin") && removeAcrossCallouts(selection)
  }

  /// `$backspace`: at the very start of a callout it turns it back into its
  /// blocks; at the start of a line just after one it joins the line onto
  /// the callout's last.
  private mutating func calloutBackspace(_ selection: RangeSelection) throws -> Bool {
    if let callout = calloutOf(selection.anchor.key), atStart(selection, callout) {
      try unwrapCallout(callout)
      return true
    }
    guard let block = topBlock(of: selection.anchor.key), isTextBlock(block), !isEmpty(block),
      let previous = state.previousSibling(of: block), isCallout(previous), atStart(selection, block)
    else { return false }
    if let last = state.lastChild(of: previous), isTextBlock(last) {
      try joinBlocks(last, block)
    } else {
      try append(previous, [block])
    }
    return true
  }

  /// `$forwardDelete`: at the end of a line just before a callout it pulls
  /// the callout's first line up; at the end of a callout's last line it
  /// pulls the next line in.
  private mutating func calloutForwardDelete(_ selection: RangeSelection) throws -> Bool {
    guard let block = topBlock(of: selection.anchor.key), isTextBlock(block), !isEmpty(block),
      atEnd(selection, block)
    else { return false }
    if let next = state.nextSibling(of: block), isCallout(next) {
      guard let first = state.firstChild(of: next), isTextBlock(first) else { return false }
      try joinBlocks(block, first)
      if state.isAttached(next), isEmpty(next) { try remove(next) }
      return true
    }
    guard let callout = state.parent(of: block), isCallout(callout), state.nextSibling(of: block) == nil,
      let after = state.nextSibling(of: callout), isTextBlock(after), !isEmpty(after)
    else { return false }
    try joinBlocks(block, after)
    return true
  }

  /// `$removeAcrossCallouts`: removing a selection that crosses a callout's
  /// edge joins the two lines left over, and a callout left empty goes.
  private mutating func removeAcrossCallouts(_ selection: RangeSelection) throws -> Bool {
    // Asked first, as asking the selection its direction caches it.
    guard !selection.isCollapsed, calloutOf(selection.anchor.key) != calloutOf(selection.focus.key) else { return false }
    let (start, end) = try state.isBackward(selection)
      ? (selection.focus.key, selection.anchor.key) : (selection.anchor.key, selection.focus.key)
    let startBlock = topBlock(of: start)
    let endBlock = topBlock(of: end)
    try removeText(selection)
    if let startBlock, let endBlock, isTextBlock(startBlock), isTextBlock(endBlock), state.isAttached(startBlock),
      state.isAttached(endBlock), startBlock != endBlock
    {
      let parent = state.parent(of: endBlock)
      try append(startBlock, Array(state.children(of: endBlock)))
      try remove(endBlock)
      if let parent, isCallout(parent), state.isAttached(parent), isEmpty(parent) { try remove(parent) }
    }
    return true
  }

  /// `$replaceWithCallout`: a typed shortcut's callout, of the kind `marker`
  /// names, in place of `block`, its first line holding `children`.
  mutating func replaceWithCallout(_ block: NodeKey, _ children: [NodeKey], marker: String, title: String) throws {
    let (kind, title) = Self.resolveCallout(marker, title)
    let line = create(SerializedParagraphNode.type)
    try append(line, children)
    let callout = create(SerializedCalloutNode.type)
    modify(callout) { node in
      guard case .callout(var value) = node.payload else { return }
      value.kind = kind
      value.title = title
      node.payload = .callout(value)
    }
    try append(callout, [line])
    try replace(block, with: callout)
    selectStart(line)
  }

  /// `resolveCallout`: the kind a marker names and the title it carries. A
  /// word that is not one of the five kinds titles the callout itself when
  /// no title was given.
  static func resolveCallout(_ marker: String, _ title: String) -> (CalloutKind, String) {
    let word = marker.lowercased()
    let kind = MarkdownTransformer.calloutAliases[word] ?? .note
    if CalloutKind(rawValue: word) != nil || !title.isEmpty { return (kind, title) }
    return (kind, word.prefix(1).uppercased() + word.dropFirst())
  }

  private func isCallout(_ key: NodeKey) -> Bool { state[key].type == SerializedCalloutNode.type }
  /// `$calloutOf`: the innermost callout holding `key`.
  private func calloutOf(_ key: NodeKey) -> NodeKey? { findParent(from: key, where: isCallout) }
  /// `$topBlockOf`: the nearest under a root or shadow root.
  private func topBlock(of key: NodeKey) -> NodeKey? {
    findParent(from: key) { state.parent(of: $0).map { state[$0].isRootOrShadowRoot } == true }
  }
  /// `$isTextBlock`: a paragraph, heading or quote.
  private func isTextBlock(_ key: NodeKey) -> Bool {
    [SerializedParagraphNode.type, SerializedHeadingNode.type, SerializedQuoteNode.type].contains(state[key].type)
  }
  /// `$joinBlocks`: `from`'s content onto the end of `onto`, the caret where
  /// they meet.
  private mutating func joinBlocks(_ onto: NodeKey, _ from: NodeKey) throws {
    selectEnd(onto)
    try append(onto, Array(state.children(of: from)))
    try remove(from)
  }
  /// `$unwrapCallout`: the callout's blocks in its place.
  private mutating func unwrapCallout(_ callout: NodeKey) throws {
    for child in state.children(of: callout) { try insert(child, before: callout) }
    try remove(callout)
  }
}
