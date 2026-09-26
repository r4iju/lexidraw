import LexicalSwift

/// Builders for serialized Lexical nodes, in exactly the shape Lexical writes
/// them, so a generated document loads without being normalized.
public enum LexicalJSON {
  public static func text(_ text: String, format: Int = 0) -> JSONValue {
    [
      "detail": 0, "format": .number(Double(format)), "mode": "normal", "style": "",
      "text": .string(text), "type": "text", "version": 1,
    ]
  }

  /// Lexical gives a loaded paragraph the format of its first text.
  public static func paragraph(_ children: [JSONValue]) -> JSONValue {
    let textFormat = children.first?["format"]?.intValue ?? 0
    return [
      "children": .array(children), "direction": nil, "format": "", "indent": 0,
      "textFormat": .number(Double(textFormat)), "textStyle": "", "type": "paragraph", "version": 1,
    ]
  }

  public static func document(_ children: [JSONValue]) -> JSONValue {
    [
      "root": [
        "children": .array(children), "direction": nil, "format": "", "indent": 0,
        "type": "root", "version": 1,
      ]
    ]
  }
}

extension JSONValue {
  /// This value with the node at `path` (child indexes from the root) replaced
  /// by `transform`'s result, or removed when it returns nil. The value must be
  /// a serialized editor state.
  func updatingNode(at path: [Int], _ transform: (JSONValue) -> JSONValue?) -> JSONValue {
    guard case .object(var state) = self, let root = state["root"] else { return self }
    state["root"] = root.updatingDescendant(at: path[...], transform) ?? root
    return .object(state)
  }

  private func updatingDescendant(at path: ArraySlice<Int>, _ transform: (JSONValue) -> JSONValue?)
    -> JSONValue?
  {
    guard let index = path.first else { return transform(self) }
    guard case .object(var node) = self, var children = node["children"]?.arrayValue,
      children.indices.contains(index)
    else { return self }
    if let child = children[index].updatingDescendant(at: path.dropFirst(), transform) {
      children[index] = child
    } else {
      children.remove(at: index)
    }
    node["children"] = .array(children)
    return .object(node)
  }

  /// Paths of every node in a serialized editor state, depth first.
  func nodePaths() -> [[Int]] {
    func walk(_ node: JSONValue, _ path: [Int]) -> [[Int]] {
      let children = node["children"]?.arrayValue ?? []
      return [path] + children.indices.flatMap { walk(children[$0], path + [$0]) }
    }
    return self["root"].map { walk($0, []) } ?? []
  }

  func node(at path: [Int]) -> JSONValue? {
    path.reduce(self["root"]) { node, index in
      node?["children"]?.arrayValue.flatMap { $0.indices.contains(index) ? $0[index] : nil }
    }
  }
}
