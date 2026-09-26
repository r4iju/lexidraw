/// A node's stored JSON, as the type generated for it from the node schema
/// (`SerializedNodes.swift`). Absent properties stay absent, so what was read
/// is what gets written.
public protocol NodePayload: JSONCodable, Equatable, Sendable {
  /// The node's `type`.
  static var type: String { get }
  /// What Lexical writes as `version`.
  static var version: Int { get }
  /// Every key Lexical writes for the node, in the order it writes them.
  static var keyOrder: [String] { get }
  /// Properties the schema doesn't declare, written back as read after the
  /// ones it does.
  var unknownFields: JSONObject { get set }
  /// As Lexical holds the node once read: fields left out take their
  /// defaults, down through the objects they hold, node state at its default
  /// is left out, and an editor state the node reads into an editor of its
  /// own is as that editor saves it.
  func asLoaded() -> Self
}

/// A node whose JSON lists children: every element, and the few decorators
/// that write an always empty list.
public protocol ParentNodePayload: NodePayload {
  var children: [SerializedNode]? { get set }
}

/// An object a node stores in a property, as the struct generated for it.
/// Like a payload, it keeps absent properties absent and undeclared ones as
/// they were read.
public protocol ObjectPayload: JSONCodable, Equatable, Sendable {
  var unknownFields: JSONObject { get set }
}

/// What reading a declared object as Lexical does takes.
protocol DeclaredObject: ObjectPayload {
  /// Whether a union counts it as fitting a value with undeclared keys.
  static var isOpen: Bool { get }
  /// What Lexical reads a value that isn't an object as.
  static var defaultValue: Self { get }
  static var fieldFits: [String: @Sendable (JSONValue) -> Fit] { get }
  /// Its keys in the order Lexical declares them.
  static var keyOrder: [String] { get }
  init(_ object: JSONObject)
  /// As Lexical holds it once read, as a node's `asLoaded` is.
  func asLoaded() -> Self
}

extension DeclaredObject {
  public init(json: JSONValue) throws {
    guard case .object(let object) = json else {
      throw NodePayloadError(description: "Not an object")
    }
    self.init(object)
  }
}

/// A value that is coded as the JSON it reads from and writes.
public protocol JSONCodable: Codable {
  init(json: JSONValue) throws
  var json: JSONValue { get }
}

extension JSONCodable {
  public init(from decoder: any Decoder) throws {
    try self.init(json: JSONValue(from: decoder))
  }

  public func encode(to encoder: any Encoder) throws {
    try json.encode(to: encoder)
  }
}

extension SerializedNode: JSONCodable {}

/// `NodeTraits` in `packages/lexical-nodes/src/node-schema.ts`.
public struct NodeTraits: Equatable, Sendable {
  public enum Kind: Equatable, Sendable {
    case element
    case text
    case lineBreak
    case decorator
  }

  public enum Trait: Equatable, Sendable {
    case fixed(Bool)
    /// The property it follows, which a stored node can hold as any value:
    /// Lexical tests what it returns as JavaScript tests a condition.
    case field(String)

    public func value(in json: JSONValue) -> Bool {
      switch self {
      case .fixed(let value): value
      case .field(let key): json[key]?.isTruthy ?? false
      }
    }
  }

  public let kind: Kind
  public let inline: Trait
  public let shadowRoot: Trait
  public let canBeEmpty: Trait
}

/// A property JSON can leave out, set to `null`, or set to a value.
public enum Nullable<Value: Equatable & Sendable>: Equatable, Sendable {
  case absent
  case null
  case value(Value)
}

extension SerializedNode {
  init<Payload: NodePayload>(_ json: JSONValue, as wrap: (Payload) -> SerializedNode) {
    self = (try? Payload(json: json)).map(wrap) ?? .opaque(json)
  }
}

public struct NodePayloadError: Error, CustomStringConvertible {
  public let description: String
}

/// The order keys were read in, where Lexical writes them back in that order.
/// Lexical's own equality doesn't see it, so neither does this.
public struct StoredOrder: Equatable, Sendable {
  var keys: [String]

  init(_ keys: [String] = []) {
    self.keys = keys
  }

  public static func == (_: StoredOrder, _: StoredOrder) -> Bool { true }
}

/// A node's properties while its payload reads them off or writes them back.
struct NodeFields {
  private(set) var rest: JSONObject

