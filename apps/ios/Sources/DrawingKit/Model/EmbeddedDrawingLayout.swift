import Foundation

/// How wide an embedded drawing sits in a column `available` points wide, as
/// the web's `drawingStyle` places it.
public enum EmbeddedDrawingLayout {
  /// Placed at a figure width, a drawing fills it. Unplaced, it keeps the
  /// width it was given, or a quarter wider than it exports at, never past the
  /// column. An empty drawing takes the column so that it can be seen and tapped.
  public static func width(figure: String?, requested: Double?, naturalWidth: Double, empty: Bool, available: Double, em: Double) -> Double {
    let column = min(available, EmbeddedDrawingStyle.columnRem * em)
    switch figure {
    case "wide": return min(available, EmbeddedDrawingStyle.wideRem * em)
    case "full": return available
    case .some(let share) where share.hasSuffix("%"):
      guard let percent = Double(share.dropLast()) else { break }
      let least = available <= EmbeddedDrawingStyle.phoneWidth ? available : min(available, EmbeddedDrawingStyle.minimumShareRem * em)
      return min(available, max(column * percent / 100, least))
    default: break
    }
    if empty { return column }
    return min(max(requested ?? naturalWidth * EmbeddedDrawingStyle.naturalScale, 1), column)
  }

  /// The web's empty drawing placeholder is 7rem tall (`h-28`).
  public static func emptyHeight(em: Double) -> Double { 7 * em }
}
