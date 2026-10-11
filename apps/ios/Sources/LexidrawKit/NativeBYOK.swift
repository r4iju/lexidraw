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
    case .rejected: "The request was blocked because it contained a provider credential or exceeded a safety limit."
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
  private let credentialGuard: NativeCredentialGuard
  private let files: NativeTextFileStore?
  private let configuration: URLSessionConfiguration
  private var generation = UUID()
  private var sessions: [UUID: URLSession] = [:]
  private let chatFixture: Bool
  private let agentFixture: Bool
  private let narrationFixture: Bool
  public var sessionActive: Bool { !ended }
  public func isCurrent(_ reference: NativeCredentialReference) -> Bool {
    !ended && hasKey && reference.generation == generation
  }
  private let imageFixture: Bool
  private var endActions: [() throws -> Void] = []
  public func onSessionEnd(_ action: @escaping () throws -> Void) { endActions.append(action) }
  private var ended = false
  public private(set) var hasKey = false
  public private(set) var cleanupPending = false

  public init(
    store: any TokenStore, configuration: URLSessionConfiguration = .ephemeral,
    files: NativeTextFileStore? = nil, imageFixture: Bool = false, narrationFixture: Bool = false,
    agentFixture: Bool = false, chatFixture: Bool = false,
    credentialGuard: NativeCredentialGuard = .shared
  ) {
    self.credentialGuard = credentialGuard
    self.chatFixture = chatFixture
    self.agentFixture = agentFixture
    self.narrationFixture = narrationFixture
    self.imageFixture = imageFixture
    self.files = files
    self.store = store
    self.configuration = configuration
    cleanupPending = NativeProviderResidue.contains(store)
    if !cleanupPending, let key = try? store.load() {
      if (try? credentialGuard.remember(key)) != nil { hasKey = true }
    }
  }

  public func replaceKey(_ key: String) throws {
    guard !ended else { throw NativeAIError.expired }
    guard !key.isEmpty, key.count <= 4096, !key.contains(where: { $0.isWhitespace || $0.isNewline })
    else {
      throw NativeAIError.missingKey
    }
    try credentialGuard.remember(key)
    cancel()
    try store.save(key)
    NativeProviderResidue.clear(store)
    cleanupPending = false
    hasKey = true
  }

  public func removeKey() throws {
    cancel()
    hasKey = false
    NativeProviderResidue.mark(store)
    cleanupPending = true
    do { try store.delete() }
    catch { throw NativeCleanupFailure(steps: [.providerKey]) }
    NativeProviderResidue.clear(store)
    cleanupPending = false
  }

  public func endSession() throws {
    ended = true
    var failures = Set<NativeCleanupFailure.Step>()
    do { try removeKey() } catch { failures.insert(.providerKey) }
    do { try files?.clear() } catch { failures.insert(.textFiles) }
    var pending: [() throws -> Void] = []
    for action in endActions {
      do { try action() }
      catch { failures.insert(.sessionActions); pending.append(action) }
    }
    endActions = pending
    if !failures.isEmpty { throw NativeCleanupFailure(steps: failures) }
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
    for text in [title, before, after] { try credentialGuard.check(Data(text.utf8)) }
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
      response.choices.count == 1,
      let content = response.choices.first?.message.content, content.utf8.count <= 1024,
      let output = context.objectForKeyedSubscript("nativeAutocompleteResult")?
        .call(withArguments: [before, content])?.toString(), context.exception == nil
    else {
      throw NativeAIError.unavailable
    }
    try credentialGuard.check(Data(output.utf8))
    try files?.save(output)
    return output
  }

  public func chat(
    _ input: NativeChatInput, reference: NativeCredentialReference,
    onText: @escaping @MainActor (String) -> Void
  ) async throws -> String {
    guard chatFixture else { throw NativeChatError.unavailable }
    let body = try nativeChatPrepared(input)
    guard isCurrent(reference), let key = try store.load() else { throw NativeAIError.expired }
    let url = URL(string: "https://openrouter.ai/api/v1/chat/completions")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.httpBody = Data(body.utf8)
    request.timeoutInterval = 30
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
    guard let session = providerSession(timeout: request.timeoutInterval) else {
      throw NativeChatError.unavailable
    }
    let id = UUID()
    sessions[id] = session
    defer {
      sessions.removeValue(forKey: id)
      session.invalidateAndCancel()
    }
    do {
      guard isCurrent(reference), !Task.isCancelled else { throw NativeChatError.cancelled }
      let (bytes, response) = try await session.bytes(for: request)
      guard let http = response as? HTTPURLResponse, http.url == url, http.statusCode == 200,
        http.value(forHTTPHeaderField: "Content-Type")?.components(separatedBy: ";").first
          == "text/event-stream", http.value(forHTTPHeaderField: "Content-Encoding") == nil
      else { throw NativeChatError.uncertain }
      var wire = Data()
      var frame = Data()
      var output = ""
      var emitted = 0
      var done = false
      struct Delta: Decodable {
        struct Choice: Decodable {
          struct Content: Decodable { let content: String? }
          let delta: Content
        }
        let choices: [Choice]
      }
      for try await byte in bytes {
        try Task.checkCancellation()
        guard isCurrent(reference) else { throw NativeAIError.expired }
        wire.append(byte)
        frame.append(byte)
        guard wire.count <= 131072 else { throw NativeChatError.uncertain }
        guard frame.suffix(2) == Data([10, 10]) || frame.suffix(4) == Data([13, 10, 13, 10]) else {
          continue
        }
        try credentialGuard.check(wire)
        let lines = String(decoding: frame, as: UTF8.self).split(separator: "\n")
        frame.removeAll()
        let data = lines.filter { $0.hasPrefix("data:") }.map {
          $0.dropFirst(5).trimmingCharacters(in: .whitespacesAndNewlines)
        }.joined(separator: "\n")
        if data.isEmpty { continue }
        if data == "[DONE]" {
          done = true
          break
        }
        let event = try JSONDecoder().decode(Delta.self, from: Data(data.utf8))
        guard event.choices.count <= 1 else { throw NativeChatError.uncertain }
        output += event.choices.first?.delta.content ?? ""
        guard output.utf8.count <= 16000 else { throw NativeChatError.uncertain }
        try credentialGuard.check(Data(output.utf8))
        if let last = output.lastIndex(where: { $0.isWhitespace }) {
          let safe = String(output[...last])
          if safe.count > emitted {
            onText(safe)
            emitted = safe.count
          }
        }
      }
      guard done, isCurrent(reference), !Task.isCancelled else { throw NativeChatError.uncertain }
      try credentialGuard.check(Data(output.utf8))
      if output.count > emitted { onText(output) }
      return output
    } catch {
      if Task.isCancelled { throw NativeChatError.cancelled }
      throw NativeChatError.uncertain
    }
  }
  public func agent(state: String, reference: NativeCredentialReference) async throws -> String {
    guard agentFixture else { throw NativeAIError.unavailable }
    let body = try nativeAgentCall("nativeAgentRequest", [state])
    let data = try await request(
      path: "/api/v1/chat/completions", body: Data(body.utf8), reference: reference)
    guard data.count <= 16_384,
      let response = try? JSONDecoder().decode(Completion.self, from: data),
      let output = response.choices.first?.message.content, output.utf8.count <= 3000
    else { throw NativeAIError.rejected }
    try credentialGuard.check(Data(output.utf8))
    return output
  }

  public func generateImage(prompt: String) async throws -> NativeImageArtifact {
    guard imageFixture else { throw NativeImageError.unavailable }
    try credentialGuard.check(Data(prompt.utf8))
    guard let context = JSContext() else { throw NativeImageError.unavailable }
    context.evaluateScript(nativeGenerationScript)
    guard
      let prepared = context.objectForKeyedSubscript("nativeImageRequest")?.call(withArguments: [
        prompt
      ])?.toString(), context.exception == nil
    else { throw NativeImageError.invalid }
    let data = try await request(
      path: "/api/v1/images", body: Data(prepared.utf8), reference: credentialReference())
    struct Envelope: Decodable {
      struct Image: Decodable {
        let b64_json: String
        let media_type: String
      }
      let data: [Image]
    }
    guard let result = try? JSONDecoder().decode(Envelope.self, from: data), result.data.count == 1,
      result.data[0].media_type == "image/png"
    else { throw NativeImageError.invalid }
    return try NativeImageArtifact(base64: result.data[0].b64_json)
  }

  public func narrate(text: String, reference: NativeCredentialReference) async throws
    -> DeviceAudio
  {
    guard narrationFixture else { throw NativeAIError.unavailable }
    try credentialGuard.check(Data(text.utf8))
    let context = try narrationContext()
    guard
      let body = context.objectForKeyedSubscript("nativeNarrationRequest")?.call(withArguments: [
        text
      ])?.toString(), context.exception == nil
    else { throw NativeAIError.rejected }
    let data = try await request(
      path: "/api/v1/audio/speech", body: Data(body.utf8), reference: reference)
    return try DeviceAudio.pcm(data)
  }

  private func providerSession(timeout: TimeInterval) -> URLSession? {
    guard let config = configuration.copy() as? URLSessionConfiguration else { return nil }
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.urlCredentialStorage = nil
    config.urlCache = nil
    config.httpAdditionalHeaders = nil
    config.timeoutIntervalForResource = timeout
    return URLSession(configuration: config, delegate: NoProviderRedirects(), delegateQueue: nil)
  }

  private func request(path: String, body: Data?, reference: NativeCredentialReference) async throws
    -> Data
  {
    guard !ended, reference.generation == generation else { throw NativeAIError.expired }
    guard let key = try store.load(), hasKey else { throw NativeAIError.missingKey }
    guard
      ["/api/v1/key", "/api/v1/chat/completions"].contains(path)
        || (imageFixture && path == "/api/v1/images")
        || (narrationFixture && path == "/api/v1/audio/speech"),
      let url = URL(string: "https://openrouter.ai" + path)
    else { throw NativeAIError.unavailable }
    if let body { try credentialGuard.check(body) }
    var request = URLRequest(url: url)
    request.httpMethod = body == nil ? "GET" : "POST"
    request.httpBody = body
    request.timeoutInterval = path == "/api/v1/audio/speech" ? 180 : 30
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
    guard let session = providerSession(timeout: request.timeoutInterval) else {
      throw NativeAIError.unavailable
    }
    let id = UUID()
    sessions[id] = session
    defer {
      sessions.removeValue(forKey: id)
      session.invalidateAndCancel()
    }
    do {
      guard !ended, hasKey, reference.generation == generation else { throw NativeAIError.expired }
      let budget = path == "/api/v1/audio/speech" ? 5_760_000
        : path == "/api/v1/images" ? 3 << 20
        : (agentFixture && path == "/api/v1/chat/completions") ? 16_384 : 64 << 10
      let (bytes, response) = try await session.bytes(for: request)
      guard let http = response as? HTTPURLResponse, http.url == url,
        (200..<300).contains(http.statusCode),
        path != "/api/v1/audio/speech"
          || http.value(forHTTPHeaderField: "Content-Type")?.components(separatedBy: ";").first
            == "audio/pcm",
        http.value(forHTTPHeaderField: "Content-Encoding") == nil
      else { throw NativeAIError.unavailable }
      var data = Data()
      for try await byte in bytes {
        try Task.checkCancellation()
        guard isCurrent(reference) else { throw NativeAIError.expired }
        guard data.count < budget else { throw NativeAIError.rejected }
        data.append(byte)
      }
      try Task.checkCancellation()
      guard reference.generation == generation, !ended else { throw NativeAIError.expired }
      guard let http = response as? HTTPURLResponse else { throw NativeAIError.unavailable }
      guard http.url == url, (200..<300).contains(http.statusCode) else {
        throw NativeAIError.provider(http.statusCode)
      }
      if path == "/api/v1/audio/speech" { try credentialGuard.checkPCM(data) }
      else { try credentialGuard.check(data) }
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
