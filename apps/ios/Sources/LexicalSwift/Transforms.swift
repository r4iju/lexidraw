import Foundation

/// Lexidraw's named transforms (`namedTransform` in @packages/lexical-nodes),
/// which the node schema can name but not describe: each keeps a value,
/// rewrites it, or turns it down as absent, as its TypeScript namesake does.
enum Transforms {
  /// `parseFigureWidth`: the wide or full column, or a share of the text
  /// column from 10% up to but not including 100%.
  static func figureWidth(_ value: String) -> String? {
    if value == "wide" || value == "full" { return value }
    guard let share = value.wholeMatch(of: #/([0-9]{1,3})%/#).flatMap({ Int($0.1) }), share >= 10, share < 100
    else { return nil }
    return "\(share)%"
  }

  /// `parseNaturalSize`: both sides more than nothing, and finite.
  static func naturalSize(_ value: NaturalSize) -> NaturalSize? {
    guard let width = value.width, let height = value.height, width > 0, height > 0, (width * height).isFinite
    else { return nil }
    return value
  }

  /// `storedSize`: a size that's no size at all, or `inherit`, is 0.
  static func storedSize(_ value: JSONValue) -> JSONValue? {
    !value.isTruthy || value == "inherit" ? 0 : value
  }

  /// `zeroAsInherit`: 0 is `inherit`.
  static func zeroAsInherit(_ value: JSONValue) -> JSONValue? {
    value == 0 ? "inherit" : value
  }

  /// `falseOrStored`: `value || false`.
  static func falseOrStored(_ value: JSONValue) -> JSONValue? {
    value.isTruthy ? value : false
  }

  /// `emptyOrStored`: `value || ""`.
  static func emptyOrStored(_ value: JSONValue) -> JSONValue? {
    value.isTruthy ? value : ""
  }

  /// `stringAbsent`: a string that isn't a name TextNode knows is absent.
  static func stringAbsent(_ value: JSONValue) -> JSONValue? {
    if value.stringValue != nil { return .none }
    return value
  }

  /// `emptyAbsent`: an empty string is absent.
  static func emptyAbsent(_ value: String) -> String? {
    value.isEmpty ? nil : value
  }

  /// `nestedEditorState`: a state with something in its root, parsed first
  /// where it was stored as JSON text, or the empty editor's.
  static func nestedEditorState(_ value: JSONValue) -> JSONValue? {
    let state = value.stringValue.flatMap { try? JSONValue(parsing: $0) } ?? value
    if holdsNodes(state) { return state }
    return ["root": ["children": [], "direction": nil, "format": "", "indent": 0, "type": "root", "version": 1]]
  }

  /// `holdsNodes`: an editor state with something in its root.
  private static func holdsNodes(_ state: JSONValue) -> Bool {
    if case .array(let children)? = state["root"]?["children"] { return !children.isEmpty }
    return false
  }

  /// `videoCaption`: a caption with something in its root, or the empty
  /// paragraph a video starts with.
  static func videoCaption(_ value: JSONValue) -> JSONValue? {
    if holdsNodes(value) { return value }
    return [
      "root": [
        "children": [
          [
            "children": [], "direction": nil, "format": "", "indent": 0, "textFormat": 0, "textStyle": "",
            "type": "paragraph", "version": 1,
          ]
        ],
        "direction": nil, "format": "", "indent": 0, "type": "root", "version": 1,
      ]
    ]
  }
}
