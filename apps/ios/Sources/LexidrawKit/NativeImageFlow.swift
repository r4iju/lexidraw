import Foundation
import Observation

public struct ImageCapability: Decodable, Sendable {
  public let available: Bool
  public let maximum: Int64
  public let fixture: Bool
  public let reason: String
  public init(available: Bool, maximum: Int64, fixture: Bool, reason: String) { self.available = available; self.maximum = maximum; self.fixture = fixture; self.reason = reason }
}
@MainActor @Observable public final class NativeImageFlow {
  public enum State {
    case idle
    case admitting
    case quote(prompt: String, id: String, maximum: Int64, fixture: Bool)
    case uncertain
    case generating
    case completed(NativeImageArtifact, String)
    case uploading(NativeImageArtifact, String)
    case syncFailed(NativeImageArtifact, String)
    case saved(NativeImageArtifact, URL)
    case failed(String)
  }
  public private(set) var state: State = .idle
  public private(set) var checkpoint: NativeImageCheckpoint?
  public private(set) var durable = false
  public private(set) var pendingGeneration: NativeImagePending?
  private let readPro: ((String) async throws -> NativeImageOperation?)?
  private let cancelPro: ((String) async throws -> NativeImageOperation)?
  private var admittedPrompt = ""
  private let source: () async throws -> AIPowerPreference
  private let capability: () async throws -> ImageCapability
  private let generatePro: (String, String, Int64) async throws -> NativeImageOperation
  private let generateBYOK: (String) async throws -> NativeImageArtifact
  private let save: (String, NativeImageArtifact) async throws -> URL
  private var intent = UUID()
  private var ended = false
  private let ownerCurrent: () -> Bool
  private let document: String?
  private let files: NativeImageFileStore?
  public init(source: @escaping () async throws -> AIPowerPreference, capability: @escaping () async throws -> ImageCapability,
    generatePro: @escaping (String, String, Int64) async throws -> NativeImageOperation,
    generateBYOK: @escaping (String) async throws -> NativeImageArtifact,
    save: @escaping (String, NativeImageArtifact) async throws -> URL, files: NativeImageFileStore? = nil, readPro: ((String) async throws -> NativeImageOperation?)? = nil, cancelPro: ((String) async throws -> NativeImageOperation)? = nil, document: String? = nil, ownerCurrent: @escaping () -> Bool = { true }) {
    self.cancelPro = cancelPro; self.readPro = readPro; self.source = source; self.capability = capability; self.generatePro = generatePro; self.generateBYOK = generateBYOK; self.save = save; self.files = files; self.document = document; self.ownerCurrent = ownerCurrent
    do {
      pendingGeneration = try files?.loadPending()
      if let restored = try files?.loadCheckpoint() {
        checkpoint = restored; admittedPrompt = restored.prompt; durable = true
        if let receipt = restored.receipt { state = .saved(restored.image, receipt.url) }
        else { state = .completed(restored.image, restored.uploadKey) }
      } else if let pendingGeneration {
        admittedPrompt = pendingGeneration.prompt; state = .uncertain
      }
    } catch { state = .uncertain }

  }
  public func decline() { if case .quote = state { state = .idle } }
  public func end() { ended = true; intent = UUID() }
  private func current(_ id: UUID) -> Bool { !ended && intent == id && ownerCurrent() }
  public func generate(_ prompt: String) async {
    guard !ended, ownerCurrent() else { return }
    switch state { case .admitting, .generating, .uploading, .quote, .uncertain: return; default: break }
    if files != nil, checkpoint != nil { return }
    let retained = state
    let invocation = UUID(); intent = invocation
    admittedPrompt = prompt
    state = .admitting
    do {
      try NativeCredentialGuard.shared.check(Data(prompt.utf8))
      guard !prompt.isEmpty, prompt.utf8.count <= 1500 else { throw NativeImageError.invalid }
      let selected = try await source()
      guard current(invocation) else { return }
      let config = try await capability()
      guard current(invocation) else { return }
      guard selected != .local, config.available else { throw NativeImageError.unavailable }
      if selected == .pro { state = .quote(prompt: prompt, id: UUID().uuidString, maximum: config.maximum, fixture: config.fixture); return }
      try beginPending(key: UUID().uuidString, prompt: prompt, source: "byok")
      state = .generating
      let image = try await generateBYOK(prompt)
      guard current(invocation) else { return }
      try complete(image)
    } catch { guard current(invocation) else { return }; switch retained { case .completed, .syncFailed, .saved: state = retained; return; default: break }; state = pendingGeneration == nil ? .failed("Image generation is unavailable or failed. No fallback or automatic regeneration occurred.") : .uncertain }
  }
  public func accept() async {
    guard !ended, ownerCurrent(), case .quote(let prompt, let id, let maximum, _) = state else { return }
    let invocation = UUID(); intent = invocation
    state = .generating
    do {
      let selected = try await source()
      guard current(invocation) else { return }
      let config = try await capability()
      guard current(invocation) else { return }
      guard selected == .pro, config.available, config.maximum == maximum else { throw NativeImageError.unavailable }
      try beginPending(key: id, prompt: prompt, source: "pro")
      let operation = try await generatePro(prompt, id, maximum)
      guard current(invocation) else { return }
      try receive(operation)
    } catch { guard current(invocation) else { return }; state = pendingGeneration == nil ? .failed("Image admission failed before generation.") : .uncertain }
  }
  private func beginPending(key: String, prompt: String, source: String) throws {
    let value = NativeImagePending(version: 1, key: key, prompt: prompt, source: source)
    if let files { try files.savePending(value) }
    pendingGeneration = value
  }
  public func recover() async {
    guard !ended, ownerCurrent(), case .uncertain = state, let pendingGeneration,
      pendingGeneration.source == "pro", let readPro else { return }
    let invocation = UUID(); intent = invocation
    do {
      let operation = try await readPro(pendingGeneration.key)
      guard current(invocation), let operation else { return }
      admittedPrompt = pendingGeneration.prompt
      try receive(operation)
    } catch { /* An owned read cannot dispatch or erase an uncertain generation. */ }
  }
  private func receive(_ operation: NativeImageOperation) throws {
    let image = try operation.artifact()
    guard var pending = pendingGeneration else { throw NativeImageError.invalid }
    if let known = pending.operation, known.id != operation.id { throw NativeImageError.invalid }
    pending.operation = NativeImageOperation(id: operation.id, state: operation.state, result: nil)
    pendingGeneration = pending
    try files?.savePending(pending)
    if let image { try complete(image) }
    else { state = .uncertain }
  }
  public func cancel() async {
    guard !ended, ownerCurrent(), let operation = pendingGeneration?.operation, let cancelPro else { return }
    let invocation = UUID(); intent = invocation
    do {
      let result = try await cancelPro(operation.id)
      guard current(invocation), result.id == operation.id else { return }
      try receive(result)
    } catch { /* Cancellation cannot release an uncertain paid fence. */ }
  }
  private func complete(_ image: NativeImageArtifact) throws {
    let validated = try image.validated()
    var value = NativeImageCheckpoint(version: 2, image: validated, uploadKey: UUID().uuidString, prompt: admittedPrompt, receipt: nil)
    value.generationKey = pendingGeneration?.key
    value.operationID = pendingGeneration?.operation?.id
    checkpoint = value
    persistCheckpoint()
    state = .completed(validated, value.uploadKey)
  }
  private func persistCheckpoint() {
    durable = false
    do { if let files, let checkpoint { try files.saveCheckpoint(checkpoint, expectedUploadKey: checkpoint.uploadKey); try files.clearPending(); pendingGeneration = nil; durable = true } } catch {}
  }
  public func retryCheckpoint() { guard !ended, ownerCurrent() else { return }; persistCheckpoint() }
  private func acknowledge(_ url: URL, confirm: ((URL, String) async throws -> DocumentSaveReceipt?)?) async {
    guard let confirm, let checkpoint else { return }
    let invocation = intent
    do {
      guard let receipt = try await confirm(url, checkpoint.prompt), current(invocation),
        document == nil || receipt.document == document, receipt.containsImage(url) else { return }
      try files?.clearCheckpoint(expectedUploadKey: checkpoint.uploadKey)
      self.checkpoint = nil
      durable = false
    } catch { /* The retained file and upload receipt remain retryable. */ }
  }
  public func upload(confirm: ((URL, String) async throws -> DocumentSaveReceipt?)? = nil) async -> URL? {
    guard !ended, ownerCurrent() else { return nil }
    let image: NativeImageArtifact, id: String
    switch state {
    case .completed(let result, let identity), .syncFailed(let result, let identity): image = result; id = identity
    case .saved(_, let url):
      await acknowledge(url, confirm: confirm)
      return current(intent) ? url : nil
    default: return nil
    }
    if files != nil, !durable { persistCheckpoint(); guard durable else { return nil } }
    let invocation = UUID(); intent = invocation
    state = .uploading(image, id)
    do {
      let url = try await save(id, image.validated())
      guard current(invocation) else { return nil }
      guard url.scheme == "https" else { throw NativeImageError.invalid }
      state = .saved(image, url)
      checkpoint?.receipt = NativeImageReceipt(id: url.lastPathComponent, url: url)
      persistCheckpoint()
      await acknowledge(url, confirm: confirm)
      return current(invocation) ? url : nil
    } catch NativeImageError.uploadExpired {
      guard current(invocation) else { return nil }
      guard let previous = checkpoint else { state = .syncFailed(image, id); return nil }
      var rotated = NativeImageCheckpoint(version: previous.version, image: previous.image, uploadKey: UUID().uuidString, prompt: previous.prompt, receipt: nil)
      rotated.generationKey = previous.generationKey
      rotated.operationID = previous.operationID
      do { try files?.saveCheckpoint(rotated, expectedUploadKey: previous.uploadKey); checkpoint = rotated; state = .syncFailed(image, rotated.uploadKey) }
      catch { state = .syncFailed(image, id) }
      return nil
    }
    catch { guard current(invocation) else { return nil }; state = .syncFailed(image, id); return nil }
  }
}
