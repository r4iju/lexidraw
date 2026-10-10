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
private struct SuggestionOperation: Decodable, Sendable {
  let id: String
  let state: OperationState
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
    func clip(_ value: String, bytes: Int, tail: Bool = false) -> String {
      var value = value
      while value.utf8.count > bytes { if tail { value.removeFirst() } else { value.removeLast() } }
      return value
    }
    return try await aiHandle.proSuggestions.generate(
      session: self, title: clip(title, bytes: 100), before: clip(before, bytes: 900, tail: true),
      after: clip(after, bytes: 150))
  }
  fileprivate func suggestionRPC<Input: Encodable, Value: Decodable>(
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

private struct ProSuggestionInput: Encodable, Sendable {
  let idempotencyKey: String
  let title: String
  let before: String
  let after: String
  func matches(title: String, before: String, after: String) -> Bool {
    self.title == title && self.before == before && self.after == after
  }
}

// The sign-in owns this identity through lost acceptance replies and superseded editor work.
actor ProSuggestionRecovery {
  private struct Pending: Sendable {
    let input: ProSuggestionInput
    var operation: SuggestionOperation?
  }
  private var pending: Pending?
  private var busy = false
  func generate(session: Session, title: String, before: String, after: String) async throws -> String {
    guard !busy else { throw AutocompleteProError.reconciling }
    try await MainActor.run { _ = try session.aiHandle.existing() }
    busy = true
    defer { busy = false }
    let input = pending?.input ?? ProSuggestionInput(idempotencyKey: UUID().uuidString, title: title, before: before, after: after)
    let matches = input.matches(title: title, before: before, after: after)
    if pending == nil { pending = Pending(input: input) }
    var operation: SuggestionOperation
    if let saved = pending?.operation {
      operation = saved
      do {
        operation = try await session.suggestionRPC("pro.operation", input: ["id": saved.id], query: true, as: SuggestionOperation.self)
        guard operation.id == saved.id else { throw AutocompleteProError.reconciling }
        pending?.operation = operation
      } catch { throw AutocompleteProError.reconciling }
    } else {
      // One bounded same-key replay recovers the reservation, never a fresh paid identity.
      let submitted = Task {
        do { return try await session.suggestionRPC("pro.autocomplete", input: input, as: SuggestionOperation.self) }
        catch { return try await session.suggestionRPC("pro.autocomplete", input: input, as: SuggestionOperation.self) }
      }
      do { operation = try await submitted.value; pending?.operation = operation }
      catch { throw AutocompleteProError.reconciling }
    }
    do {
      try Task.checkCancellation()
      guard matches else {
        await cancelIfPending(session: session, operation: operation)
        if [.settled, .refunded, .cancelled].contains(operation.state) { pending = nil }
        throw AutocompleteProError.reconciling
      }
      for _ in 0..<150 {
        try Task.checkCancellation()
        guard [.reserved, .running].contains(operation.state) else { break }
        try await Task.sleep(for: .milliseconds(200))
        let updated: SuggestionOperation = try await session.suggestionRPC("pro.operation", input: ["id": operation.id], query: true, as: SuggestionOperation.self)
        guard updated.id == operation.id else { throw AutocompleteProError.reconciling }
        operation = updated
        pending?.operation = operation
      }
      try Task.checkCancellation()
      try await MainActor.run { _ = try session.aiHandle.existing() }
      if operation.state == .unknown { throw AutocompleteProError.reconciling }
      guard operation.state == .settled, let result = operation.result else {
        if [.refunded, .cancelled].contains(operation.state) { pending = nil }
        throw AutocompleteProError.unavailable
      }
      try NativeCredentialGuard.shared.check(Data(result.utf8))
      pending = nil
      return result
    } catch {
      if Task.isCancelled || [.reserved, .running].contains(operation.state) {
        await cancelIfPending(session: session, operation: operation)
      }
      throw error
    }
  }
  private func cancelIfPending(session: Session, operation: SuggestionOperation) async {
    guard [.reserved, .running].contains(operation.state) else { return }
    let id = operation.id
    do {
      let stopped = try await Task {
        try await session.suggestionRPC("pro.cancel", input: ["id": id], as: SuggestionOperation.self)
      }.value
      guard stopped.id == id else { return }
      pending?.operation = stopped
      if [.settled, .refunded, .cancelled].contains(stopped.state) { pending = nil }
    } catch { /* Keep the owned operation until an authoritative read or cancellation response. */ }
  }
}
