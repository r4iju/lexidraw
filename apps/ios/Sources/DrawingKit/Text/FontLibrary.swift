import CoreText
import Foundation

/// The Excalidraw fonts bundled from the web app's font sync, turned into
/// CoreText fonts for CSS font strings such as
/// `20px Excalifont, Xiaolai, Segoe UI Emoji`.
public final class FontLibrary: TextMeasuring, @unchecked Sendable {
  public static let shared = FontLibrary()

  /// Each family's faces. The web splits a family into faces by Unicode
  /// range and picks one per character; a cascade does the same here.
  private let faces: [String: [CTFontDescriptor]]
  private let lock = NSLock()
  private var fonts: [String: CTFont] = [:]

  private init() {
    struct Manifest: Decodable { var families: [String: [String]] }
    let directory = Bundle.module.url(forResource: "Fonts", withExtension: nil)!
    let manifest = try! JSONDecoder().decode(
      Manifest.self, from: Data(contentsOf: directory.appending(path: "manifest.json")))
    faces = manifest.families.mapValues { files in
      files.compactMap { file -> CTFontDescriptor? in
        guard let data = try? Data(contentsOf: directory.appending(path: file)) else { return nil }
        return (CTFontManagerCreateFontDescriptorsFromData(data as CFData) as? [CTFontDescriptor])?
          .first
      }
    }
  }

  /// The font a CSS font string names: its size, and the first family in its
  /// list that is bundled, or else Helvetica as the web's sans-serif.
  public func font(_ css: String) -> CTFont {
    lock.lock()
    defer { lock.unlock() }
    if let font = fonts[css] { return font }
    let (size, families) = parse(css)
    let font: CTFont
    if let family = families.first(where: { faces[$0]?.isEmpty == false }), let list = faces[family] {
      let descriptor = CTFontDescriptorCreateCopyWithAttributes(
        list[0], [kCTFontCascadeListAttribute: Array(list.dropFirst())] as CFDictionary)
      font = CTFontCreateWithFontDescriptor(descriptor, size, nil)
    } else {
      font = CTFontCreateWithName("Helvetica" as CFString, size, nil)
    }
    fonts[css] = font
    return font
  }

  private func parse(_ css: String) -> (CGFloat, [String]) {
    guard let px = css.range(of: "px ") else { return (10, []) }
    let size = Double(css[..<px.lowerBound]) ?? 10
    let families = css[px.upperBound...].split(separator: ",").map {
      $0.trimmingCharacters(in: CharacterSet.whitespaces.union(CharacterSet(charactersIn: "\"'")))
    }
    return (CGFloat(size), families)
  }

  /// The text laid out in pieces, each with where it starts. The web shapes
  /// every word and every space on its own, so no kerning crosses a space;
  /// laying the whole line out at once would kern a space against the next
  /// letter.
  public func pieces(_ text: String, font css: String, color: CGColor? = nil)
    -> [(line: CTLine, x: Double)]
  {
    var attributes: [NSAttributedString.Key: Any] = [
      NSAttributedString.Key(kCTFontAttributeName as String): font(css)
    ]
    if let color {
      attributes[NSAttributedString.Key(kCTForegroundColorAttributeName as String)] = color
    }
    var result: [(CTLine, Double)] = []
    var x = 0.0
    for word in words(text) {
      let line = CTLineCreateWithAttributedString(
        NSAttributedString(string: String(word), attributes: attributes))
      result.append((line, x))
      x += CTLineGetTypographicBounds(line, nil, nil, nil)
    }
    return result
  }

  private func words(_ text: String) -> [Substring] {
    var words: [Substring] = []
    var start = text.startIndex
    for index in text.indices where text[index] == " " {
      if start < index { words.append(text[start..<index]) }
      words.append(text[index...index])
      start = text.index(after: index)
    }
    if start < text.endIndex { words.append(text[start...]) }
    return words
  }

  public func width(of text: String, font css: String) -> Double {
    pieces(text, font: css).reduce(0) { $0 + CTLineGetTypographicBounds($1.line, nil, nil, nil) }
  }
}
