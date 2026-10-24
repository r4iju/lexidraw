import Foundation
import HTTPTypes
import Observation
import OpenAPIRuntime

public struct NarrationQuote: Decodable, Sendable {
  public let periodId: String?
  public let maximum: Int64
  public let missing: Int
  public let cached: Int
  public let maxSeconds: Int
  public let revision: String
  public let version: String
  public let policy: String
}
public struct ProNarrationJob: Decodable, Sendable {
  public struct Part: Decodable, Sendable {
    public let text: String
    /// Base64 WAV, for recordings made on this device.
    public let audio: String?
    /// Server path of the WAV; Pro narration is fetched part by part.
    public let url: String?
    public let seconds: Double
    public init(text: String, audio: String? = nil, url: String? = nil, seconds: Double) {
      self.text = text
      self.audio = audio
      self.url = url
      self.seconds = seconds
    }
    var valid: Bool {
      guard seconds > 0, seconds <= 120 else { return false }
      switch (audio, url) {
      case (let audio?, nil): return audio.utf8.count <= 7_680_060
      case (nil, let url?): return url.hasPrefix("/api/narration/parts/") && url.count <= 200
      default: return false
      }
    }
  }
  public let id: String?
  public let state: String
  public let charged: Int64
  public let quote: Int64
  public let made: Int
  public let planned: Int
  public let parts: [Part]
  public let policy: String
  public var pending: Bool { ["reserved", "running"].contains(state) }
  public var retryable: Bool { ["refunded", "cancelled"].contains(state) }
  public func validated() throws -> Self {
    guard
      ["saved", "reserved", "running", "unknown", "settled", "refunded", "cancelled"].contains(
        state), quote >= 0, quote <= 9_007_199_254_740_991, charged >= 0, charged <= quote,
      (1...narrationPartLimit).contains(planned), made == parts.count, made <= planned,
      parts.allSatisfy(\.valid)
    else { throw NativeAIError.unavailable }
    return self
  }
}
/// The server plans at most 240 parts of up to 120 seconds each.
let narrationPartLimit = 240
private struct NarrationEnvelope<Value: Decodable>: Decodable {
  struct Result: Decodable {
    struct Body: Decodable { let json: Value }
    let data: Body
  }
  let result: Result
}
private struct NarrationPayload<Value: Encodable>: Encodable { let json: Value }
extension Session {
  public func narrationQuote(document: String) async throws -> NarrationQuote {
    struct Input: Encodable { let documentId: String }
    let result = try await narrationRPC(
      "narration.quote", method: .get, input: Input(documentId: document), as: NarrationQuote.self)
    guard result.maximum >= 0, result.maximum <= 9_007_199_254_740_991,
      (0...narrationPartLimit).contains(result.missing),
      (0...narrationPartLimit).contains(result.cached),
      result.maxSeconds <= narrationPartLimit * 120, result.revision.count == 64
    else { throw NativeAIError.unavailable }
    return result
  }
  public func generateNarration(document: String, key: String, quote: NarrationQuote) async throws
    -> ProNarrationJob
  {
    struct Input: Encodable {
      let documentId: String
      let idempotencyKey: String
      let acceptedMaximum: Int64
      let acceptedRevision: String
      let acceptedPeriod: String?
      let delivery = "url"
    }
    return try await narrationRPC(
      "narration.generate", method: .post,
      input: Input(
        documentId: document, idempotencyKey: key, acceptedMaximum: quote.maximum,
        acceptedRevision: quote.revision, acceptedPeriod: quote.periodId), as: ProNarrationJob.self
    ).validated()
  }
  public func narrationOperation(id: String) async throws -> ProNarrationJob {
    struct Input: Encodable {
      let id: String
      let delivery = "url"
    }
    return try await narrationRPC(
      "narration.operation", method: .get, input: Input(id: id), as: ProNarrationJob.self
    ).validated()
  }
  public func cancelNarration(id: String) async throws -> ProNarrationJob {
    struct Input: Encodable {
      let id: String
      let delivery = "url"
    }
    return try await narrationRPC(
      "narration.cancel", method: .post, input: Input(id: id), as: ProNarrationJob.self
    ).validated()
  }
  public func savedNarration(document: String) async throws -> ProNarrationJob {
    struct Input: Encodable {
      let documentId: String
      let delivery = "url"
    }
    return try await narrationRPC(
      "narration.saved", method: .get, input: Input(documentId: document), as: ProNarrationJob.self
    ).validated()
  }
  public func latestNarration(document: String) async throws -> String? {
    struct Input: Encodable { let documentId: String }
    struct Identity: Decodable { let id: String }
    return try await narrationRPC(
      "narration.latest", method: .get, input: Input(documentId: document),
      as: Optional<Identity>.self)?.id
  }
  /// One part's WAV, through the same guarded, authenticated transport as the API.
  func narrationPart(path: String) async throws -> Data {
    let (response, body) = try await connection.exchange(
      HTTPRequest(method: .get, scheme: nil, authority: nil, path: path), json: nil,
      operationID: "narration.part", baseURL: origin)
    guard (200..<300).contains(response.status.code), let body else {
      throw NativeAIError.unavailable
    }
    return try await Data(collecting: body, upTo: 5_760_044)
  }
  func narrationRPC<Input: Encodable, Value: Decodable>(
    _ procedure: String, method: HTTPRequest.Method, input: Input, as: Value.Type
  ) async throws -> Value {
    let data = try JSONEncoder().encode(NarrationPayload(json: input))
    try NativeCredentialGuard.shared.check(data)
    var path = "/" + procedure
    if method == .get {
      var c = URLComponents()
      c.path = path
      c.queryItems = [.init(name: "input", value: String(decoding: data, as: UTF8.self))]
      path = c.string ?? path
    }
    let request = HTTPRequest(method: method, scheme: nil, authority: nil, path: path)
    let (response, body) = try await connection.exchange(
      request, json: method == .post ? data : nil, operationID: procedure,
      baseURL: origin.appending(path: "api/trpc"))
    guard let body else { throw NativeAIError.unavailable }
    let result = try await Data(collecting: body, upTo: 64 << 20)
    try NativeCredentialGuard.shared.check(result)
    guard (200..<300).contains(response.status.code) else {
      if String(decoding: result, as: UTF8.self).contains(
        "Upload expired. Retry retained audio with a new upload identity.")
      {
        throw DeviceNarrationError.uploadExpired
      }
      throw NativeAIError.unavailable
    }
    return try JSONDecoder().decode(NarrationEnvelope<Value>.self, from: result).result.data.json
  }
}
func proAccessDenied(_ error: any Error) -> Bool {
  if let refusal = error as? Refusal { return [401, 403, 404].contains(refusal.status) }
  if case NativeAIError.expired = error { return true }
  return false
}

