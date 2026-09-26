import Foundation

/// The web's `charWidth`: each character wrapping has measured, per font,
/// kept under its first UTF-16 unit as the web keeps it. The widest of them
/// is how narrow a label's shape may get, so that depends on what has been
/// wrapped so far, as it does on the web.
final class CharacterWidths {
  let measurer: TextMeasuring
  private var widths: [String: [UInt16: Double]] = [:]

  init(_ measurer: TextMeasuring) { self.measurer = measurer }

  func line(_ text: String, font: String) -> Double { measurer.width(of: text, font: font) }

  func character(_ character: String, font: String) -> Double {
    let unit = character.utf16.first ?? 0
    if let width = widths[font]?[unit], width != 0 { return width }
    let width = measurer.width(of: character, font: font)
    widths[font, default: [:]][unit] = width
    return width
  }

  /// `getApproxMinLineWidth`, less the padding: the widest character
  /// measured, or before there is one, the widest of A-Z and 0-9.
  func widest(font: String) -> Double {
    if let widest = widths[font]?.values.max(), widest != 0 { return widest }
    return "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".map { line(String($0), font: font) }.max() ?? 0
  }
}

/// Excalidraw's `textWrapping.ts`: text wrapped to a width at the same
/// places the web wraps it, so a label keeps its lines on either side.
enum TextWrapping {
  private static let whitespace = #"\s"#
  private static let hyphen = #"\-"#
  private static let opening = #"<\(\[\{"#
  private static let closing = #">\)\]\}.,:;!\?…/"#
  private static let cjk =
    #"\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}｀＇＾〃〰〆＃＆＊＋－ー／＼＝｜￤〒￢￣"#
  private static let cjkOpening = "（［｛〈《｟｢「『【〖〔〘〚＜〝"
  private static let cjkClosing = "）］｝〉》｠｣」』】〗〕〙〛＞。．，、〟‥？！：；・〜〞"
  private static let currency = "￥￦￡￠＄"

  private static let emojiSource: String = {
    let flag = #"\p{Regional_Indicator}\p{Regional_Indicator}"#
    let joiner = #"(?:\p{Emoji_Modifier}|\x{FE0F}\x{20E3}?|[\x{E0020}-\x{E007E}]+\x{E007F})?"#
    let most = #"[\p{Extended_Pictographic}\p{Emoji_Presentation}]"#
    let any = #"[\p{Emoji}]"#
    return "(\(flag)|\(most)\(joiner)(?:\\x{200D}(?:\(flag)|\(any)\(joiner)))*)"
  }()

  private static let emoji = try! NSRegularExpression(pattern: emojiSource)

  /// `getLineBreakRegexAdvanced`: an emoji, kept whole, or a place between
  /// two characters where a line may break.
  private static let lineBreak = try! NSRegularExpression(
    pattern: [
      emojiSource,
      "(?=[\(whitespace)])",
      "(?<=[\(whitespace)\(hyphen)])",
      "(?<![\(opening)\(cjkOpening)])(?=[\(cjk)\(currency)])",
      "(?<=[\(cjk)])(?![\(hyphen)\(closing)\(cjkClosing)])",
      "(?<![\(opening)])(?<![\(cjkOpening)])(?=[\(cjkOpening)])",
      "(?<=[\(cjkClosing)])(?![\(cjkClosing)])(?![\(closing)])",
      "(?<=[\(closing)])(?![\(closing)])(?=[\(opening)])",
    ].joined(separator: "|"))

  /// `parseTokens`: the line split as JavaScript's `split` splits it by the
  /// line-break expression, keeping the emoji it captures.
  static func tokens(_ line: String) -> [String] {
    let text = line.precomposedStringWithCanonicalMapping as NSString
    let length = text.length
    var tokens: [String] = []
    var start = 0
    var position = 0
    while position < length {
      let match = lineBreak.firstMatch(
        in: text as String, options: [.anchored, .withTransparentBounds, .withoutAnchoringBounds],
        range: NSRange(location: position, length: length - position))
      guard let match, match.range.upperBound != start else {
        let pair =
          position + 1 < length && UTF16.isLeadSurrogate(text.character(at: position))
          && UTF16.isTrailSurrogate(text.character(at: position + 1))
        position += pair ? 2 : 1
        continue
      }
      tokens.append(text.substring(with: NSRange(location: start, length: position - start)))
      if match.range(at: 1).location != NSNotFound {
        tokens.append(text.substring(with: match.range(at: 1)))
      }
      start = match.range.upperBound
      position = start
    }
    tokens.append(text.substring(from: start))
    return tokens.filter { !$0.isEmpty }
  }

