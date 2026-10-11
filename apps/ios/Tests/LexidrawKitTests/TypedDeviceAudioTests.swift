import Foundation
import Synchronization
import Testing
@testable import LexidrawKit

private final class BinaryAudioKey: TokenStore, @unchecked Sendable {
  var value: String?
  func load() throws -> String? { value }
  func save(_ token: String) throws { value = token }
  func delete() throws { value = nil }
}
private final class BinarySpeechProbe: URLProtocol, @unchecked Sendable {
  static let compressed = Mutex(false)
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    var headers = ["Content-Type": "audio/pcm"]
    if Self.compressed.withLock({ $0 }) { headers["Content-Encoding"] = "gzip" }
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: headers)!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data([0, 0, 0x1f, 0x8b, 8, 0, 0, 0]))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
@Suite(.serialized) @MainActor struct TypedDeviceAudioTests {
  @Test(arguments: [[UInt8](arrayLiteral: 0, 0, 0x1f, 0x8b, 8, 0, 0, 0), [0, 0, 0x50, 0x4b, 3, 4, 0, 0], [0, 0, 0x50, 0x4b, 3, 4, 0, 0] + Array(repeating: 0, count: 40)])
  func incidentalCompressionSignaturesAreSamplesInValidatedPCMAndCanonicalWAV(samples: [UInt8]) throws {
    let result = try DeviceAudio.pcm(Data(samples))
    let validated = try result.validated()
    #expect(validated.seconds == Double(samples.count) / 48_000)
    #expect(Data(base64Encoded: result.audio)?.suffix(samples.count) == Data(samples))
  }
  @Test func typedAudioPreservesRawAndEncodedCredentialEchoAndContainerRejection() throws {
    let secret = "typed-binary-credential-echo-291"
    try NativeCredentialGuard.shared.remember(secret)
    for text in [secret, Data(secret.utf8).base64EncodedString()] {
      var bytes = Data(text.utf8)
      if bytes.count % 2 != 0 { bytes.append(0) }
      #expect(throws: NativeAIError.self) { try DeviceAudio.pcm(bytes) }
    }
    #expect(throws: NativeAIError.self) { try NativeCredentialGuard.shared.check(Data([0, 0, 0x1f, 0x8b, 8, 0, 0, 0])) }
    #expect(throws: NativeAIError.self) { try DeviceAudio.pcm(Data([1, 2, 3])) }
    let compressed = #"{"audio":"H4sIAAAAAAA=","seconds":1}"#
    let audio = try JSONDecoder().decode(DeviceAudio.self, from: Data(compressed.utf8))
    #expect(throws: NativeAIError.self) { try audio.validated() }
  }
  @Test func canonicalSampleAudioPersistsAndRestoresThroughGuardedCheckpoint() async throws {
    BinarySpeechProbe.compressed.withLock { $0 = false }
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [BinarySpeechProbe.self]
    let runtime = NativeBYOK(store: BinaryAudioKey(), configuration: config, narrationFixture: true)
    try runtime.replaceKey("typed-native-retained-audio-291")
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let files = NativeDeviceNarrationStore(directory: directory)
    let app = FakeServer { request in
      #expect(request.authorization == "Bearer lxd_incidental_audio_fixture")
      #expect(request.url.path == "/api/trpc/deviceNarration.save")
      #expect(!String(decoding: request.body ?? Data(), as: UTF8.self).contains("typed-native-retained-audio-291"))
      return (200, #"{"result":{"data":{"json":{"id":"saved"}}}}"#)
    }
    let session = try #require(try Account(origin: TestServer.origin, store: InMemoryTokenStore("lxd_incidental_audio_fixture"), transport: app).restore())
    let save: (String, DeviceRecording) async throws -> String = { id, recording in
      try await session.saveDeviceNarration(recording, id: id, document: "doc")
    }
    let flow = NativeDeviceNarrationFlow(account: "alice", document: "doc", runtime: runtime, files: files, available: true, save: save)
    try await flow.start(text: "Hello")
    #expect(flow.checkpoint?.status == "completed")
    let restored = NativeDeviceNarrationFlow(account: "alice", document: "doc", runtime: runtime, files: files, available: true, save: save)
    try restored.restore()
    #expect(restored.checkpoint?.recording?.parts.count == 1)
    try runtime.removeKey()
    await restored.sync()
    #expect(restored.checkpoint?.status == "saved")
    #expect(app.requests.count == 1)
  }
  @Test func providerTransportAdmitsDeclaredRawPCMAndRejectsCompressedEnvelope() async throws {
    BinarySpeechProbe.compressed.withLock { $0 = false }
    let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [BinarySpeechProbe.self]
    let runtime = NativeBYOK(store: BinaryAudioKey(), configuration: config, narrationFixture: true)
    try runtime.replaceKey("typed-native-audio-fixture-291")
    let audio = try await runtime.narrate(text: "Hello", reference: runtime.credentialReference())
    #expect(Data(base64Encoded: audio.audio)?.suffix(8) == Data([0, 0, 0x1f, 0x8b, 8, 0, 0, 0]))
    BinarySpeechProbe.compressed.withLock { $0 = true }
    await #expect(throws: NativeAIError.self) { try await runtime.narrate(text: "Hello", reference: runtime.credentialReference()) }
  }
}
