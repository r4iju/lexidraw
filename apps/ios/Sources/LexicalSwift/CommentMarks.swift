/// CommentPlugin's $wrapSelectionInMarkNode, with its mounted nested resolver.
extension Update {
  mutating func annotateComment(_ selection: RangeSelection, id: String) throws {
    let backward = try state.isBackward(selection)
    let start = backward ? selection.focus : selection.anchor
    let end = backward ? selection.anchor : selection.focus
    let forward = RangeSelection(anchor: SelectionPoint(start.key, start.offset, start.type),
      focus: SelectionPoint(end.key, end.offset, end.type), format: [], style: "")
    var parent: NodeKey?, lastMark: NodeKey?
    for node in try extract(forward) {
      if let lastMark, hasAncestor(node, lastMark) { continue }
      let target: NodeKey?
      if state[node].isText { target = node }
      else if state[node].type == SerializedMarkNode.type { continue }
      else if (state[node].isElement || state[node].isDecorator) && state[node].isInline { target = node }
      else { target = nil }
      guard let target else { parent = nil; lastMark = nil; continue }
      if target == parent { continue }
      let nextParent = state.parent(of: target)
      if nextParent == nil || nextParent != parent { lastMark = nil }
      parent = nextParent
      if lastMark == nil {
        let mark = create(SerializedMarkNode.type)
        modify(mark) {
          guard case .mark(var payload) = $0.payload else { return }
          payload.ids = [id]; $0.payload = .mark(payload)
        }
        try insert(mark, before: target)
        lastMark = mark
      }
      try append(lastMark!, [target])
    }
    if let lastMark {
      if backward { selectStart(lastMark) } else { selectEnd(lastMark) }
    }
  }
}

extension Update {
  mutating func saveCommentThread(id: String, thread: JSONValue?) throws {
    let replacement = try thread.map { try CommentThread(json: $0) }
    if let replacement {
      guard replacement.unknownFields.isEmpty, replacement.id != nil, replacement.quote != nil,
        replacement.type == .thread, let comments = replacement.comments, comments.allSatisfy(Node.supportsComment) else {
        throw EditorError.unsupported("Unsupported comment fields (#134)")
      }
    }
    var stack = [EditorState.rootKey], keys: [NodeKey] = []
    while let key = stack.popLast() {
      keys.append(key)
      stack.append(contentsOf: state.children(of: key).reversed())
    }
    for key in keys {
      if replacement == nil, case .comment(let marker) = state[key].payload,
        case .typed(let comment)? = marker.comment, comment.id == id {
        try remove(key)
        continue
      }
      guard case .thread(var marker) = state[key].payload, case .typed(let old)? = marker.thread, old.id == id else { continue }
      if let replacement {
        marker.thread = .typed(replacement)
        modify(key) { $0.payload = .thread(marker) }
      } else { try remove(key) }
    }
  }
}

extension Update {
  mutating func removeCommentAnnotations(id: String) throws {
    var stack = [EditorState.rootKey], keys: [NodeKey] = []
    while let key = stack.popLast() {
      keys.append(key); stack.append(contentsOf: state.children(of: key).reversed())
    }
    for key in keys {
      guard case .mark(var mark) = state[key].payload, var ids = mark.ids,
        let index = ids.firstIndex(of: id) else { continue }
      ids.remove(at: index); mark.ids = ids
      modify(key) { $0.payload = .mark(mark) }
      if ids.isEmpty {
        var target: NodeKey?
        for child in state.children(of: key) {
          if let target { try insert(child, after: target) } else { try insert(child, before: key) }
          target = child
        }
        try remove(key)
      }
    }
  }
}
