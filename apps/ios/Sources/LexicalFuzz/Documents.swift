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

  public static func tab(format: TextFormat = [], style: String = "") -> JSONValue {
    [
      "detail": 2, "format": .number(Double(format.rawValue)), "mode": "normal", "style": .string(style),
      "text": "\t", "type": "tab", "version": 1,
    ]
  }

  /// Lexical writes a paragraph's text format and style from its first text,
  /// a tab included, and from what it holds for new text only where it has
  /// none.
  public static func paragraph(
    _ children: [JSONValue], textFormat: TextFormat = [], textStyle: String = "", indent: Int = 0
  ) -> JSONValue {
    let firstText = children.first { $0["type"] == "text" || $0["type"] == "tab" }
    return [
      "children": .array(children), "direction": nil, "format": "", "indent": .number(Double(indent)),
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

  /// What a list holds: an item of inline content, or a list nested in an
  /// item of its own.
  public enum ListEntry {
    case item([JSONValue], checked: Bool = false)
    case nested(ListType, [ListEntry], start: Int = 1, marker: ListMarker? = nil)
  }

  /// A list of `entries`, each item numbered, indented to its depth and, in
  /// a checklist, checked or not, as Lexical writes it: an item holding a
  /// nested list is unchecked.
  public static func list(_ listType: ListType, _ entries: [ListEntry], start: Int = 1, marker: ListMarker? = nil)
    -> JSONValue
  {
    list(listType, entries, start: start, marker: marker, depth: 0)
  }

  private static func list(_ listType: ListType, _ entries: [ListEntry], start: Int, marker: ListMarker?, depth: Int)
    -> JSONValue
  {
    var value = start
    let items = entries.map { entry -> JSONValue in
      var fields: JSONObject = ["indent": .number(Double(depth)), "value": .number(Double(value))]
      let children: [JSONValue]
      switch entry {
      case .item(let content, let checked):
        children = content
        if listType == .check { fields["checked"] = .bool(checked) }
        value += 1
      case .nested(let type, let entries, let start, let marker):
        children = [list(type, entries, start: start, marker: marker, depth: depth + 1)]
        if listType == .check { fields["checked"] = false }
      }
      return element("listitem", children, fields)
    }
    let tag = listType == .number ? "ol" : "ul"
    var fields: JSONObject = [
      "listType": .string(listType.rawValue), "start": .number(Double(start)), "tag": .string(tag),
    ]
    if let marker, marker != .default { fields["$"] = ["mdListMarker": .string(marker.rawValue)] }
    return element("list", items, fields)
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

  /// The types of every node in a serialized editor state.
  var nodeTypes: Set<String> {
    Set(nodePaths().compactMap { node(at: $0)?["type"]?.stringValue })
  }

  func node(at path: [Int]) -> JSONValue? {
    path.reduce(self["root"]) { node, index in
      node?["children"]?.arrayValue.flatMap { $0.indices.contains(index) ? $0[index] : nil }
    }
  }
}
