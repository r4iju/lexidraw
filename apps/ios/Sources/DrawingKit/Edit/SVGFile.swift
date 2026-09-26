import Foundation

/// An SVG file as `normalizeSVG` leaves it before the web stores it: sized,
/// with a namespace and a viewBox, and written out as Chrome serializes the
/// document, so the same picked file is the same stored bytes on both.
struct NormalizedSVG {
  let data: Data
  /// The size a browser gives the image, in pixels.
  let width: Int
  let height: Int

  init?(_ picked: Data) {
    guard let text = String(data: picked, encoding: .utf8), Self.isWellFormedSVG(picked) else { return nil }
    var scanner = XMLScanner(text)
    var output = ""
    var depth = 0
    var size: (width: Int, height: Int)?
    /// A start tag not yet written, which is written empty when its end
    /// tag comes next, as a serializer writes an element with no children.
    var open: (name: String, attributes: [(String, String)])?
    func flushOpen() {
      guard let tag = open else { return }
      output += XMLScanner.startTag(tag.name, tag.attributes) + ">"
      open = nil
    }
    while let token = scanner.next() {
      switch token {
      case .start(let name, var attributes, let empty):
        if depth == 0 {
          guard output.isEmpty, let sized = Self.normalize(&attributes) else { return nil }
          size = sized
        }
        flushOpen()
        if empty {
          output += XMLScanner.startTag(name, attributes) + "/>"
        } else {
          open = (name, attributes)
          depth += 1
        }
      case .end(let name):
        guard depth > 0 else { return nil }
        if let tag = open, tag.name == name {
          output += XMLScanner.startTag(tag.name, tag.attributes) + "/>"
          open = nil
        } else {
          flushOpen()
          output += "</\(name)>"
        }
        depth -= 1
      case .text(let text):
        guard depth > 0 else { continue }
        flushOpen()
        output += XMLScanner.escapeText(XMLScanner.decode(text))
      case .raw(let raw):
        guard depth > 0 else { continue }
        flushOpen()
        output += raw
      }
      if depth == 0, size != nil { break }
    }
    guard let size, depth == 0 else { return nil }
    data = Data(output.utf8)
    (width, height) = size
  }

  private static let namespace = "http://www.w3.org/2000/svg"
  private static let viewBoxSize = try! NSRegularExpression(pattern: #"\d+ +\d+ +(\d+(?:\.\d+)?) +(\d+(?:\.\d+)?)"#)

  /// `normalizeSVG` on the root's attributes: a set attribute keeps its
  /// place and a new one goes last, as `setAttribute` does. Answers the size
  /// a browser gives the result.
  private static func normalize(_ attributes: inout [(String, String)]) -> (width: Int, height: Int)? {
    func value(_ name: String) -> String? { attributes.first { $0.0 == name }?.1 }
    func set(_ name: String, _ value: String) {
      if let index = attributes.firstIndex(where: { $0.0 == name }) {
        attributes[index].1 = value
      } else {
        attributes.append((name, value))
      }
    }
    if value("xmlns") == nil { set("xmlns", namespace) }
    let unsized = { (length: String?) in length.flatMap { $0.contains("%") || $0 == "auto" ? nil : $0 } }
    var width = unsized(value("width"))
    var height = unsized(value("height"))
    let viewBox = value("viewBox")
    if width == nil || width == "" || height == nil || height == "" {
      width = width.flatMap { $0.isEmpty ? nil : $0 } ?? "50"
      height = height.flatMap { $0.isEmpty ? nil : $0 } ?? "50"
      if let viewBox,
        let match = viewBoxSize.firstMatch(in: viewBox, range: NSRange(viewBox.startIndex..., in: viewBox)),
        let w = Range(match.range(at: 1), in: viewBox), let h = Range(match.range(at: 2), in: viewBox)
      {
        width = String(viewBox[w])
        height = String(viewBox[h])
      }
      set("width", width!)
      set("height", height!)
    }
    if viewBox == nil { set("viewBox", "0 0 \(width!) \(height!)") }
    guard let pixelWidth = pixels(width!), let pixelHeight = pixels(height!) else { return nil }
    return (pixelWidth, pixelHeight)
  }

  /// A CSS length in whole pixels, as a browser sizes an image by it.
  private static func pixels(_ length: String) -> Int? {
    let trimmed = length.trimmingCharacters(in: .whitespaces)
    let number = trimmed.prefix { $0.isNumber || $0 == "." || $0 == "-" || $0 == "+" || $0 == "e" || $0 == "E" }
    guard let value = Double(number) else { return nil }
    let perUnit: [String: Double] = [
      "": 1, "px": 1, "in": 96, "cm": 96 / 2.54, "mm": 96 / 25.4, "q": 96 / 101.6, "pt": 4.0 / 3, "pc": 16,
      "em": 16, "rem": 16,
    ]
    guard let scale = perUnit[trimmed.dropFirst(number.count).lowercased()] else { return nil }
    return Int((value * scale).rounded())
  }

  private static func isWellFormedSVG(_ data: Data) -> Bool {
    final class Root: NSObject, XMLParserDelegate {
      var name: String?
      func parser(
        _ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?,
        attributes: [String: String] = [:]
      ) {
        if self.name == nil { self.name = name }
      }
    }
    let parser = XMLParser(data: data)
    let root = Root()
    parser.delegate = root
    return parser.parse() && root.name == "svg"
  }
}

/// The parts of an XML document, in order, as they are written.
private struct XMLScanner {
  enum Token {
    case start(String, [(String, String)], empty: Bool)
    case end(String)
    case text(String)
    /// A comment, CDATA section or processing instruction, written as is,
    /// or a declaration, which only comes before the root.
    case raw(String)
  }

