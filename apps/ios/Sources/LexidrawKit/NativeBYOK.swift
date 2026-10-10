import Foundation
import JavaScriptCore

public enum NativeAIError: Error, LocalizedError, Sendable {
  case missingKey, unavailable, expired, rejected
  case provider(Int)
  case cancelled
  public var errorDescription: String? {
    switch self {
    case .missingKey: "Set up your OpenRouter key on this device."
    case .unavailable: "Text generation is unavailable on this device."
    case .expired: "The key changed or this session ended. Start again."
    case .rejected: "A request or result contained a provider credential and was blocked."
    case .provider(let status):
      "OpenRouter could not complete the request (\(status)). Check your key and provider access."
    case .cancelled: "Generation stopped. An issued provider request may still be billed."
    }
  }
}

/// Native request lifetimes contain only opaque references, never key values.
public struct NativeCredentialReference: Sendable {
  fileprivate let generation: UUID
}

private final class NoProviderRedirects: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) { completionHandler(nil) }
}

@MainActor public final class NativeBYOK {
  private let store: any TokenStore
  private let files: NativeTextFileStore?
  private let configuration: URLSessionConfiguration
  private var generation = UUID()
  private var sessions: [UUID: URLSession] = [:]
  private var ended = false
  public private(set) var hasKey = false

  public init(store: any TokenStore, configuration: URLSessionConfiguration = .ephemeral,
    files: NativeTextFileStore? = nil) {
    self.files = files
    self.store = store
    self.configuration = configuration
    if let key = try? store.load() {
      hasKey = true
      NativeCredentialGuard.shared.remember(key)
    }
  }

  public func replaceKey(_ key: String) throws {
    guard !ended else { throw NativeAIError.expired }
    guard !key.isEmpty, key.count <= 4096, !key.contains(where: { $0.isWhitespace || $0.isNewline })
    else {
      throw NativeAIError.missingKey
    }
    cancel()
    try store.save(key)
    NativeCredentialGuard.shared.remember(key)
    hasKey = true
  }

  public func removeKey() throws {
    cancel()
    hasKey = false
    try store.delete()
  }

  public func endSession() throws {
    ended = true
    try removeKey()
    try files?.clear()
  }

  public func savedSuggestion() throws -> String? {
    guard !ended else { throw NativeAIError.expired }
    return try files?.load()
  }

  public func cancel() {
    generation = UUID()
    for session in sessions.values { session.invalidateAndCancel() }
    sessions.removeAll()
  }

  public func credentialReference() throws -> NativeCredentialReference {
    guard !ended else { throw NativeAIError.expired }
    guard hasKey else { throw NativeAIError.missingKey }
    return NativeCredentialReference(generation: generation)
  }

  /// Validation is a direct, unbilled key-information request, not generation.
  public func validate() async throws {
    let data = try await request(path: "/api/v1/key", body: nil, reference: credentialReference())
    struct KeyInformation: Decodable {
      struct Details: Decodable {
        let is_free_tier: Bool
        let is_management_key: Bool?
        let limit_remaining: Double?
      }
      let data: Details
    }
    guard let details = try? JSONDecoder().decode(KeyInformation.self, from: data).data,
      details.is_management_key != true, details.limit_remaining.map({ $0 > 0 }) ?? true
    else {
      throw NativeAIError.unavailable
    }
  }

  public func suggest(title: String, before: String, after: String) async throws -> String {
    try await suggest(title: title, before: before, after: after, reference: credentialReference())
  }

  public func suggest(
    title: String, before: String, after: String,
    reference: NativeCredentialReference
  ) async throws -> String {
    guard let context = JSContext() else { throw NativeAIError.unavailable }
    context.evaluateScript(nativeGenerationScript)
    guard context.exception == nil else { throw NativeAIError.unavailable }
    for text in [title, before, after] { try NativeCredentialGuard.shared.check(Data(text.utf8)) }
    guard
      let json = context.objectForKeyedSubscript("nativeAutocompleteRequest")?
        .call(withArguments: [title, before, after])?.toString(), context.exception == nil,
      let prepared = try? JSONDecoder().decode(Prepared.self, from: Data(json.utf8))
    else {
      throw NativeAIError.unavailable
    }
    let body = try JSONEncoder().encode(
      CompletionRequest(
        model: prepared.config.modelId,
        messages: [
          .init(role: "system", content: prepared.system),
          .init(role: "user", content: prepared.prompt),
        ],
        temperature: prepared.config.temperature, max_tokens: prepared.config.maxOutputTokens))
    let data = try await request(path: "/api/v1/chat/completions", body: body, reference: reference)
    guard let response = try? JSONDecoder().decode(Completion.self, from: data),
      let content = response.choices.first?.message.content,
      let output = context.objectForKeyedSubscript("nativeAutocompleteResult")?
        .call(withArguments: [before, content])?.toString(), context.exception == nil
    else {
      throw NativeAIError.unavailable
    }
    try NativeCredentialGuard.shared.check(Data(output.utf8))
    try files?.save(output)
    return output
  }

