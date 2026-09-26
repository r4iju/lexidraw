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

  /// `zeroAsInheritValue`: 0 is `inherit`.
  static func zeroAsInherit(_ value: Dimension) -> Dimension? {
    value == .number(0) ? .inherit : value
  }

  /// A video's caption: one with something in its root, or the empty
  /// paragraph a video starts with.
  static func videoCaption(_ value: JSONValue) -> JSONValue? {
    if case .array(let children)? = value["root"]?["children"], !children.isEmpty { return value }
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
