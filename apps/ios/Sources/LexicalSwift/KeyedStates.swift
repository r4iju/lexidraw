/// Slide boxes store the web editor's keyed JSON. Keys are live editor identity,
/// never schema fields: loading strips them and saving adds the model's keys.
/// Other node fields, including opaque payloads, cross unchanged.
extension Editor {
  public func loadKeyed(_ json: JSONValue) throws {
    guard let root = json["root"] else { throw EditorError.invalidState("No keyed root") }
    try load(["root": try keyedTree(root, liveKeys: false)])
  }

  public func serializedKeyedState() throws -> JSONValue {
    ["root": try keyedTree(serializedState()["root"] ?? .null, liveKeys: true)]
  }

  private func keyedTree(_ root: JSONValue, liveKeys: Bool) throws -> JSONValue {
    struct Frame {
      var fields: JSONObject
      var children: [JSONValue]?
      var built: [JSONValue] = []
      var path: [Int]
    }
    func frame(_ value: JSONValue, at path: [Int]) throws -> Frame {
      guard var fields = value.objectValue else { throw EditorError.invalidState("A keyed node must be an object") }
      fields["key"] = nil
      if liveKeys {
        let key: String
        if path.isEmpty {
          key = "root"
        } else {
          let keys = try childKeys(at: Array(path.dropLast()))
          guard let index = path.last, keys.indices.contains(index) else {
            throw EditorError.invalidState("A keyed node disappeared")
          }
          key = keys[index]
        }
        fields["key"] = .string(key)
      }
      return Frame(fields: fields, children: fields["children"]?.arrayValue, path: path)
    }
    var stack = [try frame(root, at: [])]
    while var current = stack.popLast() {
      if let children = current.children, current.built.count < children.count {
        let index = current.built.count
        stack.append(current)
        stack.append(try frame(children[index], at: current.path + [index]))
      } else {
        if current.children != nil { current.fields["children"] = .array(current.built) }
        let value = JSONValue.object(current.fields)
        guard !stack.isEmpty else { return value }
        stack[stack.count - 1].built.append(value)
      }
    }
    throw EditorError.invalidState("No keyed root")
  }
}