  private let text: String
  private var at: String.Index

  init(_ text: String) {
    self.text = text
    at = text.startIndex
  }

  mutating func next() -> Token? {
    guard at < text.endIndex else { return nil }
    let rest = text[at...]
    if !rest.hasPrefix("<") {
      let end = rest.firstIndex(of: "<") ?? text.endIndex
      defer { at = end }
      return .text(String(text[at..<end]))
    }
    for (open, close) in [("<!--", "-->"), ("<![CDATA[", "]]>"), ("<?", "?>")] where rest.hasPrefix(open) {
      let end = rest.range(of: close)?.upperBound ?? text.endIndex
      defer { at = end }
      return .raw(String(text[at..<end]))
    }
    if rest.hasPrefix("<!") {
      // A doctype, whose internal subset may hold `>` between brackets.
      var brackets = 0
      var index = rest.index(at, offsetBy: 2)
      while index < text.endIndex {
        let character = text[index]
        if character == "[" { brackets += 1 }
        if character == "]" { brackets -= 1 }
        index = text.index(after: index)
        if character == ">", brackets <= 0 { break }
      }
      defer { at = index }
      return .raw(String(text[at..<index]))
    }
    if rest.hasPrefix("</") {
      let end = rest.firstIndex(of: ">").map(text.index(after:)) ?? text.endIndex
      defer { at = end }
      let name = text[text.index(at, offsetBy: 2)..<end].dropLast().trimmingCharacters(in: .whitespacesAndNewlines)
      return .end(name)
    }
    return startTag()
  }

  private mutating func startTag() -> Token? {
    var index = text.index(after: at)
    func skipSpace() {
      while index < text.endIndex, text[index].isWhitespace { index = text.index(after: index) }
    }
    func name() -> String {
      let start = index
      while index < text.endIndex, !text[index].isWhitespace, !"=/>".contains(text[index]) {
        index = text.index(after: index)
      }
      return String(text[start..<index])
    }
    let tag = name()
    var attributes: [(String, String)] = []
    while true {
      skipSpace()
      guard index < text.endIndex else { return nil }
      if text[index] == ">" {
        at = text.index(after: index)
        return .start(tag, attributes, empty: false)
      }
      if text[index] == "/" {
        index = text.index(after: index)
        skipSpace()
        guard index < text.endIndex, text[index] == ">" else { return nil }
        at = text.index(after: index)
        return .start(tag, attributes, empty: true)
      }
      let attribute = name()
      skipSpace()
      guard index < text.endIndex, text[index] == "=" else { return nil }
      index = text.index(after: index)
      skipSpace()
      guard index < text.endIndex, text[index] == "\"" || text[index] == "'" else { return nil }
      let quote = text[index]
      let start = text.index(after: index)
      guard let end = text[start...].firstIndex(of: quote) else { return nil }
      // A parser reads each whitespace character in a value as a space.
      let value = String(text[start..<end].map { $0.isWhitespace ? " " : $0 })
      attributes.append((attribute, Self.decode(value)))
      index = text.index(after: end)
    }
  }

  static func startTag(_ name: String, _ attributes: [(String, String)]) -> String {
    "<\(name)" + attributes.map { " \($0.0)=\"\(escapeAttribute($0.1))\"" }.joined()
  }

  static func escapeText(_ text: String) -> String {
    text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;")
  }

  static func escapeAttribute(_ value: String) -> String {
    escapeText(value).replacingOccurrences(of: "\"", with: "&quot;")
  }

  /// The text references stand for: the predefined entities and characters.
  static func decode(_ text: String) -> String {
    guard text.contains("&") else { return text }
    var decoded = ""
    var rest = text[...]
    while let ampersand = rest.firstIndex(of: "&") {
      decoded += rest[..<ampersand]
      guard let semicolon = rest[ampersand...].firstIndex(of: ";") else {
        rest = rest[ampersand...]
        break
      }
      let reference = rest[rest.index(after: ampersand)..<semicolon]
      let named = ["lt": "<", "gt": ">", "amp": "&", "quot": "\"", "apos": "'"]
      if let character = named[String(reference)] {
        decoded += character
      } else if reference.hasPrefix("#x"), let code = UInt32(reference.dropFirst(2), radix: 16),
        let scalar = Unicode.Scalar(code)
      {
        decoded.unicodeScalars.append(scalar)
      } else if reference.hasPrefix("#"), let code = UInt32(reference.dropFirst()), let scalar = Unicode.Scalar(code) {
        decoded.unicodeScalars.append(scalar)
      } else {
        decoded += rest[ampersand...semicolon]
      }
      rest = rest[rest.index(after: semicolon)...]
    }
    return decoded + rest
  }
}
