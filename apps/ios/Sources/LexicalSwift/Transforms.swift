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
}
