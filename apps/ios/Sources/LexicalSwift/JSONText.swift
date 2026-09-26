/// JSON text as JavaScript reads and writes it: `JSON.parse`, keeping each
/// object's key order, and `JSON.stringify`, byte for byte.
extension JSONValue {
  public init(parsing text: String) throws {
    var parser = JSONParser(Array(text.utf8))
    parser.skipWhitespace()
    self = try parser.value()
    parser.skipWhitespace()
    guard parser.isAtEnd else { throw parser.error("Text after the value") }
  }

  public var stringified: String {
    var text = ""
    write(into: &text)
    return text
  }

  private func write(into text: inout String) {
    switch self {
    case .null: text += "null"
    case .bool(let value): text += value ? "true" : "false"
    case .number(let value): text += javaScriptNumber(value)
    case .string(let value): writeString(value, into: &text)
    case .array(let items):
      text += "["
      for (index, item) in items.enumerated() {
        if index > 0 { text += "," }
        item.write(into: &text)
      }
      text += "]"
    case .object(let object):
      text += "{"
      for (index, (key, value)) in object.enumerated() {
        if index > 0 { text += "," }
        writeString(key, into: &text)
        text += ":"
        value.write(into: &text)
      }
      text += "}"
    }
  }
}

public struct JSONParseError: Error, CustomStringConvertible {
  public let description: String
}

/// ECMAScript's Number::toString: the shortest digits that read back as the
/// value, in positional notation from 1e-7 up to 1e21.
private func javaScriptNumber(_ value: Double) -> String {
  guard value.isFinite else { return "null" }
  if value == 0 { return "0" }
  if value < 0 { return "-" + javaScriptNumber(-value) }
  // Swift's description has the same shortest digits, in its own notation.
  let description = value.description
  let parts = description.split(separator: "e")
  let mantissa = parts[0]
  let exponent = parts.count > 1 ? Int(parts[1])! : 0
  let point = mantissa.firstIndex(of: ".").map { mantissa.distance(from: mantissa.startIndex, to: $0) } ?? mantissa.count
  var digits = Array(mantissa.filter { $0 != "." })
  // The value is 0.digits × 10^n.
  var n = point + exponent
  while digits.first == "0" {
    digits.removeFirst()
    n -= 1
  }
  while digits.last == "0" { digits.removeLast() }
  let k = digits.count
  let string = String(digits)
  if k <= n && n <= 21 { return string + String(repeating: "0", count: n - k) }
  if 0 < n && n <= 21 { return String(digits[..<n]) + "." + String(digits[n...]) }
  if -6 < n && n <= 0 { return "0." + String(repeating: "0", count: -n) + string }
  let e = n - 1
  let written = e < 0 ? "e-\(-e)" : "e+\(e)"
  return k == 1 ? string + written : String(digits[0]) + "." + String(digits[1...]) + written
}

private func writeString(_ string: String, into text: inout String) {
  text += "\""
  for scalar in string.unicodeScalars {
    switch scalar {
    case "\"": text += "\\\""
    case "\\": text += "\\\\"
    case "\u{08}": text += "\\b"
    case "\u{0C}": text += "\\f"
    case "\n": text += "\\n"
    case "\r": text += "\\r"
    case "\t": text += "\\t"
    case _ where scalar.value < 0x20:
      let hex = String(scalar.value, radix: 16)
      text += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
    default: text.unicodeScalars.append(scalar)
    }
  }
  text += "\""
}

private struct JSONParser {
  private let bytes: [UInt8]
  private var index = 0

  init(_ bytes: [UInt8]) {
    self.bytes = bytes
  }

  var isAtEnd: Bool { index == bytes.count }

  func error(_ message: String) -> JSONParseError {
    JSONParseError(description: "\(message) at byte \(index)")
  }

