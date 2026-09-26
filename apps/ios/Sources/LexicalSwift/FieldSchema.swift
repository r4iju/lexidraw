/// How one property of a node's JSON is read and written: the Swift side of a
/// field type in the node schema.
struct FieldSchema<Value: Equatable & Sendable>: Sendable {
  /// The field type's `default`; nil where it has none.
  let defaultValue: Value?
  /// Reads a stored value; nil where it reads as absent.
  let read: @Sendable (JSONValue) -> Value?
  let write: @Sendable (Value) -> JSONValue
  /// How well a stored value fits, the measure Lexical picks a union's member by.
  let fit: @Sendable (JSONValue) -> Fit
  /// Whether it describes nothing: a raw value, or a wrapper of one.
  var isCatchAll = false
}

/// Lexical's measure of how well a schema fits a value (`$fitOf`): lower fits
/// better.
enum Fit: Int, Comparable, Sendable {
  case whole = 1
  /// Whole, but only because part of it is a raw value.
  case viaCatchAll
  /// Read, but not as it is.
  case coercible
  case none

  static func < (a: Fit, b: Fit) -> Bool { a.rawValue < b.rawValue }

  static func of(_ fits: Bool) -> Fit { fits ? .whole : .none }

  /// A container's fit: one that reads every part is at worst coercible.
  static func container<Parts: Sequence<Fit>>(_ parts: Parts) -> Fit {
    Swift.min(parts.max() ?? .whole, .coercible)
  }
}

extension FieldSchema where Value == String {
  static func string(default defaultValue: String) -> Self {
    Self(
      defaultValue: defaultValue, read: { $0.stringValue ?? defaultValue }, write: { .string($0) },
      fit: { .of($0.stringValue != nil) })
  }
}

extension FieldSchema where Value == Bool {
  static func boolean(default defaultValue: Bool) -> Self {
    Self(
      defaultValue: defaultValue,
      read: { if case .bool(let value) = $0 { value } else { defaultValue } },
      write: { .bool($0) },
      fit: { if case .bool = $0 { .whole } else { .none } })
  }
}

extension FieldSchema where Value == Double {
  static func number(default defaultValue: Double, min: Double? = nil, max: Double? = nil, clamp: Bool = false)
    -> Self
  {
    let domain = NumberDomain(min: min, max: max, integer: false, clamp: clamp)
    return Self(
      defaultValue: defaultValue,
      read: { domain.read($0) ?? defaultValue },
      write: { .number($0) },
      fit: { .of(domain.read($0) != nil) })
  }
}

extension FieldSchema where Value == Int {
  static func integer(default defaultValue: Int, min: Int? = nil, max: Int? = nil, clamp: Bool = false) -> Self {
    let domain = NumberDomain(min: min.map(Double.init), max: max.map(Double.init), integer: true, clamp: clamp)
    return Self(
      defaultValue: defaultValue,
      read: { domain.read($0).flatMap { Int(exactly: $0) } ?? defaultValue },
      write: { .number(Double($0)) },
      fit: { .of(domain.read($0) != nil) })
  }
}

/// Lexical's `numberValue`: a finite number, or a string spelled as a JSON
/// number, inside the bounds or brought to the nearer one by `clamp`.
private struct NumberDomain: Sendable {
  let min: Double?
  let max: Double?
  let integer: Bool
  let clamp: Bool

