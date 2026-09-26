import Foundation

/// A CSS colour, parsed as a canvas parses `fillStyle` and `strokeStyle`.
/// Components are 0…1 and not premultiplied.
public struct CSSColor: Equatable, Hashable, Sendable {
  public var red: Double
  public var green: Double
  public var blue: Double
  public var alpha: Double

  public static let black = CSSColor(red: 0, green: 0, blue: 0, alpha: 1)

  public init(red: Double, green: Double, blue: Double, alpha: Double) {
    (self.red, self.green, self.blue, self.alpha) = (red, green, blue, alpha)
  }

  public init?(_ string: String) {
    let value = string.trimmingCharacters(in: .whitespaces).lowercased()
    if value.hasPrefix("#") {
      guard let color = CSSColor(hex: String(value.dropFirst())) else { return nil }
      self = color
    } else if value == "transparent" {
      self = CSSColor(red: 0, green: 0, blue: 0, alpha: 0)
    } else if let hex = namedColors[value] {
      self = CSSColor(hex: hex)!
    } else if let color = CSSColor(function: value) {
      self = color
    } else {
      return nil
    }
  }

  private init?(hex: String) {
    let digits = hex.compactMap { $0.hexDigitValue }
    guard digits.count == hex.count else { return nil }
    func pair(_ index: Int) -> Double { Double(digits[index] * 16 + digits[index + 1]) / 255 }
    func single(_ index: Int) -> Double { Double(digits[index] * 17) / 255 }
    switch digits.count {
    case 3: self.init(red: single(0), green: single(1), blue: single(2), alpha: 1)
    case 4: self.init(red: single(0), green: single(1), blue: single(2), alpha: single(3))
    case 6: self.init(red: pair(0), green: pair(2), blue: pair(4), alpha: 1)
    case 8: self.init(red: pair(0), green: pair(2), blue: pair(4), alpha: pair(6))
    default: return nil
    }
  }