  private func request(path: String, body: Data?, reference: NativeCredentialReference) async throws
    -> Data
  {
    guard !ended, reference.generation == generation else { throw NativeAIError.expired }
    guard let key = try store.load(), hasKey else { throw NativeAIError.missingKey }
    guard ["/api/v1/key", "/api/v1/chat/completions"].contains(path),
      let url = URL(string: "https://openrouter.ai" + path)
    else { throw NativeAIError.unavailable }
    if let body { try NativeCredentialGuard.shared.check(body) }
    var request = URLRequest(url: url)
    request.httpMethod = body == nil ? "GET" : "POST"
    request.httpBody = body
    request.timeoutInterval = 30
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
    guard let config = configuration.copy() as? URLSessionConfiguration else { throw NativeAIError.unavailable }
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.urlCredentialStorage = nil
    config.urlCache = nil
    config.httpAdditionalHeaders = nil
    let session = URLSession(
      configuration: config, delegate: NoProviderRedirects(), delegateQueue: nil)
    let id = UUID()
    sessions[id] = session
    defer {
      sessions.removeValue(forKey: id)
      session.finishTasksAndInvalidate()
    }
    do {
      let (data, response) = try await session.data(for: request)
      try Task.checkCancellation()
      guard reference.generation == generation, !ended else { throw NativeAIError.expired }
      guard let http = response as? HTTPURLResponse else { throw NativeAIError.unavailable }
      guard http.url == url, (200..<300).contains(http.statusCode) else {
        throw NativeAIError.provider(http.statusCode)
      }
      guard data.count <= 1 << 20 else { throw NativeAIError.unavailable }
      try NativeCredentialGuard.shared.check(data)
      return data
    } catch let error as NativeAIError { throw error } catch is CancellationError {
      throw NativeAIError.cancelled
    } catch let error as URLError where error.code == .cancelled {
      throw NativeAIError.cancelled
    } catch { throw NativeAIError.unavailable }
  }
}

private struct Prepared: Decodable {
  struct Config: Decodable {
    let modelId: String
    let temperature: Double
    let maxOutputTokens: Int
  }
  let config: Config
  let system: String
  let prompt: String
}
private struct CompletionRequest: Encodable {
  struct Message: Encodable {
    let role: String
    let content: String
  }
  let model: String
  let messages: [Message]
  let temperature: Double
  let max_tokens: Int
}
private struct Completion: Decodable {
  struct Choice: Decodable {
    struct Message: Decodable { let content: String }
    let message: Message
  }
  let choices: [Choice]
}

/// Retired values remain guarded for the process lifetime because already
/// returned content or queued app work may still contain them.
public final class NativeCredentialGuard: @unchecked Sendable {
  public static let shared = NativeCredentialGuard()
  private let lock = NSLock()
  private var values = Set<String>()
  public func remember(_ key: String) {
    lock.lock()
    defer { lock.unlock() }
    values.insert(key)
    values.insert(Data(key.utf8).base64EncodedString())
    values.insert(key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? key)
  }
  public func check(_ data: Data) throws {
    lock.lock()
    let known = values
    lock.unlock()
    func checkText(_ text: String) throws {
      if known.contains(where: { text.contains($0) })
        || text.range(of: #"sk-(?:or-v1-|ant-)?[A-Za-z0-9_-]{16,}"#, options: .regularExpression)
          != nil
      {
        throw NativeAIError.rejected
      }
    }
    try checkText(String(decoding: data, as: UTF8.self))
    func checkJSON(_ value: Any) throws {
      if let text = value as? String {
        try checkText(text)
      } else if let list = value as? [Any] {
        for item in list { try checkJSON(item) }
      } else if let object = value as? [String: Any] {
        for (key, item) in object {
          try checkText(key)
          try checkJSON(item)
        }
      }
    }
    if let decoded = try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed) {
      try checkJSON(decoded)
    }
  }
  public func check(error: Error) throws {
    try check(Data(error.localizedDescription.utf8))
    try check(Data(String(describing: (error as NSError).userInfo).utf8))
  }
  public func check(_ request: URLRequest, body: Data? = nil) throws {
    try check(Data((request.url?.absoluteString ?? "").utf8))
    for (name, value) in request.allHTTPHeaderFields ?? [:] { try check(Data((name + value).utf8)) }
    if let data = body ?? request.httpBody { try check(data) }
  }
}