  /// `wrapText`: each line longer than `maxWidth` broken into lines that fit.
  static func wrap(_ text: String, font: String, maxWidth: Double, widths: CharacterWidths) -> String {
    guard maxWidth.isFinite, maxWidth >= 0 else { return text }
    var lines: [String] = []
    for line in text.components(separatedBy: "\n") {
      if widths.line(line, font: font) <= maxWidth {
        lines.append(line)
      } else {
        lines += wrapLine(line, font: font, maxWidth: maxWidth, widths: widths)
      }
    }
    return lines.joined(separator: "\n")
  }

  private static func isWhitespace(_ token: String) -> Bool {
    token.range(of: #"\s"#, options: .regularExpression) != nil
  }

  private static func wrapLine(_ line: String, font: String, maxWidth: Double, widths: CharacterWidths)
    -> [String]
  {
    var lines: [String] = []
    var current = ""
    var currentWidth = 0.0
    var tokens = tokens(line)[...]
    while let token = tokens.first {
      let test = current + token
      let testWidth =
        token.utf16.count == 1
        ? currentWidth + widths.character(token, font: font) : widths.line(test, font: font)
      if isWhitespace(token) || testWidth <= maxWidth {
        current = test
        currentWidth = testWidth
        tokens.removeFirst()
        continue
      }
      if current.isEmpty {
        let wrapped = wrapWord(token, font: font, maxWidth: maxWidth, widths: widths)
        lines += wrapped.dropLast()
        current = wrapped.last ?? ""
        currentWidth = widths.line(current, font: font)
        tokens.removeFirst()
      } else {
        lines.append(trimmingEnd(current))
        current = ""
        currentWidth = 0
      }
    }
    if !current.isEmpty { lines.append(trimLine(current, font: font, maxWidth: maxWidth, widths: widths)) }
    return lines
  }

  /// `wrapWord`: a word too wide for a line, broken between characters,
  /// unless it is an emoji.
  private static func wrapWord(_ word: String, font: String, maxWidth: Double, widths: CharacterWidths)
    -> [String]
  {
    let whole = NSRange(location: 0, length: (word as NSString).length)
    if emoji.firstMatch(in: word, range: whole) != nil { return [word] }
    var lines: [String] = []
    var current = ""
    var currentWidth = 0.0
    for scalar in word.unicodeScalars {
      let character = String(scalar)
      let width = widths.character(character, font: font)
      if currentWidth + width <= maxWidth {
        current += character
        currentWidth += width
        continue
      }
      if !current.isEmpty { lines.append(current) }
      current = character
      currentWidth = width
    }
    if !current.isEmpty { lines.append(current) }
    return lines
  }

  private static func trimmingEnd(_ line: String) -> String {
    var line = Substring(line)
    while let last = line.last, last.isWhitespace { line.removeLast() }
    return String(line)
  }

  /// `trimLine`: the last line's trailing spaces, as many as fit.
  private static func trimLine(_ line: String, font: String, maxWidth: Double, widths: CharacterWidths)
    -> String
  {
    guard widths.line(line, font: font) > maxWidth else { return line }
    // As `/^(.+?)(\s+)$/` splits it: at least one character kept.
    let scalars = Array(line.unicodeScalars)
    var cut = scalars.count
    while cut > 1, scalars[cut - 1].properties.isWhitespace { cut -= 1 }
    var trimmed = String(String.UnicodeScalarView(scalars[..<cut]))
    var width = widths.line(trimmed, font: font)
    for space in scalars[cut...] {
      let next = width + widths.character(String(space), font: font)
      if next > maxWidth { break }
      trimmed.unicodeScalars.append(space)
      width = next
    }
    return trimmed
  }
}
