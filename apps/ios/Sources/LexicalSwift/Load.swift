extension Update {
  /// Lexical's `$parseSerializedNode`: each node as its class reads it, put
  /// into its parent through that parent's own `append`.
  mutating func parse(_ json: JSONValue) throws -> NodeKey {
    guard case .object(var fields) = json, let type = fields["type"]?.stringValue else {
      throw EditorError.invalidState("A node without a type")
    }
    guard let traits = NodeTraits.byType[type] else {
      return create(.opaque(json), type: type, children: nil)
    }
    guard traits.kind == .element else {
      return create(SerializedNode(json: json).asLoaded(), type: type, children: nil)
    }
    let children = fields.removeValue(forKey: "children")?.arrayValue ?? []
    let key = create(SerializedNode(json: .object(fields)).asLoaded(), type: type, children: [])
    for child in children {
      try append(key, [parse(child)])
    }
    return key
  }
}
