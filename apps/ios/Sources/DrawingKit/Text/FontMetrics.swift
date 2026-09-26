import Foundation

/// Excalidraw's `FONT_METADATA`: the metrics text is placed with, which are
/// the font files' own, so text sits where the web puts it.
enum FontMetrics {
  struct Metrics {
    var name: String
    var unitsPerEm: Double
    var ascender: Double
    var descender: Double
    var lineHeight: Double
  }

  static let families: [Double: Metrics] = [
    1: Metrics(name: "Virgil", unitsPerEm: 1000, ascender: 886, descender: -374, lineHeight: 1.25),
    2: Metrics(name: "Helvetica", unitsPerEm: 2048, ascender: 1577, descender: -471, lineHeight: 1.15),
    3: Metrics(name: "Cascadia", unitsPerEm: 2048, ascender: 1900, descender: -480, lineHeight: 1.2),
    5: Metrics(name: "Excalifont", unitsPerEm: 1000, ascender: 886, descender: -374, lineHeight: 1.25),
    6: Metrics(name: "Nunito", unitsPerEm: 1000, ascender: 1011, descender: -353, lineHeight: 1.35),
    7: Metrics(name: "Lilita One", unitsPerEm: 1000, ascender: 923, descender: -220, lineHeight: 1.15),
    8: Metrics(name: "Comic Shanns", unitsPerEm: 1000, ascender: 750, descender: -250, lineHeight: 1.25),
    9: Metrics(
      name: "Liberation Sans", unitsPerEm: 2048, ascender: 1854, descender: -434, lineHeight: 1.15),
  ]

  static func familyNumber(named name: String) -> Double {
    families.first { $0.value.name == name }?.key ?? 5
  }

  static func lineHeight(forFamily family: Double) -> Double {
    (families[family] ?? families[5]!).lineHeight
  }

  /// `getVerticalOffset`: from a line's top to its baseline.
  static func verticalOffset(family: Double, fontSize: Double, lineHeightPx: Double) -> Double {
    let metrics = families[family] ?? families[1]!
    let em = fontSize / metrics.unitsPerEm
    let lineGap = (lineHeightPx - em * metrics.ascender + em * metrics.descender) / 2
    return em * metrics.ascender + lineGap
  }

  /// `getFontString`.
  static func fontString(size: Double, family: Double) -> String {
    guard let metrics = families[family] else { return "\(jsNumberString(size))px Segoe UI Emoji" }
    let fallbacks = family == 5 ? ", Xiaolai, Segoe UI Emoji" : ", Segoe UI Emoji"
    return "\(jsNumberString(size))px \(metrics.name)\(fallbacks)"
  }
}