  mutating func skipWhitespace() {
    while index < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[index]) { index += 1 }
  }

  mutating func value() throws -> JSONValue {
    guard index < bytes.count else { throw error("No value") }
    switch bytes[index] {
    case UInt8(ascii: "{"): return try object()
    case UInt8(ascii: "["): return try array()
    case UInt8(ascii: "\""): return .string(try string())
    case UInt8(ascii: "t"): return try literal("true", .bool(true))
    case UInt8(ascii: "f"): return try literal("false", .bool(false))
    case UInt8(ascii: "n"): return try literal("null", .null)
    default: return try number()
    }
  }

  private mutating func object() throws -> JSONValue {
    index += 1
    var pairs: [(String, JSONValue)] = []
    skipWhitespace()
    if try consume("}") { return .object(JSONObject(pairs)) }
    repeat {
      skipWhitespace()
      guard index < bytes.count, bytes[index] == UInt8(ascii: "\"") else { throw error("No key") }
      let key = try string()
      skipWhitespace()
      guard try consume(":") else { throw error("No colon") }
      skipWhitespace()
      pairs.append((key, try value()))
      skipWhitespace()
    } while try consume(",")
    guard try consume("}") else { throw error("Unclosed object") }
    return .object(JSONObject(pairs))
  }

  private mutating func array() throws -> JSONValue {
    index += 1
    var items: [JSONValue] = []
    skipWhitespace()
    if try consume("]") { return .array(items) }
    repeat {
      skipWhitespace()
      items.append(try value())
      skipWhitespace()
    } while try consume(",")
    guard try consume("]") else { throw error("Unclosed array") }
    return .array(items)
  }

  private mutating func consume(_ character: Unicode.Scalar) throws -> Bool {
    guard index < bytes.count, bytes[index] == UInt8(ascii: character) else { return false }
    index += 1
    return true
  }

  private mutating func literal(_ word: String, _ value: JSONValue) throws -> JSONValue {
    let word = Array(word.utf8)
    guard bytes.count - index >= word.count, Array(bytes[index..<index + word.count]) == word else {
      throw error("Not a value")
    }
    index += word.count
    return value
  }

  private mutating func number() throws -> JSONValue {
    let start = index
    let digits = UInt8(ascii: "0")...UInt8(ascii: "9")
    func skipDigits() -> Bool {
      let from = index
      while index < bytes.count, digits.contains(bytes[index]) { index += 1 }
      return index > from
    }
    if index < bytes.count, bytes[index] == UInt8(ascii: "-") { index += 1 }
    if index < bytes.count, bytes[index] == UInt8(ascii: "0") {
      index += 1
    } else if !skipDigits() {
      throw error("Not a value")
    }
    if index < bytes.count, bytes[index] == UInt8(ascii: ".") {
      index += 1
      guard skipDigits() else { throw error("No digits after the point") }
    }
    if index < bytes.count, bytes[index] | 0x20 == UInt8(ascii: "e") {
      index += 1
      if index < bytes.count, [UInt8(ascii: "+"), UInt8(ascii: "-")].contains(bytes[index]) { index += 1 }
      guard skipDigits() else { throw error("No digits in the exponent") }
    }
    guard let value = Double(String(decoding: bytes[start..<index], as: UTF8.self)) else {
      throw error("Not a number")
    }
    return .number(value)
  }

  /// A string's UTF-16 code units, where a lone surrogate, which a Swift
  /// string can't hold, reads as U+FFFD as it does in Swift.
  private mutating func string() throws -> String {
    index += 1
    var units: [UInt16] = []
    while true {
      guard index < bytes.count else { throw error("Unclosed string") }
      let byte = bytes[index]
      switch byte {
      case UInt8(ascii: "\""):
        index += 1
        return String(decoding: units, as: UTF16.self)
      case UInt8(ascii: "\\"):
        guard index + 1 < bytes.count else { throw error("Unclosed string") }
        let escaped = bytes[index + 1]
        index += 2
        switch escaped {
        case UInt8(ascii: "\""): units.append(0x22)
        case UInt8(ascii: "\\"): units.append(0x5C)
        case UInt8(ascii: "/"): units.append(0x2F)
        case UInt8(ascii: "b"): units.append(0x08)
        case UInt8(ascii: "f"): units.append(0x0C)
        case UInt8(ascii: "n"): units.append(0x0A)
        case UInt8(ascii: "r"): units.append(0x0D)
        case UInt8(ascii: "t"): units.append(0x09)
        case UInt8(ascii: "u"):
          guard bytes.count - index >= 4,
            let unit = UInt16(String(decoding: bytes[index..<index + 4], as: UTF8.self), radix: 16)
          else { throw error("Not a \\u escape") }
          units.append(unit)
          index += 4
        default: throw error("Not an escape")
        }
      case 0..<0x20:
        throw error("A control character in a string")
      default:
        // A run of UTF-8 up to the next quote or escape.
        let start = index
        while index < bytes.count, bytes[index] != UInt8(ascii: "\""), bytes[index] != UInt8(ascii: "\\"),
          bytes[index] >= 0x20
        {
          index += 1
        }
        units.append(contentsOf: String(decoding: bytes[start..<index], as: UTF8.self).utf16)
      }
    }
  }
}
