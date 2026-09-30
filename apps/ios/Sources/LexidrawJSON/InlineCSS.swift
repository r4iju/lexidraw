import Foundation
import OrderedCollections

/// Lexical's getStyleObjectFromCSS: declarations retain source order and
/// quoted strings, comments and function arguments do not split declarations.
public struct InlineCSS: Sendable {
  private var properties: OrderedDictionary<String, String> = [:]

  public init(_ css: String) {
    let units = Array(css.utf16)
    var property: [UInt16] = [], value: [UInt16] = []
    var quote: UInt16?, comment = false, escaped = false, parsingValue = false, depth = 0
    var index = 0
    func trimmed(_ units: [UInt16]) -> String {
      let whitespace: Set<UInt16> = [9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279]
      var start = 0, end = units.count
      while start < end && whitespace.contains(units[start]) { start += 1 }
      while end > start && whitespace.contains(units[end - 1]) { end -= 1 }
      return String(decoding: units[start..<end], as: UTF16.self)
    }
    func finish() {
      let name = trimmed(property), text = trimmed(value)
      if !name.isEmpty && !text.isEmpty { properties[name] = text }
      property.removeAll(keepingCapacity: true)
      value.removeAll(keepingCapacity: true)
      parsingValue = false
    }
    while index < units.count {
      let unit = units[index]
      defer { index += 1 }
      if comment {
        if unit == 42 && index + 1 < units.count && units[index + 1] == 47 { comment = false; index += 1 }
        continue
      }
      if escaped { escaped = false }
      else if let current = quote {
        if unit == 92 { escaped = true }
        else if unit == current { quote = nil }
      } else if unit == 47 && index + 1 < units.count && units[index + 1] == 42 {
        comment = true; index += 1; continue
      } else if unit == 34 || unit == 39 { quote = unit }
      else if unit == 40 { depth += 1 }
      else if unit == 41 { depth = max(depth - 1, 0) }
      else if unit == 58 && !parsingValue && depth == 0 { parsingValue = true; continue }
      else if unit == 59 && depth == 0 { finish(); continue }
      if parsingValue { value.append(unit) } else { property.append(unit) }
    }
    finish()
  }

  public subscript(_ property: String) -> String? {
    get { properties[property] }
    set { properties[property] = newValue }
  }

  public var serialized: String {
    // JavaScript object enumeration emits array-index keys before other keys.
    let numeric = properties.keys.compactMap { key -> (String, UInt32)? in
      guard let index = UInt32(key), index != UInt32.max, String(index) == key else { return nil }
      return (key, index)
    }.sorted { $0.1 < $1.1 }.map(\.0)
    let indexed = Set(numeric)
    return (numeric + properties.keys.filter { !indexed.contains($0) }).map { "\($0): \(properties[$0]!);" }.joined()
  }
}