  /// The number `json` is in the domain, or nil where it is outside it.
  func read(_ json: JSONValue) -> Double? {
    let number: Double? =
      switch json {
      case .number(let value): value
      case .string(let value) where value.wholeMatch(of: #/-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/#) != nil:
        Double(value)
      default: nil
      }
    guard let number, number.isFinite, !integer || number.rounded() == number else { return nil }
    if clamp { return Swift.min(Swift.max(number, min ?? -.infinity), max ?? .infinity) }
    return (min.map { number >= $0 } ?? true) && (max.map { number <= $0 } ?? true) ? number : nil
  }
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

/// The enum whose only member is null, as `Never?`.
extension Never: JSONEnumeration {
  init?(enumerationJSON json: JSONValue) { nil }
  var enumerationJSON: JSONValue { switch self {} }
}

extension FieldSchema where Value: JSONEnumeration {
  /// A nil `defaultValue` is absence; `E?.none` is JSON `null`.
  static func enumeration(default defaultValue: Value?) -> Self {
    Self(
      defaultValue: defaultValue,
      read: { Value(enumerationJSON: $0) ?? defaultValue },
      write: { $0.enumerationJSON },
      fit: { .of(Value(enumerationJSON: $0) != nil) })
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
      write: { $0.map(inner.write) ?? .null },
      fit: { $0 == .null ? .whole : inner.fit($0) },
      isCatchAll: inner.isCatchAll)
  }

  static func optional(_ inner: FieldSchema<Value>, omitDefault: Bool = false) -> Self {
    Self(
      defaultValue: nil,
      read: { json in
        let value = inner.read(json)
        return omitDefault && value == inner.defaultValue ? nil : value
      },
      write: inner.write, fit: inner.fit, isCatchAll: inner.isCatchAll)
  }

  /// Older spellings of a value, read as the value they name.
  static func aliased(_ inner: FieldSchema<Value>, _ aliases: [String: Value]) -> Self {
    Self(
      defaultValue: inner.defaultValue,
      read: { json in json.stringValue.flatMap { aliases[$0] } ?? inner.read(json) },
      write: inner.write,
      fit: { json in json.stringValue.flatMap { aliases[$0] } != nil ? .whole : inner.fit(json) },
      isCatchAll: inner.isCatchAll)
  }

  static func array<Item>(_ item: FieldSchema<Item>) -> Self where Value == [Item] {
    Self(
      defaultValue: [],
      read: { json in json.arrayValue?.compactMap(item.read) ?? [] },
      write: { .array($0.map(item.write)) },
      fit: { json in json.arrayValue.map { .container($0.lazy.map(item.fit)) } ?? .none })
  }

  /// Lexical's `transformValue`, through the Swift copy of the function
  /// Lexidraw named it by: it keeps a value, rewrites it, or reads it as absent.
  static func transform(_ inner: FieldSchema<Value>, _ transform: @escaping @Sendable (Value) -> Value?) -> Self {
    Self(
      defaultValue: inner.defaultValue.flatMap(transform),
      read: { inner.read($0).flatMap(transform) },
      write: inner.write, fit: inner.fit, isCatchAll: inner.isCatchAll)
  }
}

extension FieldSchema where Value == JSONValue {
  /// Lexical's `rawValue`: any value, as it is.
  static var raw: Self {
    Self(defaultValue: nil, read: { $0 }, write: { $0 }, fit: { _ in .viaCatchAll }, isCatchAll: true)
  }
}

extension FieldSchema where Value: DeclaredObject {
  /// Lexical's `objectValue`, or Lexidraw's `openObjectValue`: a value that
  /// isn't an object reads as the default one.
  static var object: Self {
    Self(
      defaultValue: Value.defaultValue,
      read: { json in if case .object(let object) = json { Value(object) } else { Value.defaultValue } },
      write: { $0.json },
      fit: { json in
        guard case .object(let object) = json else { return .none }
        if !Value.isOpen, object.keys.contains(where: { Value.fieldFits[$0] == nil }) { return .none }
        return .container(object.lazy.compactMap { key, value in Value.fieldFits[key]?(value) })
      })
  }
}

extension FieldSchema {
  func resolving(_ value: Value?) -> Value? {
    value ?? defaultValue
  }

  func resolving<Inner>(_ value: Nullable<Inner>) -> Nullable<Inner> where Value == Inner? {
    guard case .absent = value, let fallback = defaultValue else { return value }
    return fallback.map(Nullable.value) ?? .null
  }

  func omittingDefault(_ value: Value?) -> Value? {
    value == defaultValue ? nil : value
  }
}