  init(reading json: JSONValue, as type: String) throws {
    guard case .object(let object) = json, object["type"] == .string(type) else {
      throw NodePayloadError(description: "Not a \(type) node")
    }
    rest = object
    rest["type"] = nil
    rest["version"] = nil
  }

  /// Every node declares `version`, and Lexical writes its own whatever was
  /// stored.
  init(writing type: String, version: Int, over unknownFields: JSONObject) {
    rest = unknownFields
    rest["type"] = .string(type)
    rest["version"] = .number(Double(version))
  }

  init(_ object: JSONObject) {
    rest = object
  }

  init(over unknownFields: JSONObject) {
    rest = unknownFields
  }

  var keys: [String] { rest.keys }

  /// Whether the node holds NodeState as Lexical tells: `$` is truthy.
  var holdsState: Bool { rest["$"]?.isTruthy ?? false }

  /// `$` as Lexical reads NodeState, spreading it into an object: a string's
  /// UTF-16 code units and an array's items are its keys, and nothing else
  /// has any. It's written only where it holds some.
  mutating func spreadState() {
    guard let state = rest["$"] else { return }
    let spread: JSONObject =
      switch state {
      case .object(let object): object
      case .array(let items): JSONObject(items.enumerated().map { (String($0.offset), $0.element) })
      case .string(let string):
        JSONObject(
          string.utf16.enumerated().map {
            (String($0.offset), .string(String(decoding: [$0.element], as: UTF16.self)))
          })
      default: [:]
      }
    rest["$"] = spread.isEmpty ? nil : .object(spread)
  }

  /// The node state nested under `$`, taken off to be read or written. A `$`
  /// that isn't an object stays where it is, as Lexical ignores it.
  mutating func takeState() -> NodeFields {
    guard case .object(let state)? = rest["$"] else { return NodeFields([:]) }
    rest["$"] = nil
    return NodeFields(state)
  }

  /// Puts back what `takeState` took, where there is any.
  mutating func putState(_ state: NodeFields) {
    if !state.rest.isEmpty { rest["$"] = .object(state.rest) }
  }

  /// Puts back what `takeState` took, as Lexical writes NodeState: the state
  /// it doesn't declare first, then what it declares, `known`, in the order
  /// it was read in.
  mutating func putState(_ state: NodeFields, after known: [String], in order: StoredOrder) {
    let undeclared = state.rest.keys.filter { !known.contains($0) }
    putState(NodeFields(state.rest.ordered(by: undeclared + order.keys + known)))
  }

  mutating func take<Value>(_ key: String, _ schema: FieldSchema<Value>) -> Value? {
    rest.removeValue(forKey: key).flatMap(schema.read)
  }

  mutating func takeNullable<Value>(_ key: String, _ schema: FieldSchema<Value?>) -> Nullable<Value> {
    switch take(key, schema) {
    case nil: .absent
    case .some(nil): .null
    case .some(.some(let value)): .value(value)
    }
  }

  mutating func takeChildren() -> [SerializedNode]? {
    guard case .array(let children)? = rest["children"] else { return nil }
    rest["children"] = nil
    return children.map(SerializedNode.init(json:))
  }

  mutating func put<Value>(_ key: String, _ value: Value?, _ schema: FieldSchema<Value>) {
    if let value { rest[key] = schema.write(value) }
  }

  mutating func putNullable<Value>(_ key: String, _ value: Nullable<Value>, _ schema: FieldSchema<Value?>) {
    switch value {
    case .absent: break
    case .null: put(key, .some(nil), schema)
    case .value(let value): put(key, .some(value), schema)
    }
  }

  /// Node state, which Lexical leaves out where it is its default.
  mutating func putUnlessDefault<Value>(_ key: String, _ value: Value?, _ schema: FieldSchema<Value>) {
    if value != schema.defaultValue { put(key, value, schema) }
  }

  mutating func putNullableUnlessDefault<Value>(
    _ key: String, _ value: Nullable<Value>, _ schema: FieldSchema<Value?>
  ) {
    let read: Value?? =
      switch value {
      case .absent: nil
      case .null: .some(nil)
      case .value(let value): .some(value)
      }
    if read != schema.defaultValue { putNullable(key, value, schema) }
  }

  mutating func putChildren(_ children: [SerializedNode]?) {
    if let children { rest["children"] = .array(children.map(\.json)) }
  }

  /// The fields, with the keys `order` lists first.
  func json(in order: [String]) -> JSONValue { .object(rest.ordered(by: order)) }
}
