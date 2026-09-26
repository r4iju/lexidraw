/// A JSON value, as Lexical serializes documents. Objects compare by value,
/// not key order, and strings by code unit.
public enum JSONValue: Hashable, Sendable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  public subscript(key: String) -> JSONValue? {
    if case .object(let object) = self { object[key] } else { nil }
  }

  public var stringValue: String? {
    if case .string(let value) = self { value } else { nil }
  }

  public var intValue: Int? {
    if case .number(let value) = self, let int = Int(exactly: value) { int } else { nil }
  }

  public var arrayValue: [JSONValue]? {
    if case .array(let value) = self { value } else { nil }
  }
}

extension JSONValue {
  public static func == (lhs: JSONValue, rhs: JSONValue) -> Bool {
    switch (lhs, rhs) {
    case (.null, .null): true
    case (.bool(let a), .bool(let b)): a == b
    case (.number(let a), .number(let b)): a == b
    case (.string(let a), .string(let b)): a.isIdentical(to: b)
    case (.array(let a), .array(let b)): a == b
    case (.object(let a), .object(let b)): a == b
    default: false
    }
  }

  public func hash(into hasher: inout Hasher) {
    switch self {
    case .null: hasher.combine(0)
    case .bool(let value): hasher.combine(value)
    case .number(let value): hasher.combine(value)
    case .string(let value): hasher.combine(Array(value.utf16))
    case .array(let value): hasher.combine(value)
    case .object(let value): hasher.combine(value)
    }
  }
}

extension String {
  /// JavaScript's `===`. Swift's `==` holds canonically equivalent strings
  /// equal, but Lexical keeps text as typed, so "é" typed over "e\u{301}"
  /// is a change.
  func isIdentical(to other: String) -> Bool {
    utf16.elementsEqual(other.utf16)
  }
}

extension JSONValue: Codable {
  public init(from decoder: any Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else {
      self = .object(try container.decode([String: JSONValue].self))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .null: try container.encodeNil()
    case .bool(let value): try container.encode(value)
    case .number(let value):
      // JavaScript writes integral numbers without a fraction.
      if let int = Int(exactly: value) {
        try container.encode(int)
      } else {
        try container.encode(value)
      }
    case .string(let value): try container.encode(value)
    case .array(let value): try container.encode(value)
    case .object(let value): try container.encode(value)
    }
  }
}

extension JSONValue: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral,
  ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral, ExpressibleByStringLiteral,
  ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral
{
  public init(nilLiteral: ()) { self = .null }
  public init(booleanLiteral value: Bool) { self = .bool(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(floatLiteral value: Double) { self = .number(value) }
  public init(stringLiteral value: String) { self = .string(value) }
  public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
  public init(dictionaryLiteral elements: (String, JSONValue)...) {
    self = .object(Dictionary(uniqueKeysWithValues: elements))
  }
}
