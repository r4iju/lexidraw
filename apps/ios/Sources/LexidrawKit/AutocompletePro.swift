import Foundation
import HTTPTypes
import OpenAPIRuntime

public enum AutocompleteProError: Error, LocalizedError, Equatable, Sendable {
  case unavailable, reconciling
  public var errorDescription: String? {
    switch self {
    case .unavailable: "Writing suggestion unavailable. Check AI Power and allowance."
    case .reconciling: "A suggestion is reconciling; credits remain reserved."
    }
  }
}
private struct SuggestionOperation: Decodable {
  let id: String
  let state: String
  let result: String?
}
private struct SuggestionEnvelope<Value: Decodable>: Decodable {
  struct Result: Decodable {
    struct Body: Decodable { let json: Value }
    let data: Body
  }
  let result: Result
}
private struct SuggestionPayload<T: Encodable>: Encodable { let json: T }
extension Session {
  public func writingSuggestionsEnabled() async throws -> Bool {
    struct Configuration: Decodable { let enabled: Bool }
    return try await suggestionRPC(
      "config.getAutocompleteConfig", input: Optional<String>.none, as: Configuration.self
    ).enabled
  }
  public func setWritingSuggestionsEnabled(_ enabled: Bool) async throws {
    struct Configuration: Codable { let enabled: Bool }
    _ = try await suggestionRPC(
      "config.updateAutocompleteConfig", input: Configuration(enabled: enabled),
      as: Configuration.self)
  }
  public func autocompletePro(title: String, before: String, after: String) async throws -> String {
    struct Input: Encodable {
      let idempotencyKey: String
      let title: String
      let before: String
      let after: String
    }
    func clip(_ value: String, bytes: Int, tail: Bool = false) -> String {
      var value = value
      while value.utf8.count > bytes { if tail { value.removeFirst() } else { value.removeLast() } }
      return value
    }
    // Submission is shielded until its durable ID arrives, so cancellation cannot orphan a reservation.
    let submitted = Task {
      try await suggestionRPC(
        "pro.autocomplete",
        input: Input(
          idempotencyKey: UUID().uuidString, title: clip(title, bytes: 100),
          before: clip(before, bytes: 900, tail: true), after: clip(after, bytes: 150)),
        as: SuggestionOperation.self)
    }
    var operation = try await submitted.value
    do {
      for _ in 0..<150 {
        try Task.checkCancellation()
        guard ["reserved", "running"].contains(operation.state) else { break }
        try await Task.sleep(for: .milliseconds(200))
        operation = try await suggestionRPC(
          "pro.operation", input: ["id": operation.id], query: true, as: SuggestionOperation.self)
      }
      try Task.checkCancellation()
      if operation.state == "unknown" { throw AutocompleteProError.reconciling }
      guard operation.state == "settled", let result = operation.result else {
        throw AutocompleteProError.unavailable
      }
      try NativeCredentialGuard.shared.check(Data(result.utf8))
      return result
    } catch {
      if Task.isCancelled || ["reserved", "running"].contains(operation.state) {
        let id = operation.id
        _ = try? await Task {
          try await suggestionRPC("pro.cancel", input: ["id": id], as: SuggestionOperation.self)
        }.value
      }
      throw error
    }
  }
  private func suggestionRPC<Input: Encodable, Value: Decodable>(
    _ procedure: String, input: Input?, query: Bool = false, as: Value.Type
  ) async throws -> Value {
    let data = try input.map { try JSONEncoder().encode(SuggestionPayload(json: $0)) }
    let path: String
    if query, let data {
      var components = URLComponents()
      components.path = "/" + procedure
      components.queryItems = [.init(name: "input", value: String(decoding: data, as: UTF8.self))]
      guard let url = components.string else { throw AutocompleteProError.unavailable }
      path = url
    } else {
      path = "/" + procedure
    }
    let request = HTTPRequest(
      method: input == nil || query ? .get : .post, scheme: nil, authority: nil, path: path)
    let (response, body) = try await connection.exchange(
      request, json: query ? nil : data, operationID: procedure,
      baseURL: origin.appending(path: "api/trpc"))
    guard (200..<300).contains(response.status.code), let body else {
      throw AutocompleteProError.unavailable
    }
    let bytes = try await Data(collecting: body, upTo: 1 << 16)
    try NativeCredentialGuard.shared.check(bytes)
    return try JSONDecoder().decode(SuggestionEnvelope<Value>.self, from: bytes).result.data.json
  }
}
