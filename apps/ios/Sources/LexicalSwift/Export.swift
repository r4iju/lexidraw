import OrderedCollections

extension EditorState {
  /// A node as Lexical's `exportJSON` writes it, children included unless
  /// left out, as a copy leaves out those not selected.
  func json(of key: NodeKey, includingChildren: Bool = true, canonicalKeyOrder: Bool = true,
    resolve: ((NodeKey, JSONValue) -> JSONValue)? = nil) -> JSONValue {
    guard includingChildren, let children = self[key].children, !children.isEmpty else {
      let value = json(of: key, children: self[key].children == nil ? nil : [], canonicalKeyOrder: canonicalKeyOrder)
      return resolve?(key, value) ?? value
    }
    var stack = [ExportFrame(key: key, children: children)]
    while !stack.isEmpty {
      if let child = stack[stack.count - 1].iterator.next() {
        if let children = self[child].children, !children.isEmpty {
          stack.append(ExportFrame(key: child, children: children))
        } else {
          let value = json(of: child, children: self[child].children == nil ? nil : [], canonicalKeyOrder: canonicalKeyOrder)
          stack[stack.count - 1].exported.append(resolve?(child, value) ?? value)
        }
      } else {
        let frame = stack.removeLast()
        let exported = json(of: frame.key, children: frame.exported, canonicalKeyOrder: canonicalKeyOrder)
        let value = resolve?(frame.key, exported) ?? exported
        if stack.isEmpty { return value }
        stack[stack.count - 1].exported.append(value)
      }
    }
    preconditionFailure("An export always has a root")
  }

  private struct ExportFrame {
    let key: NodeKey
    var iterator: IndexingIterator<OrderedSet<NodeKey>>
    var exported: [JSONValue] = []

    init(key: NodeKey, children: OrderedSet<NodeKey>) {
      self.key = key
      iterator = children.makeIterator()
      exported.reserveCapacity(children.count)
    }
  }

  private func json(of key: NodeKey, children: [JSONValue]?, canonicalKeyOrder: Bool) -> JSONValue {
    let node = self[key]
    let serialized = canonicalKeyOrder ? node.payload.json : node.payload.jsonForPresentation
    guard case .object(var fields) = serialized else { return serialized }
    if let payload = node.payload.payload {
      fields["version"] = .number(Double(type(of: payload).version))
      if node.isElement { writeTextStyles(of: node, into: &fields) }
      switch node.payload {
      case .listItem:
        fields["indent"] = .number(Double(listItemDepth(key)))
        if case .list(let list)? = node.parent.map({ self[$0].payload }), list.listType == .check {
          fields["checked"] = .bool(fields["checked"] == .bool(true))
        } else {
          fields["checked"] = nil
        }
      case .list(let list):
        fields["tag"] = .string((list.listType?.tag ?? .ul).rawValue)
      default: break
      }
    }
    if let children { fields["children"] = .array(children) }
    guard canonicalKeyOrder, let payload = node.payload.payload else { return .object(fields) }
    return .object(fields.ordered(by: type(of: payload).keyOrder))
  }

  /// An element's text format and style are what new text in it takes. A
  /// paragraph writes its first text's, where it has one, as that text holds
  /// them, and leaves out any the text doesn't hold; another block writes
  /// them only where it has no text to take them from.
  private func writeTextStyles(of node: Node, into fields: inout JSONObject) {
    let firstText = node.children?.lazy.map { self[$0] }.first(where: \.isText)?.payload.jsonForPresentation
    if node.type == "paragraph" {
      if let firstText {
        fields["textFormat"] = firstText["format"]
        fields["textStyle"] = firstText["style"]
      }
      return
    }
    let serializes = !node.isRootOrShadowRoot && firstText == nil
    if !serializes || fields["textFormat"] == 0 { fields["textFormat"] = nil }
    if !serializes || fields["textStyle"] == "" { fields["textStyle"] = nil }
  }

  /// A list item's indent is how deep its list nests in other list items.
  func listItemDepth(_ key: NodeKey) -> Int {
    var depth = 0
    var ancestor = parent(of: key).flatMap(parent(of:))
    while let item = ancestor, self[item].type == SerializedListItemNode.type {
      ancestor = parent(of: item).flatMap(parent(of:))
      depth += 1
    }
    return depth
  }
}
