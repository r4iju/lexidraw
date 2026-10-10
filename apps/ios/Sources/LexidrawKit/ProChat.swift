import Foundation
import HTTPTypes
import OpenAPIRuntime

public struct ProChatQuote: Sendable {
  public let maximum: Int64
  public let policy: String
  let json: Data
}
public struct ProChatOperation: Decodable, Sendable {
  public let id: String
  public let state: String
  public let result: String?
  public let charged: Int64
  public let quote: Int64
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
  public func acceptChat(_ input: NativeChatInput, quote: ProChatQuote, idempotencyKey: String)
    async throws -> ProChatOperation
  {
    let body = try JSONSerialization.data(withJSONObject: [
      "input": JSONSerialization.jsonObject(with: JSONEncoder().encode(input)),
      "quote": JSONSerialization.jsonObject(with: quote.json), "idempotencyKey": idempotencyKey,
    ])
    let response: Data
    do { response = try await chatRPC("pro.chatAccept", json: body) }
    catch {
      // Acceptance only reserves; one replay with the same key recovers its ID without paid dispatch.
      response = try await chatRPC("pro.chatAccept", json: body)
    }
    return try JSONDecoder().decode(ProChatOperation.self, from: response)
  }
  public func cancelChat(_ id: String) async throws {
    _ = try await chatRPC("pro.cancel", json: JSONEncoder().encode(["id": id]))
  }
  public func streamChat(
    _ input: NativeChatInput, operation: ProChatOperation,
    onText: @escaping @Sendable (String) async -> Void
  ) async throws -> ProChatOperation {
    if operation.state == "settled", let result = operation.result {
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
    struct Event: Decodable {
      let kind: String
      let text: String?
      let operation: ProChatOperation?
    }
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
          try NativeCredentialGuard.shared.check(frame)
          let event = try JSONDecoder().decode(Event.self, from: frame)
          frame.removeAll()
          switch event.kind {
          case "text":
            guard let text = event.text, text.utf8.count <= 16000, text.hasPrefix(previous) else {
              throw NativeChatError.uncertain
            }
            previous = text
            await onText(text)
          case "operation":
            guard let op = event.operation, op.id == operation.id, op.state == "settled",
              let text = op.result, op.charged >= 0, op.charged <= op.quote
            else { throw NativeChatError.uncertain }
            result = op
            if previous.isEmpty { await onText(text) }
          default: throw NativeChatError.uncertain
          }
        }
      }
      guard let result, frame.isEmpty else { throw NativeChatError.uncertain }
      return result
    } catch {
      if Task.isCancelled {
        _ = try? await Task { try await cancelChat(operation.id) }.value
        throw NativeChatError.cancelled
      }
      throw NativeChatError.uncertain
    }
  }
  private func chatRPC(_ procedure: String, json: Data?) async throws -> Data {
    let data = try json.map {
      try JSONSerialization.data(withJSONObject: ["json": JSONSerialization.jsonObject(with: $0)])
    }
    if let data { try NativeCredentialGuard.shared.check(data) }
    let request = HTTPRequest(
      method: data == nil ? .get : .post, scheme: nil, authority: nil, path: "/" + procedure)
    let (response, body) = try await connection.exchange(
      request, json: data, operationID: procedure, baseURL: origin.appending(path: "api/trpc"))
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
