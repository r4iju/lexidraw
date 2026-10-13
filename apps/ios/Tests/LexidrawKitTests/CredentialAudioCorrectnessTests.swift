import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization
import Testing
@testable import LexidrawKit

private final class CorrectnessKey: TokenStore, @unchecked Sendable {
  var value: String?
  func load() throws -> String? { value }
  func save(_ token: String) throws { value = token }
  func delete() throws { value = nil }
}
private final class CorrectnessSpeech: URLProtocol, @unchecked Sendable {
  static let payload = Mutex(Data())
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    guard request.url?.absoluteString == "https://openrouter.ai/api/v1/audio/speech" else {
      client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
    }
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200,
      httpVersion: nil, headerFields: ["Content-Type": "audio/pcm"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Self.payload.withLock { $0 })
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
struct AudioNoiseRNG: RandomNumberGenerator { var s: UInt64; mutating func next() -> UInt64 { s &+= 0x9E3779B97F4A7C15; var z = s; z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9; z = (z ^ (z >> 27)) &* 0x94D049BB133111EB; return z ^ (z >> 31) } }
private func audioSpeechLike(_ n: Int, amp: Double, seed: UInt64) -> Data {
  var r = AudioNoiseRNG(s: seed); var out = Data(capacity: n * 2); var ph = 0.0
  for i in 0..<n {
    ph += 2 * .pi * (180 + 120 * sin(Double(i) / 9000)) / 24000
    let env = 0.5 + 0.5 * sin(Double(i) / 6000)
    let v = amp * env * (sin(ph) + 0.4 * sin(3 * ph) + 0.1 * Double.random(in: -1...1, using: &r))
    let s = Int16(max(-32768, min(32767, v)))
    out.append(UInt8(truncatingIfNeeded: s)); out.append(UInt8(truncatingIfNeeded: s >> 8))
  }
  return out
}
private func audioNoise(_ n: Int, seed: UInt64) -> Data { var r = AudioNoiseRNG(s: seed); return Data((0..<n*2).map { _ in UInt8.random(in: 0...255, using: &r) }) }

private final class CorrectnessApp: ClientTransport, Sendable {
  private let observed = Mutex<[HTTPRequest]>([])
  private let retained = Mutex<Data?>(nil)
  var requests: [HTTPRequest] { observed.withLock { $0 } }
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    #expect(baseURL.absoluteString == "https://lexidraw.test/api/trpc")
    #expect(request.headerFields[.authorization] == "Bearer lxd_audio_correctness_fixture")
    guard operationID == "deviceNarration.save" || operationID == "deviceNarration.saved" else {
      throw URLError(.unsupportedURL)
    }
    if let body {
      let bytes = try await Data(collecting: body, upTo: 2 << 20)
      let envelope = try #require(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
      let input = try #require(envelope["json"] as? [String: Any])
      let recording = try #require(input["recording"])
      let answer = try JSONSerialization.data(withJSONObject: ["result": ["data": ["json": ["id": "saved", "recording": recording]]]])
      retained.withLock { $0 = answer }
    }
    observed.withLock { $0.append(request) }
    let answer: Data? = operationID == "deviceNarration.saved" ? retained.withLock { $0 }
      : Data(#"{"result":{"data":{"json":{"id":"saved"}}}}"#.utf8)
    return (HTTPResponse(status: .ok), answer.map { HTTPBody($0) })
  }
}
@Suite(.serialized) @MainActor struct CredentialAudioCorrectnessTests {
  // Reviewer v3 synthetic 73-byte key, zlib level 6, then base64 / lowercase hex.
  private static let key = "sk-or-" + "v1-" + "88623221195b11a495e60601f6db7875ee5e699e959214c35ee3bdad737f8ba2"
  private static let echoes = ["eNoNyLsNgDAMBcCJIuXZ+DdOTJyGAgkk5idX3nu1+2kfmrsSEwEhCYwjpLRrx9KZ5iZVOyIqJAjHyTs455jGtjwH/c81E8k=", "78da0dc8bb0d80300c05c08922e5d9f8374e4c9c86020924e62757de7bb5fb691f9abb12130121098c23a4b46bc7d299e626553b222a2408c7c93b38e798c6b63c07fdcf3513c9"]
  private func setup(_ samples: Data) throws -> (NativeBYOK, NativeDeviceNarrationStore, URL, CorrectnessApp, NativeDeviceNarrationFlow) {
    CorrectnessSpeech.payload.withLock { $0 = samples }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [CorrectnessSpeech.self]
    let runtime = NativeBYOK(store: CorrectnessKey(), configuration: config, narrationFixture: true)
    try runtime.replaceKey(Self.key)
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    let files = NativeDeviceNarrationStore(directory: directory)
    let app = CorrectnessApp()
    let session = try #require(try Account(origin: TestServer.origin,
      store: InMemoryTokenStore("lxd_audio_correctness_fixture"), transport: app).restore())
    let flow = NativeDeviceNarrationFlow(account: "alice", document: "doc", runtime: runtime, files: files,
      available: true, save: { id, recording in
        try await session.saveDeviceNarration(recording, id: id, document: "doc")
      })
    return (runtime, files, directory, app, flow)
  }
  @Test func shortCompressedKnownKeyCannotCompleteCheckpointOrReachApp() async throws {
    for echo in Self.echoes {
      var samples = Data(echo.utf8)
      if samples.count % 2 != 0 { samples.append(0) }
      let (runtime, files, directory, app, flow) = try setup(samples)
      defer { try? FileManager.default.removeItem(at: directory) }
      try await flow.start(text: "Hello reader")
      #expect(flow.checkpoint?.status == "unknown")
      #expect(flow.checkpoint?.parts.allSatisfy { $0.output == nil } == true)
      let retained = try #require(try files.load())
      #expect(retained.parts.allSatisfy { $0.output == nil })
      await flow.sync()
      #expect(app.requests.isEmpty)
      // The independent supplied-key detector must also block the encoded form directly.
      let guarder = NativeCredentialGuard()
      try guarder.remember(Self.key)
      #expect(throws: NativeAIError.self) { try guarder.check(Data(echo.utf8)) }
      try runtime.removeKey()
    }
  }
  @Test func benignFiveSecondNoiseAndTwentySecondLoudPCMCanPersistReopenAndSyncWithoutKey() async throws {
    let fixtures = [audioNoise(5 * 24_000, seed: 3), audioSpeechLike(20 * 24_000, amp: 30_000, seed: 2)]
    for samples in fixtures {
      let (runtime, files, directory, app, flow) = try setup(samples)
      defer { try? FileManager.default.removeItem(at: directory) }
      try await flow.start(text: "Hello reader")
      #expect(flow.checkpoint?.status == "completed")
      let retained = try #require(try files.load()?.recording)
      let audio = try #require(retained.parts.first)
      #expect(Data(base64Encoded: audio.audio)?.dropFirst(44) == samples)
      #expect(audio.seconds == Double(samples.count) / 48_000)
      try runtime.removeKey()
      let session = try #require(try Account(origin: TestServer.origin,
        store: InMemoryTokenStore("lxd_audio_correctness_fixture"), transport: app).restore())
      let reopened = NativeDeviceNarrationFlow(account: "alice", document: "doc", runtime: runtime,
        files: files, available: true, save: { id, recording in
          try await session.saveDeviceNarration(recording, id: id, document: "doc")
        })
      try reopened.restore()
      #expect(try reopened.checkpoint?.recording?.validated().job(id: nil).parts.count == 1)
      await reopened.sync()
      #expect(reopened.checkpoint?.status == "saved")
      #expect(app.requests.count == 1)
      let saved = try #require(try await session.savedDeviceNarration(document: "doc"))
      #expect(saved.recording.job(id: saved.id).parts.first?.audio == audio.audio)
      #expect(Data(base64Encoded: saved.recording.parts[0].audio)?.dropFirst(44) == samples)
    }
  }
}