  private init?(function value: String) {
    guard let open = value.firstIndex(of: "("), value.hasSuffix(")") else { return nil }
    let name = value[..<open].trimmingCharacters(in: .whitespaces)
    let body = value[value.index(after: open)..<value.index(before: value.endIndex)]
    let parts = body.replacingOccurrences(of: "/", with: " ").split(whereSeparator: {
      $0 == "," || $0 == " "
    }).map(String.init)
    guard parts.count == 3 || parts.count == 4 else { return nil }
    func number(_ text: String, percentOf scale: Double) -> Double? {
      if text.hasSuffix("%") { return Double(text.dropLast()).map { $0 / 100 * scale } }
      return Double(text)
    }
    let alpha = parts.count == 4 ? number(parts[3], percentOf: 1) : 1
    switch name {
    case "rgb", "rgba":
      guard let r = number(parts[0], percentOf: 255), let g = number(parts[1], percentOf: 255),
        let b = number(parts[2], percentOf: 255), let alpha
      else { return nil }
      self.init(
        red: min(max(r, 0), 255) / 255, green: min(max(g, 0), 255) / 255,
        blue: min(max(b, 0), 255) / 255, alpha: min(max(alpha, 0), 1))
    case "hsl", "hsla":
      guard let h = Double(parts[0].replacingOccurrences(of: "deg", with: "")),
        let s = number(parts[1], percentOf: 1), let l = number(parts[2], percentOf: 1), let alpha
      else { return nil }
      let hue = (h.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360) / 360
      let saturation = min(max(s, 0), 1)
      let lightness = min(max(l, 0), 1)
      let q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
      let p = 2 * lightness - q
      func channel(_ t: Double) -> Double {
        var t = t
        if t < 0 { t += 1 }
        if t > 1 { t -= 1 }
        if t < 1 / 6 { return p + (q - p) * 6 * t }
        if t < 1 / 2 { return q }
        if t < 2 / 3 { return p + (q - p) * (2 / 3 - t) * 6 }
        return p
      }
      self.init(
        red: channel(hue + 1 / 3), green: channel(hue), blue: channel(hue - 1 / 3),
        alpha: min(max(alpha, 0), 1))
    default: return nil
    }
  }

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

private let namedColors: [String: String] = [
  "aliceblue": "f0f8ff", "antiquewhite": "faebd7", "aqua": "00ffff", "aquamarine": "7fffd4",
  "azure": "f0ffff", "beige": "f5f5dc", "bisque": "ffe4c4", "black": "000000",
  "blanchedalmond": "ffebcd", "blue": "0000ff", "blueviolet": "8a2be2", "brown": "a52a2a",
  "burlywood": "deb887", "cadetblue": "5f9ea0", "chartreuse": "7fff00", "chocolate": "d2691e",
  "coral": "ff7f50", "cornflowerblue": "6495ed", "cornsilk": "fff8dc", "crimson": "dc143c",
  "cyan": "00ffff", "darkblue": "00008b", "darkcyan": "008b8b", "darkgoldenrod": "b8860b",
  "darkgray": "a9a9a9", "darkgreen": "006400", "darkgrey": "a9a9a9", "darkkhaki": "bdb76b",
  "darkmagenta": "8b008b", "darkolivegreen": "556b2f", "darkorange": "ff8c00",
  "darkorchid": "9932cc", "darkred": "8b0000", "darksalmon": "e9967a", "darkseagreen": "8fbc8f",
  "darkslateblue": "483d8b", "darkslategray": "2f4f4f", "darkslategrey": "2f4f4f",
  "darkturquoise": "00ced1", "darkviolet": "9400d3", "deeppink": "ff1493",
  "deepskyblue": "00bfff", "dimgray": "696969", "dimgrey": "696969", "dodgerblue": "1e90ff",
  "firebrick": "b22222", "floralwhite": "fffaf0", "forestgreen": "228b22", "fuchsia": "ff00ff",
  "gainsboro": "dcdcdc", "ghostwhite": "f8f8ff", "gold": "ffd700", "goldenrod": "daa520",
  "gray": "808080", "green": "008000", "greenyellow": "adff2f", "grey": "808080",
  "honeydew": "f0fff0", "hotpink": "ff69b4", "indianred": "cd5c5c", "indigo": "4b0082",
  "ivory": "fffff0", "khaki": "f0e68c", "lavender": "e6e6fa", "lavenderblush": "fff0f5",
  "lawngreen": "7cfc00", "lemonchiffon": "fffacd", "lightblue": "add8e6", "lightcoral": "f08080",
  "lightcyan": "e0ffff", "lightgoldenrodyellow": "fafad2", "lightgray": "d3d3d3",
  "lightgreen": "90ee90", "lightgrey": "d3d3d3", "lightpink": "ffb6c1", "lightsalmon": "ffa07a",
  "lightseagreen": "20b2aa", "lightskyblue": "87cefa", "lightslategray": "778899",
  "lightslategrey": "778899", "lightsteelblue": "b0c4de", "lightyellow": "ffffe0",
  "lime": "00ff00", "limegreen": "32cd32", "linen": "faf0e6", "magenta": "ff00ff",
  "maroon": "800000", "mediumaquamarine": "66cdaa", "mediumblue": "0000cd",
  "mediumorchid": "ba55d3", "mediumpurple": "9370db", "mediumseagreen": "3cb371",
  "mediumslateblue": "7b68ee", "mediumspringgreen": "00fa9a", "mediumturquoise": "48d1cc",
  "mediumvioletred": "c71585", "midnightblue": "191970", "mintcream": "f5fffa",
  "mistyrose": "ffe4e1", "moccasin": "ffe4b5", "navajowhite": "ffdead", "navy": "000080",
  "oldlace": "fdf5e6", "olive": "808000", "olivedrab": "6b8e23", "orange": "ffa500",
  "orangered": "ff4500", "orchid": "da70d6", "palegoldenrod": "eee8aa", "palegreen": "98fb98",
  "paleturquoise": "afeeee", "palevioletred": "db7093", "papayawhip": "ffefd5",
  "peachpuff": "ffdab9", "peru": "cd853f", "pink": "ffc0cb", "plum": "dda0dd",
  "powderblue": "b0e0e6", "purple": "800080", "rebeccapurple": "663399", "red": "ff0000",
  "rosybrown": "bc8f8f", "royalblue": "4169e1", "saddlebrown": "8b4513", "salmon": "fa8072",
  "sandybrown": "f4a460", "seagreen": "2e8b57", "seashell": "fff5ee", "sienna": "a0522d",
  "silver": "c0c0c0", "skyblue": "87ceeb", "slateblue": "6a5acd", "slategray": "708090",
  "slategrey": "708090", "snow": "fffafa", "springgreen": "00ff7f", "steelblue": "4682b4",
  "tan": "d2b48c", "teal": "008080", "thistle": "d8bfd8", "tomato": "ff6347",
  "turquoise": "40e0d0", "violet": "ee82ee", "wheat": "f5deb3", "white": "ffffff",
  "whitesmoke": "f5f5f5", "yellow": "ffff00", "yellowgreen": "9acd32",
]
