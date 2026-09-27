import LexicalSwift

/// Builders for serialized Lexical nodes, in exactly the shape Lexical writes
/// them, so a generated document loads without being normalized.
public enum LexicalJSON {
  public static func text(_ text: String, format: TextFormat = [], style: String = "") -> JSONValue {
    [
      "detail": 0, "format": .number(Double(format.rawValue)), "mode": "normal", "style": .string(style),
      "text": .string(text), "type": "text", "version": 1,
    ]
  }

  public static let lineBreak: JSONValue = ["type": "linebreak", "version": 1]

  /// Lexical writes a paragraph's text format and style from its first text,
  /// and from what it holds for new text only where it has none.
  public static func paragraph(_ children: [JSONValue], textFormat: TextFormat = [], textStyle: String = "")
    -> JSONValue
  {
    let firstText = children.first { $0["type"] == "text" }
    return [
      "children": .array(children), "direction": nil, "format": "", "indent": 0,
      "textFormat": firstText?["format"] ?? .number(Double(textFormat.rawValue)),
      "textStyle": firstText?["style"] ?? .string(textStyle), "type": "paragraph", "version": 1,
    ]
  }

  public static func heading(_ tag: String, _ children: [JSONValue]) -> JSONValue {
    element("heading", children, ["tag": .string(tag)])
  }

  public static func quote(_ children: [JSONValue]) -> JSONValue {
    element("quote", children)
  }

  public static let horizontalRule: JSONValue = ["type": "horizontalrule", "version": 1]

  public static func element(_ type: String, _ children: [JSONValue], _ fields: JSONObject = [:]) -> JSONValue {
    var node: JSONObject = [
      "children": .array(children), "direction": nil, "format": "", "indent": 0, "type": .string(type), "version": 1,
    ]
    for (key, value) in fields { node[key] = value }
    return .object(node)
  }

  /// A table of one text in a paragraph per cell, by row; the first row is
  /// a header row where `headerRow`.
  public static func table(_ rows: [[String]], headerRow: Bool = false) -> JSONValue {
    element(
      "table",
      rows.enumerated().map { index, row in
        element(
          "tablerow",
          row.map { cell in
            element(
              "tablecell", [paragraph([text(cell)])],
              ["backgroundColor": nil, "colSpan": 1, "headerState": headerRow && index == 0 ? 1 : 0, "rowSpan": 1])
          })
      })
  }

  public static func youtube(_ videoID: String) -> JSONValue {
    ["format": "", "type": "youtube", "version": 1, "videoID": .string(videoID), "width": 0, "height": 0]
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
