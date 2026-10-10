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
    case quote(prompt: String, id: String, maximum: Int64, fixture: Bool)
    case generating
    case completed(NativeImageArtifact, String)
    case uploading(NativeImageArtifact, String)
    case syncFailed(NativeImageArtifact, String)
    case saved(NativeImageArtifact, URL)
    case failed(String)
  }
  public private(set) var state: State = .idle
  private let source: () async throws -> AIPowerPreference
  private let capability: () async throws -> ImageCapability
  private let generatePro: (String, String, Int64) async throws -> NativeImageArtifact
  private let generateBYOK: (String) async throws -> NativeImageArtifact
  private let save: (String, NativeImageArtifact) async throws -> URL
  private let files: NativeImageFileStore?
  public init(source: @escaping () async throws -> AIPowerPreference, capability: @escaping () async throws -> ImageCapability,
    generatePro: @escaping (String, String, Int64) async throws -> NativeImageArtifact,
    generateBYOK: @escaping (String) async throws -> NativeImageArtifact,
    save: @escaping (String, NativeImageArtifact) async throws -> URL, files: NativeImageFileStore? = nil) {
    self.source = source; self.capability = capability; self.generatePro = generatePro; self.generateBYOK = generateBYOK; self.save = save; self.files = files
    if let completed = try? files?.load() { state = .completed(completed, UUID().uuidString) }
  }
  public func decline() { if case .quote = state { state = .idle } }
  public func generate(_ prompt: String) async {
    switch state { case .generating, .uploading, .quote: return; default: break }
    do {
      try NativeCredentialGuard.shared.check(Data(prompt.utf8))
      guard !prompt.isEmpty, prompt.utf8.count <= 1500 else { throw NativeImageError.invalid }
      let selected = try await source(), config = try await capability()
      guard selected != .local, config.available else { throw NativeImageError.unavailable }
      if selected == .pro { state = .quote(prompt: prompt, id: UUID().uuidString, maximum: config.maximum, fixture: config.fixture); return }
      state = .generating
      try complete(await generateBYOK(prompt))
    } catch { state = .failed("Image generation is unavailable or failed. No fallback or automatic regeneration occurred.") }
  }
  public func accept() async {
    guard case .quote(let prompt, let id, let maximum, _) = state else { return }
    state = .generating
    do {
      let selected = try await source(), config = try await capability()
      guard selected == .pro, config.available, config.maximum == maximum else { throw NativeImageError.unavailable }
      try complete(await generatePro(prompt, id, maximum))
    } catch { state = .failed("Image failed or is reconciling. Check Pro history before a new generation.") }
  }
  private func complete(_ image: NativeImageArtifact) throws {
    let validated = try image.validated()
    // A local file failure still leaves the safe paid result in session memory.
    try? files?.save(validated)
    state = .completed(validated, UUID().uuidString)
  }
  public func upload() async -> URL? {
    let image: NativeImageArtifact, id: String
    switch state {
    case .completed(let result, let identity), .syncFailed(let result, let identity): image = result; id = identity
    case .saved(_, let url): return url
    default: return nil
    }
    state = .uploading(image, id)
    do {
      let url = try await save(id, image.validated())
      guard url.scheme == "https" else { throw NativeImageError.invalid }
      state = .saved(image, url)
      try? files?.clear()
      return url
    } catch NativeImageError.uploadExpired { state = .syncFailed(image, UUID().uuidString); return nil }
    catch { state = .syncFailed(image, id); return nil }
  }
}
