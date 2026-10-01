extension Update {
  /// Lexical's `$parseSerializedNode`: each node as its class reads it, put
  /// into its parent through that parent's own `append`.
  mutating func parse(_ json: JSONValue) throws -> NodeKey {
    guard case .object(var fields) = json, let type = fields["type"]?.stringValue else {
      throw EditorError.invalidState("A node without a type")
    }
    if let registered = editorContext.registeredTypes, !registered.contains(type) {
      throw EditorError.invalidState("Node type \(type) is not registered in \(editorContext.rawValue)")
    }
    guard let traits = NodeTraits.byType[type] else {
      return create(.opaque(json.withoutKeys), type: type, children: nil)
    }
    fields["key"] = nil  // As `withoutKeys` drops it.
    guard traits.kind == .element else {
      return create(SerializedNode(json: .object(fields)).asLoaded(), type: type, children: nil)
    }
    let children = fields.removeValue(forKey: "children")?.arrayValue ?? []
    let key = create(SerializedNode(json: .object(fields)).asLoaded(), type: type, children: [])
    let parsed = try children.map { try parse($0) }
    try append(key, parsed)
    return key
  }
}

extension JSONValue {
  /// The node and its children without the editor key the web's empty
  /// document stores on each node: `importJSON` never reads it and
  /// `exportJSON` never writes it.
  fileprivate var withoutKeys: JSONValue {
    guard case .object(var fields) = self else { return self }
    fields["key"] = nil
    if let children = fields["children"]?.arrayValue { fields["children"] = .array(children.map(\.withoutKeys)) }
    return .object(fields)
  }
}
