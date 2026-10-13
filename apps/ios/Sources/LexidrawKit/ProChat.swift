import Foundation
import HTTPTypes
import OpenAPIRuntime

public struct ProChatQuote: Sendable {
  public let maximum: Int64
  public let policy: String
  let json: Data
}
public enum OperationState: String, Decodable, Sendable {
  case reserved, running, unknown, settled, refunded, cancelled
}
public struct ProChatOperation: Decodable, Sendable {
  public let id: String
  public let state: OperationState
  public let result: String?
  public let charged: Int64
  public let quote: Int64
  private enum Field: String, CodingKey { case id, state, result, charged, quote }
  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Field.self)
    id = try container.decode(String.self, forKey: .id)
    state = try container.decode(OperationState.self, forKey: .state)
    guard container.contains(.result) else {
      throw DecodingError.keyNotFound(Field.result, .init(codingPath: decoder.codingPath, debugDescription: "Missing chat result"))
    }
    result = try container.decodeIfPresent(String.self, forKey: .result)
    charged = try container.decode(Int64.self, forKey: .charged)
    quote = try container.decode(Int64.self, forKey: .quote)
  }
}
enum ChatEvent: Decodable, Sendable {
  case text(String)
  case operation(ProChatOperation)
  case error(String)

  private struct Key: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init?(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { return nil }
  }
  private enum Field: String, CodingKey { case kind, text, operation, message }
  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Field.self)
    let kind = try container.decode(String.self, forKey: .kind)
    let keys = Set(try decoder.container(keyedBy: Key.self).allKeys.map(\.stringValue))
    let expected: Set<String>
    switch kind {
    case "text": expected = ["kind", "text"]
    case "operation": expected = ["kind", "operation"]
    case "error": expected = ["kind", "message"]
    default:
      throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "Unknown chat event")
    }
    guard keys == expected else {
      throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "Invalid chat event payload")
    }
    switch kind {
    case "text":
      let text = try container.decode(String.self, forKey: .text)
      guard text.utf8.count <= 16000 else {
        throw DecodingError.dataCorruptedError(forKey: .text, in: container, debugDescription: "Chat text exceeds bounds")
      }
      self = .text(text)
    case "operation": self = .operation(try container.decode(ProChatOperation.self, forKey: .operation))
    default: self = .error(try container.decode(String.self, forKey: .message))
    }
  }
}
extension Session {
  public func chatCapability() async throws -> ProAgentCapability {
    let data = try await chatRPC("pro.chatCapability", json: nil)
    return try JSONDecoder().decode(ProAgentCapability.self, from: data)
  }
  public func quoteChat(_ input: NativeChatInput) async throws -> ProChatQuote {
    _ = try await MainActor.run { try nativeChatPrepared(input) }
    let data = try await chatRPC("pro.chatQuote", json: JSONEncoder().encode(input))
    struct Quote: Decodable {
      let maximum: Int64
      let policy: String
    }
    let quote = try JSONDecoder().decode(Quote.self, from: data)
    guard quote.maximum > 0, quote.maximum <= 1_000_000_000 else { throw NativeChatError.uncertain }
    return ProChatQuote(maximum: quote.maximum, policy: quote.policy, json: data)
  }
  public func acceptChat(_ input: NativeChatInput, quote: ProChatQuote, idempotencyKey: String, document: String? = nil)
    async throws -> ProChatOperation
  {
    var object: [String: Any] = try [
      "input": JSONSerialization.jsonObject(with: JSONEncoder().encode(input)),
      "quote": JSONSerialization.jsonObject(with: quote.json), "idempotencyKey": idempotencyKey,
    ]
    if let document { object["documentId"] = document }
    let body = try JSONSerialization.data(withJSONObject: object)
    let response: Data
    do { response = try await chatRPC("pro.chatAccept", json: body) }
    catch {
      guard let document else { throw NativeChatError.uncertain }
      return try await recoverChat(input, idempotencyKey: idempotencyKey, document: document)
    }
    return try JSONDecoder().decode(ProChatOperation.self, from: response)
  }
  public func recoverChat(_ input: NativeChatInput, idempotencyKey: String, document: String) async throws -> ProChatOperation {
    let lookup = try JSONSerialization.data(withJSONObject: ["documentId": document, "idempotencyKey": idempotencyKey, "input": JSONSerialization.jsonObject(with: JSONEncoder().encode(input))])
    let response = try await chatRPC("pro.chatRecovery", json: lookup, query: true)
    return try JSONDecoder().decode(ProChatOperation.self, from: response)
  }
  public func unscopedChats() async throws -> [ProChatOperation] {
    let data = try await chatRPC("pro.chatUnscoped", json: nil)
    return try JSONDecoder().decode([ProChatOperation].self, from: data)
  }
  public func cancelUnscopedChat(_ id: String) async throws -> ProChatOperation {
    let data = try await chatRPC("pro.cancel", json: JSONEncoder().encode(["id": id]))
    return try JSONDecoder().decode(ProChatOperation.self, from: data)
  }
  public func ownedChats(document: String) async throws -> [ProChatOperation] {
    let data = try await chatRPC("pro.chatCurrent", json: JSONEncoder().encode(["documentId": document]), query: true)
    return try JSONDecoder().decode([ProChatOperation].self, from: data)
  }
  public func cancelOwnedChat(document: String, id: String) async throws -> ProChatOperation {
    let data = try await chatRPC("pro.chatCancel", json: JSONEncoder().encode(["documentId": document, "id": id]))
    return try JSONDecoder().decode(ProChatOperation.self, from: data)
  }
  public func cancelChat(_ id: String) async throws {
    _ = try await chatRPC("pro.cancel", json: JSONEncoder().encode(["id": id]))
  }
  public func streamChat(
    _ input: NativeChatInput, operation: ProChatOperation,
    onText: @escaping @Sendable (String) async -> Void
  ) async throws -> ProChatOperation {
    if operation.state == .settled, let result = operation.result {
      try NativeCredentialGuard.shared.check(Data(result.utf8))
      await onText(result)
      return operation
    }
    struct Input: Encodable {
      let id: String
      let input: NativeChatInput
    }
    let data = try JSONEncoder().encode(Input(id: operation.id, input: input))
    try NativeCredentialGuard.shared.check(data)
    let request = HTTPRequest(method: .post, scheme: nil, authority: nil, path: "/api/chat/stream")
    let (response, body) = try await connection.exchange(
      request, json: data, operationID: "chat.stream", baseURL: origin)
    guard response.status.code == 200, let body else { throw NativeChatError.uncertain }
    var frame = Data()
    var size = 0
    var previous = ""
    var result: ProChatOperation?
    do {
      for try await chunk in body {
        try Task.checkCancellation()
        size += chunk.count
        guard size <= 1_048_576 else { throw NativeChatError.uncertain }
        for byte in chunk {
          if byte != 10 {
            frame.append(byte)
            continue
          }
          try Task.checkCancellation()
          guard result == nil else { throw NativeChatError.uncertain }
          try NativeCredentialGuard.shared.check(frame)
          let event = try JSONDecoder().decode(ChatEvent.self, from: frame)
          frame.removeAll()
          switch event {
          case .text(let text):
            guard text.hasPrefix(previous) else {
              throw NativeChatError.uncertain
            }
            previous = text
            await onText(text)
          case .operation(let op):
            guard op.id == operation.id, op.state == .settled,
              let text = op.result, op.charged >= 0, op.charged <= op.quote
            else { throw NativeChatError.uncertain }
            result = op
            if previous.isEmpty { await onText(text) }
          case .error: throw NativeChatError.uncertain
          }
        }
      }
      guard let result, frame.isEmpty else { throw NativeChatError.uncertain }
      return result
    } catch {
      // Cancelling this task only drops the connection; an explicit Stop issues cancelChat itself.
      if Task.isCancelled { throw NativeChatError.cancelled }
      throw NativeChatError.uncertain
    }
  }
  private func chatRPC(_ procedure: String, json: Data?, query: Bool = false) async throws -> Data {
    let data = try json.map {
      try JSONSerialization.data(withJSONObject: ["json": JSONSerialization.jsonObject(with: $0)])
    }
    if let data { try NativeCredentialGuard.shared.check(data) }
    var path = "/" + procedure
    if query, let data {
      var components = URLComponents(); components.path = path
      components.queryItems = [.init(name: "input", value: String(decoding: data, as: UTF8.self))]
      guard let encoded = components.string else { throw NativeChatError.uncertain }
      path = encoded
    }
    let request = HTTPRequest(
      method: data == nil || query ? .get : .post, scheme: nil, authority: nil, path: path)
    let (response, body) = try await connection.exchange(
      request, json: query ? nil : data, operationID: procedure, baseURL: origin.appending(path: "api/trpc"))
    guard (200..<300).contains(response.status.code), let body else {
      throw NativeChatError.unavailable
    }
    let bytes = try await Data(collecting: body, upTo: 1 << 18)
    try NativeCredentialGuard.shared.check(bytes)
    guard let object = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
      let result = object["result"] as? [String: Any], let data = result["data"] as? [String: Any],
      let json = data["json"]
    else { throw NativeChatError.uncertain }
    return try JSONSerialization.data(withJSONObject: json)
  }
}
