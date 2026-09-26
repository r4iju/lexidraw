/// How one property of a node's JSON is read and written: the Swift side of a
/// field type in the node schema.
struct FieldSchema<Value: Equatable & Sendable>: Sendable {
  /// What an absent or out-of-domain value reads as; nil where that's absence.
  let defaultValue: Value?
  /// Reads a stored value; nil where it reads as absent.
  let read: @Sendable (JSONValue) -> Value?
  let write: @Sendable (Value) -> JSONValue
}

extension FieldSchema where Value == String {
  static func string(default defaultValue: String) -> Self {
    Self(defaultValue: defaultValue, read: { $0.stringValue ?? defaultValue }, write: { .string($0) })
  }
}

extension FieldSchema where Value == Bool {
  static func boolean(default defaultValue: Bool) -> Self {
    Self(
      defaultValue: defaultValue,
      read: { if case .bool(let value) = $0 { value } else { defaultValue } },
      write: { .bool($0) })
  }
}

extension FieldSchema where Value == Double {
  static func number(default defaultValue: Double, min: Double? = nil, max: Double? = nil, clamp: Bool = false)
    -> Self
  {
    Self(
      defaultValue: defaultValue,
      read: { readNumber($0, default: defaultValue, min: min, max: max, integer: false, clamp: clamp) },
      write: { .number($0) })
  }
}

extension FieldSchema where Value == Int {
  static func integer(default defaultValue: Int, min: Int? = nil, max: Int? = nil, clamp: Bool = false) -> Self {
    Self(
      defaultValue: defaultValue,
      read: {
        Int(
          exactly: readNumber(
            $0, default: Double(defaultValue), min: min.map(Double.init), max: max.map(Double.init),
            integer: true, clamp: clamp)) ?? defaultValue
      },
      write: { .number(Double($0)) })
  }
}

/// Lexical's `numberValue`: a finite number, or a string spelled as a JSON
/// number, inside the bounds or brought to the nearer one by `clamp`.
private func readNumber(
  _ json: JSONValue, default defaultValue: Double, min: Double?, max: Double?, integer: Bool, clamp: Bool
) -> Double {
  let number: Double? =
    switch json {
    case .number(let value): value
    case .string(let value) where value.wholeMatch(of: #/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/#) != nil:
      Double(value)
    default: nil
    }
  guard let number, number.isFinite, !integer || number.rounded() == number else { return defaultValue }
  if clamp { return Swift.min(Swift.max(number, min ?? -.infinity), max ?? .infinity) }
  return (min.map { number >= $0 } ?? true) && (max.map { number <= $0 } ?? true) ? number : defaultValue
}

/// A generated enum, or an optional one where JSON `null` is a member.
protocol JSONEnumeration: Equatable, Sendable {
  init?(enumerationJSON json: JSONValue)
  var enumerationJSON: JSONValue { get }
}

extension JSONEnumeration where Self: RawRepresentable, RawValue == String {
  init?(enumerationJSON json: JSONValue) {
    guard let raw = json.stringValue else { return nil }
    self.init(rawValue: raw)
  }

  var enumerationJSON: JSONValue { .string(rawValue) }
}

extension Optional: JSONEnumeration where Wrapped: JSONEnumeration {
  init?(enumerationJSON json: JSONValue) {
    if json == .null {
      self = .none
    } else if let value = Wrapped(enumerationJSON: json) {
      self = .some(value)
    } else {
      return nil
    }
  }

  var enumerationJSON: JSONValue { map(\.enumerationJSON) ?? .null }
}

extension FieldSchema where Value: JSONEnumeration {
  /// A nil `defaultValue` is absence; `E?.none` is JSON `null`.
  static func enumeration(default defaultValue: Value?) -> Self {
    Self(
      defaultValue: defaultValue,
      read: { Value(enumerationJSON: $0) ?? defaultValue },
      write: { $0.enumerationJSON })
  }
}

extension FieldSchema {
  static func nullable<Inner>(_ inner: FieldSchema<Inner>, defaultAsNull: Bool = false) -> Self
  where Value == Inner? {
    Self(
      defaultValue: .some(nil),
      read: { json in
        guard json != .null, let value = inner.read(json) else { return json == .null ? .some(nil) : nil }
        return defaultAsNull && value == inner.defaultValue ? .some(nil) : .some(value)
      },
      write: { $0.map(inner.write) ?? .null })
  }

  static func optional(_ inner: FieldSchema<Value>, omitDefault: Bool = false) -> Self {
    Self(
      defaultValue: nil,
      read: { json in
        let value = inner.read(json)
        return omitDefault && value == inner.defaultValue ? nil : value
      },
      write: inner.write)
  }

  /// Older spellings of a value, read as the value they name.
  static func aliased(_ inner: FieldSchema<Value>, _ aliases: [String: Value]) -> Self {
    Self(
      defaultValue: inner.defaultValue,
      read: { json in json.stringValue.flatMap { aliases[$0] } ?? inner.read(json) },
      write: inner.write)
  }

  static func array<Item>(_ item: FieldSchema<Item>) -> Self where Value == [Item] {
    Self(
      defaultValue: [],
      read: { json in json.arrayValue?.compactMap(item.read) ?? [] },
      write: { .array($0.map(item.write)) })
  }
}
