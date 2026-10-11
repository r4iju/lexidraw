import Foundation
import Observation
import Synchronization
import Testing

@testable import LexidrawKit

private final class NarrationKey: TokenStore, @unchecked Sendable {
  var value: String?
  func load() throws -> String? { value }
  func save(_ token: String) throws { value = token }
  func delete() throws { value = nil }
}
private final class SpeechProbe: URLProtocol, @unchecked Sendable {
  static let requests = Mutex<[URLRequest]>([])
  static let delay = Mutex<Double>(0)
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.requests.withLock { $0.append(request) }
    DispatchQueue.global().asyncAfter(deadline: .now() + Self.delay.withLock { $0 }) { [self] in
      let response = HTTPURLResponse(
        url: request.url!, statusCode: 200, httpVersion: nil,
        headerFields: ["Content-Type": "audio/pcm"])!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: Data(repeating: 0, count: 48000))
      client?.urlProtocolDidFinishLoading(self)
    }
  }
  override func stopLoading() {}
}
@MainActor private final class ChunkReplacementObserver {
  let flow: NativeDeviceNarrationFlow
  let runtime: NativeBYOK
  var replaced = false
  init(flow: NativeDeviceNarrationFlow, runtime: NativeBYOK) {
    self.flow = flow
    self.runtime = runtime
  }
  func arm() {
    withObservationTracking { _ = flow.checkpoint } onChange: {
      Task(priority: .high) { @MainActor in
        if self.flow.checkpoint?.parts.first?.kind == .completed {
          do { try self.runtime.replaceKey("yield-replacement-narration-fixture"); self.replaced = true }
          catch { Issue.record("Fixture key replacement failed") }
        } else { self.arm() }
      }
    }
  }
}
@Suite(.serialized) @MainActor struct DeviceNarrationTests {
  @Test func directNativeSpeechUsesSharedJSCAndRetiredReferenceCannotDispatch() async throws {
    SpeechProbe.requests.withLock { $0 = [] }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [SpeechProbe.self]
    let runtime = NativeBYOK(store: NarrationKey(), configuration: config, narrationFixture: true)
    try runtime.replaceKey("native-narration-opaque-secret")
    let reference = try runtime.credentialReference()
    let audio = try await runtime.narrate(text: "Hello reader.", reference: reference)
    #expect(audio.seconds == 1)
    let request = try #require(SpeechProbe.requests.withLock { $0.first })
    #expect(request.url?.absoluteString == "https://openrouter.ai/api/v1/audio/speech")
    #expect(
      request.value(forHTTPHeaderField: "Authorization") == "Bearer native-narration-opaque-secret")
    #expect(!String(decoding: request.httpBody ?? Data(), as: UTF8.self).contains("opaque-secret"))
    try runtime.removeKey()
    await #expect(throws: NativeAIError.self) {
      _ = try await runtime.narrate(text: "Next", reference: reference)
    }
    #expect(SpeechProbe.requests.withLock { $0.count } == 1)
  }
  @Test func completedAudioSurvivesFailedSyncAndKeyRemovalAndLogoutClearsLocalScope() async throws {
    SpeechProbe.requests.withLock { $0 = [] }
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "286-tests-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [SpeechProbe.self]
    let runtime = NativeBYOK(store: NarrationKey(), configuration: config, narrationFixture: true)
    try runtime.replaceKey("native-completed-narration-key")
    var failed = true
    let files = NativeDeviceNarrationStore(directory: directory)
    let flow = NativeDeviceNarrationFlow(
      account: "alice", document: "doc", runtime: runtime, files: files, available: true,
      save: { _, _ in
        if failed { throw NativeAIError.unavailable }
        return "saved"
      })
    try await flow.start(text: "Hello reader")
    #expect(flow.checkpoint?.status == "completed")
    try runtime.removeKey()
    await flow.sync()
    #expect(flow.checkpoint?.status == "sync_failed")
    let reopened = NativeDeviceNarrationFlow(
      account: "alice", document: "doc", runtime: runtime, files: files, available: true,
      save: { _, _ in "saved" })
    try reopened.restore()
    failed = false
    await reopened.sync()
    #expect(reopened.checkpoint?.status == "saved")
    #expect(SpeechProbe.requests.withLock { $0.count } == 1)
    try runtime.endSession()
    #expect(try files.load() == nil)
    await #expect(throws: NativeAIError.self) { try await reopened.resume() }
  }

  @Test func duplicateControllersCannotCreateTwoPaidJobsInTheSameLocalScope() async throws {
    SpeechProbe.requests.withLock { $0 = [] }
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "286-concurrent-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [SpeechProbe.self]
    let runtime = NativeBYOK(store: NarrationKey(), configuration: config, narrationFixture: true)
    try runtime.replaceKey("native-concurrent-narration-key")
    let files = NativeDeviceNarrationStore(directory: directory)
    let first = NativeDeviceNarrationFlow(
      account: "alice", document: "doc", runtime: runtime, files: files, available: true,
      save: { _, _ in "saved" })
    let second = NativeDeviceNarrationFlow(
      account: "alice", document: "doc", runtime: runtime, files: files, available: true,
      save: { _, _ in "saved" })
    let one = Task { try await first.start(text: "Hello") }
    let two = Task { try await second.start(text: "Hello") }
    _ = await one.result
    _ = await two.result
    #expect(SpeechProbe.requests.withLock { $0.count } == 1)
  }

  @Test func lateConfirmedOutputResolvesRestoredUncertaintyWithoutAnotherRequest() async throws {
    SpeechProbe.requests.withLock { $0 = [] }
    SpeechProbe.delay.withLock { $0 = 0.2 }
    defer { SpeechProbe.delay.withLock { $0 = 0 } }
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "286-late-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [SpeechProbe.self]
    let runtime = NativeBYOK(store: NarrationKey(), configuration: config, narrationFixture: true)
    try runtime.replaceKey("native-late-narration-key")
    let files = NativeDeviceNarrationStore(directory: directory)
    let first = NativeDeviceNarrationFlow(
      account: "alice", document: "doc", runtime: runtime, files: files, available: true,
      save: { _, _ in "saved" })
    let running = Task { try await first.start(text: "Hello") }
    while SpeechProbe.requests.withLock({ $0.isEmpty }) { await Task.yield() }
    let second = NativeDeviceNarrationFlow(
      account: "alice", document: "doc", runtime: runtime, files: files, available: true,
      save: { _, _ in "saved" })
    try second.restore()
    try await second.resume()
    _ = await running.result
    let third = NativeDeviceNarrationFlow(
      account: "alice", document: "doc", runtime: runtime, files: files, available: true,
      save: { _, _ in "saved" })
    try third.restore()
    #expect(third.checkpoint?.recording != nil)
    #expect(SpeechProbe.requests.withLock { $0.count } == 1)
  }

  @Test func replacementAtCompletedChunkYieldRequiresExplicitResumeAndRetainsAudio() async throws {
    SpeechProbe.requests.withLock { $0 = [] }
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [SpeechProbe.self]
    let runtime = NativeBYOK(store: NarrationKey(), configuration: config, narrationFixture: true)
    try runtime.replaceKey("yield-original-narration-fixture")
    let flow = NativeDeviceNarrationFlow(account: "alice", document: "doc", runtime: runtime,
      files: NativeDeviceNarrationStore(directory: directory), available: true, save: { _, _ in "saved" })
    let observer = ChunkReplacementObserver(flow: flow, runtime: runtime)
    observer.arm()
    try await flow.start(text: String(repeating: "Hello reader. ", count: 60))
    #expect(observer.replaced)
    #expect(flow.checkpoint?.status == "paused")
    #expect(flow.checkpoint?.parts.first?.kind == .completed)
    #expect(flow.checkpoint?.parts.dropFirst().allSatisfy { $0.kind == .pending } == true)
    #expect(SpeechProbe.requests.withLock { $0.count } == 1)
    let retained = try #require(flow.checkpoint?.parts.first?.output)
    try await flow.resume()
    #expect(flow.checkpoint?.status == "completed")
    #expect(flow.checkpoint?.parts.first?.output?.audio == retained.audio)
    #expect(SpeechProbe.requests.withLock { requests in
      requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer yield-original-narration-fixture"
        && requests.dropFirst().allSatisfy {
          $0.value(forHTTPHeaderField: "Authorization") == "Bearer yield-replacement-narration-fixture"
        }
    })
  }

}