public enum ProReadState: Equatable, Sendable {
  case current, loading, stale(String), denied
}

@MainActor @Observable public final class NativeNarrationFlow {
  public private(set) var readState: ProReadState = .current
  public private(set) var cancellationUnconfirmed = false
  public enum State {
    case idle, loading
    case quote(NarrationQuote, String)
    case accepting(NarrationQuote, String)
    case acceptanceUncertain(NarrationQuote, String)
    case job(ProNarrationJob)
    case failed(String)
  }
  public private(set) var state: State = .idle
  private let session: Session
  private let document: String
  public init(session: Session, document: String) {
    self.session = session
    self.document = document
  }
  public func review() async {
    guard readState == .current else { return }
    if case .job(let job) = state, job.pending || job.state == "unknown" { return }
    if case .acceptanceUncertain = state { return }
    state = .loading
    do {
      guard try await session.powerPreference() == .pro else { throw NativeAIError.unavailable }
      state = .quote(try await session.narrationQuote(document: document), UUID().uuidString)
    } catch {
      state = .failed(
        "Pro narration is Coming soon or unavailable. Saved recordings remain free to play.")
    }
  }
  public func decline() { if case .quote = state { state = .idle } }
  public func accept() async {
    guard readState == .current else { return }
    let quote: NarrationQuote
    let key: String
    switch state {
    case .quote(let q, let k), .acceptanceUncertain(let q, let k):
      quote = q
      key = k
    default: return
    }
    state = .accepting(quote, key)
    do {
      state = .job(try await session.generateNarration(document: document, key: key, quote: quote))
    } catch { state = .acceptanceUncertain(quote, key) }
  }
  public func refresh() async {
    guard case .job(let job) = state, let id = job.id else { await restore(); return }
    readState = .loading
    do {
      _ = try session.aiHandle.existing()
      let updated = try await session.narrationOperation(id: id)
      _ = try session.aiHandle.existing()
      guard updated.id == id else { throw NativeAIError.unavailable }
      state = .job(updated)
      readState = .current
      if !updated.pending && updated.state != "unknown" { cancellationUnconfirmed = false }
    } catch { failedRead(error, message: "Narration status could not be refreshed. Displayed progress may be out of date.") }
  }
  public func restore() async {
    readState = .loading
    do {
      _ = try session.aiHandle.existing()
      if let id = try await session.latestNarration(document: document) {
        let job = try await session.narrationOperation(id: id)
        _ = try session.aiHandle.existing()
        guard job.id == id else { throw NativeAIError.unavailable }
        state = .job(job)
      } else if case .job = state { state = .idle }
      readState = .current
    } catch { failedRead(error, message: "Narration status could not be loaded. Retry status before starting new work.") }
  }
  public func cancel() async {
    guard case .job(let job) = state, let id = job.id else { return }
    cancellationUnconfirmed = true
    do {
      _ = try session.aiHandle.existing()
      let updated = try await session.cancelNarration(id: id)
      _ = try session.aiHandle.existing()
      guard updated.id == id else { throw NativeAIError.unavailable }
      state = .job(updated)
      readState = .current
      cancellationUnconfirmed = updated.pending || updated.state == "unknown"
    } catch { failedRead(error, message: "Cancellation could not be confirmed. Refresh status before assuming further work stopped.") }
  }
  private func failedRead(_ error: any Error, message: String) {
    if proAccessDenied(error) {
      state = .failed("Access to this narration is no longer available.")
      readState = .denied
      cancellationUnconfirmed = false
    } else {
      readState = .stale(message)
      if case .job = state { return }
      if case .acceptanceUncertain = state { return }
      state = .failed(message)
    }
  }
  public func saved() async {
    if case .accepting = state { return }
    if case .job(let job) = state, job.pending || job.state == "unknown" { await refresh(); return }
    if case .acceptanceUncertain = state { return }
    if case .job = state {} else { state = .loading }
    readState = .loading
    do {
      _ = try session.aiHandle.existing()
      let job = try await session.savedNarration(document: document)
      _ = try session.aiHandle.existing()
      state = .job(job)
      readState = .current
    } catch { failedRead(error, message: "Saved narration could not be loaded. Retry the read without regenerating.") }
  }
}
/// An authenticated downloaded recording, retained only while the listener owns it.
@MainActor public final class ProNarrationFiles {
  private let directory = FileManager.default.temporaryDirectory.appending(
    path: "pro-narration-" + UUID().uuidString)
  public init() {}
  /// Writes every part to a file, downloading linked parts from `session` a few at a time.
  public func recording(_ job: ProNarrationJob, from session: Session? = nil) async throws
    -> Recording
  {
    _ = try job.validated()
    guard !job.parts.isEmpty else { throw NativeAIError.unavailable }
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let directory = directory
    try await withThrowingTaskGroup(of: Void.self) { group in
      for (index, part) in job.parts.enumerated() {
        if index >= 4 { try await group.next() }
        group.addTask {
          let data: Data
          if let audio = part.audio, let decoded = Data(base64Encoded: audio) {
            data = decoded
          } else if let path = part.url, let session {
            data = try await session.narrationPart(path: path)
          } else {
            throw NativeAIError.unavailable
          }
          guard data.count >= 46, data.count <= 5_760_044, data.prefix(4) == Data("RIFF".utf8)
          else { throw NativeAIError.unavailable }
          try data.write(to: directory.appending(path: "\(index).wav"), options: .atomic)
        }
      }
      try await group.waitForAll()
    }
    return Recording(
      parts: job.parts.enumerated().map { index, part in
        Recording.Part(text: part.text, audio: directory.appending(path: "\(index).wav"), section: nil)
      })
  }
  public func clear() { try? FileManager.default.removeItem(at: directory) }
}

public struct NarrationPlayback: Sendable {
  public enum Source: Sendable { case pro, device }
  public let job: ProNarrationJob
  public let source: Source
  public let scope: String?
  public func resumeID(file: String) -> String {
    let prefix = switch source { case .pro: "pro"; case .device: "device" }
    return "\(prefix)." + (scope.map { $0 + "." } ?? "") + (job.id ?? file)
  }
  public init(job: ProNarrationJob, source: Source, scope: String? = nil) { self.job = job; self.source = source; self.scope = scope }
}
