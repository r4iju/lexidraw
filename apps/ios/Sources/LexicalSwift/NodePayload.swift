/// A node's stored JSON, as the type generated for it from the node schema
/// (`SerializedNodes.swift`). Absent properties stay absent, so what was read
/// is what gets written.
public protocol NodePayload: Codable, Equatable, Sendable {
  /// The node's `type`.
  static var type: String { get }
  /// Properties the schema doesn't declare, written back as read. That
  /// includes the deprecated `version`, which Lexical writes and never reads.
  var unknownFields: [String: JSONValue] { get set }
  init(json: JSONValue) throws
  var json: JSONValue { get }
}

public protocol ElementNodePayload: NodePayload {
  var children: [SerializedNode]? { get set }
}

extension NodePayload {
  public init(from decoder: any Decoder) throws {
    try self.init(json: JSONValue(from: decoder))
  }

  public func encode(to encoder: any Encoder) throws {
    try json.encode(to: encoder)
  }
}

extension SerializedNode: Codable {
  public init(from decoder: any Decoder) throws {
    self.init(json: try JSONValue(from: decoder))
  }

  public func encode(to encoder: any Encoder) throws {
    try json.encode(to: encoder)
  }
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

  mutating func takeChildren() -> [SerializedNode]? {
    guard case .array(let children)? = rest["children"] else { return nil }
    rest["children"] = nil
    return children.map(SerializedNode.init(json:))
  }

  mutating func put<Value>(_ key: String, _ value: Value?, _ schema: FieldSchema<Value>) {
    if let value { rest[key] = schema.write(value) }
  }

  mutating func putChildren(_ children: [SerializedNode]?) {
    if let children { rest["children"] = .array(children.map(\.json)) }
  }

  var json: JSONValue { .object(rest) }
}
