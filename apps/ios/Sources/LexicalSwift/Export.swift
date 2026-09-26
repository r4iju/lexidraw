extension EditorState {
  /// A node as Lexical's `exportJSON` writes it, children included.
  func json(of key: NodeKey) -> JSONValue {
    let node = self[key]
    guard case .object(var fields) = node.payload.json else { return node.payload.json }
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
        fields["tag"] = .string(list.listType == .number ? ListTag.ol.rawValue : ListTag.ul.rawValue)
      default: break
      }
    }
    if let children = node.children {
      fields["children"] = .array(children.map(json(of:)))
    }
    guard let payload = node.payload.payload else { return .object(fields) }
    return .object(fields.ordered(by: type(of: payload).keyOrder))
  }

  /// An element's text format and style are what new text in it takes. A
  /// paragraph writes its first text's, where it has one, as that text holds
  /// them, and leaves out any the text doesn't hold; another block writes
  /// them only where it has no text to take them from.
  private func writeTextStyles(of node: Node, into fields: inout JSONObject) {
    let firstText = node.children?.lazy.map { self[$0] }.first(where: \.isText)?.payload.json
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
  private func listItemDepth(_ key: NodeKey) -> Int {
    var depth = 0
    var ancestor = parent(of: key).flatMap(parent(of:))
    while let item = ancestor, self[item].type == SerializedListItemNode.type {
      ancestor = parent(of: item).flatMap(parent(of:))
      depth += 1
    }
    return depth
  }
}
