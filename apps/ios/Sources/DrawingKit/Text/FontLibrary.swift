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

  /// The width as Chromium's canvas measures it: HarfBuzz positions in
  /// 16.16 fixed point, each glyph's advance truncated from Skia's 32-bit
  /// float and each font-table adjustment scaled from font units, added up
  /// as 32-bit floats. Text measured here then has the width the web gave
  /// it, to the bit, so measuring it again changes nothing.
  public func width(of text: String, font css: String) -> Double {
    var width: Float = 0
    for piece in pieces(text, font: css) {
      for run in CTLineGetGlyphRuns(piece.line) as? [CTRun] ?? [] {
        let count = CTRunGetGlyphCount(run)
        guard count > 0,
          let runFont = (CTRunGetAttributes(run) as NSDictionary)[kCTFontAttributeName]
        else { continue }
        let font = runFont as! CTFont
        var glyphs = [CGGlyph](repeating: 0, count: count)
        var advances = [CGSize](repeating: .zero, count: count)
        var natural = [CGSize](repeating: .zero, count: count)
        CTRunGetGlyphs(run, CFRange(), &glyphs)
        CTRunGetAdvances(run, CFRange(), &advances)
        CTFontGetAdvancesForGlyphs(font, .horizontal, glyphs, &natural, count)
        let size = Double(CTFontGetSize(font))
        let unitsPerEm = Int64(CTFontGetUnitsPerEm(font))
        let multiplier = (Int64(Float(size) * 65536) << 16) / unitsPerEm
        for index in 0..<count {
          let advance = Int64(Float(natural[index].width) * 65536)
          let units = Int64(
            ((advances[index].width - natural[index].width) * Double(unitsPerEm) / size).rounded())
          let adjustment = (units * multiplier + 32768) >> 16
          width += Float(advance + adjustment) / 65536
        }
      }
    }
    return Double(width)
  }
}
