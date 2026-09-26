/// A node's stored JSON, as the type generated for it from the node schema
/// (`SerializedNodes.swift`). Absent properties stay absent, so what was read
/// is what gets written.
public protocol NodePayload: JSONCodable, Equatable, Sendable {
  /// The node's `type`.
  static var type: String { get }
  /// What Lexical writes as `version`.
  static var version: Int { get }
  /// Properties the schema doesn't declare, written back as read.
  var unknownFields: [String: JSONValue] { get set }
  /// As Lexical holds the node once read: fields left out take their
  /// defaults, and node state at its default is left out.
  func resolved() -> Self
}

public protocol ElementNodePayload: NodePayload {
  var children: [SerializedNode]? { get set }
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
    case field(String)

    public func value(in json: JSONValue) -> Bool {
      switch self {
      case .fixed(let value): value
      case .field(let key): json[key] == .bool(true)
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

/// A node's properties while its payload reads them off or writes them back.
struct NodeFields {
  private(set) var rest: [String: JSONValue]

  init(reading json: JSONValue, as type: String) throws {
    guard case .object(let object) = json, object["type"] == .string(type) else {
      throw NodePayloadError(description: "Not a \(type) node")
    }
    rest = object
    rest["type"] = nil
  }

  init(writing type: String, over unknownFields: [String: JSONValue]) {
    rest = unknownFields
    rest["type"] = .string(type)
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

  mutating func putChildren(_ children: [SerializedNode]?) {
    if let children { rest["children"] = .array(children.map(\.json)) }
  }

  var json: JSONValue { .object(rest) }
}
