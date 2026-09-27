import CSSValues
import Foundation

extension CSSColor {
  /// How a canvas reads the colour back: `#rrggbb`, or `rgba(…)` when not opaque.
  public var serialized: String {
    let r = Int((red * 255).rounded())
    let g = Int((green * 255).rounded())
    let b = Int((blue * 255).rounded())
    if alpha >= 1 { return String(format: "#%02x%02x%02x", r, g, b) }
    return "rgba(\(r), \(g), \(b), \(jsNumberString((alpha * 1000).rounded() / 1000)))"
  }
}

/// Excalidraw's `isTransparent`.
func isTransparentColor(_ color: String) -> Bool {
  let characters = Array(color)
  if characters.count == 5 && characters[4] == "0" { return true }
  if characters.count == 9 && characters[7] == "0" && characters[8] == "0" { return true }
  return color == "transparent"
}
