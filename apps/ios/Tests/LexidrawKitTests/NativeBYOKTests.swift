import Foundation
import HTTPTypes
import Synchronization
import Testing

@testable import LexidrawKit

private final class ProviderProbe: URLProtocol, @unchecked Sendable {
  private struct State: Sendable {
    var requests: [URLRequest] = []
    var status = 200
    var hold = false
    var response = ""
  }
  private static let state = Mutex(State())
  static var requests: [URLRequest] {
    get { state.withLock { $0.requests } }
    set { state.withLock { $0.requests = newValue } }
  }
  static var status: Int {
    get { state.withLock { $0.status } }
    set { state.withLock { $0.status = newValue } }
  }
  static var hold: Bool {
    get { state.withLock { $0.hold } }
    set { state.withLock { $0.hold = newValue } }
  }
  static var response: String {
    get { state.withLock { $0.response } }
    set { state.withLock { $0.response = newValue } }
  }
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    Self.requests.append(request)
    if Self.hold { return }
    let headers = Self.status == 302 ? ["Location": "https://lexidraw.vercel.app/leak"] : [:]
    let response = HTTPURLResponse(url: request.url!, statusCode: Self.status, httpVersion: nil, headerFields: headers)!
    if Self.status == 302 {
      var redirected = request
      redirected.url = URL(string: "https://lexidraw.vercel.app/leak")!
      client?.urlProtocol(self, wasRedirectedTo: redirected, redirectResponse: response)
    }
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(Self.response.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
private final class DeviceKey: TokenStore, @unchecked Sendable {
  var value: String?
  func load() throws -> String? { value }
  func save(_ token: String) throws { value = token }
  func delete() throws { value = nil }
}

@Suite(.serialized) @MainActor struct NativeBYOKTests {
  @Test func nativeTracerKeepsCredentialOutOfBridgeAndCallsOnlyProvider() async throws {
    ProviderProbe.requests = []
    ProviderProbe.status = 200
    ProviderProbe.response = #"{"choices":[{"message":{"content":"language grows"}}]}"#
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [ProviderProbe.self]
    let byok = NativeBYOK(store: DeviceKey(), configuration: config)
    try byok.replaceKey("sk-or-v1-native-distinctive-fake-key")
    let result = try await byok.suggest(title: "Language", before: "A langu", after: "")
    #expect(result == "age grows")
    #expect(ProviderProbe.requests.count == 1)
    let request = try #require(ProviderProbe.requests.first)
    #expect(request.url?.absoluteString == "https://openrouter.ai/api/v1/chat/completions")
    #expect(
      request.value(forHTTPHeaderField: "Authorization")
        == "Bearer sk-or-v1-native-distinctive-fake-key")
    #expect(
      !String(decoding: request.httpBody ?? Data(), as: UTF8.self).contains("distinctive-fake-key"))
    #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
  }
  @Test(arguments: ["body", "header", "query", "encoded", "outside", "upload"])
  func appAndUploadEgressBlocksConfiguredKeysBeforeDispatch(channel: String) async throws {
    let secret = "native-test-key-with-unusual-format"
    let byok = NativeBYOK(store: DeviceKey())
    try byok.replaceKey(secret)
    let server = FakeServer { _ in (200, "{}") }
    let session = try TestServer.session(server)
    let payload = channel == "encoded" ? Data(secret.utf8).base64EncodedString() : secret
    await #expect(throws: NativeAIError.self) {
      if channel == "upload" {
        _ = try await session.uploadVideo(
          Data(payload.utf8), in: "n1",
          send: { _, _ in
            Issue.record("Credential was dispatched to storage")
            return 200
          })
      } else if channel == "outside" {
        _ = try await session.connection.sendOutside(
          Data(payload.utf8), method: .put,
          to: URL(string: "https://owned-bucket.test/upload")!, headers: [:])
      } else {
        var request = HTTPRequest(
          method: .post, scheme: nil, authority: nil,
          path: channel == "query" ? "/diagnostic?value=" + payload : "/diagnostic")
        if channel == "header" { request.headerFields[HTTPField.Name("x-diagnostic")!] = payload }
        try await session.connection.send(
          request,
          json: Data((channel == "body" || channel == "encoded" ? payload : "{}").utf8),
          operationID: "diagnostic")
      }
    }
    #expect(server.requests.count == 0)
  }

  @Test func signingOutDeletesDeviceKeyAndExpiresQueuedWork() async throws {
    let keys = DeviceKey()
    let server = FakeServer { request in
      request.url.path == "/api/v1/me"
        ? (200, #"{"userId":"reader","email":null,"name":null,"authKind":"token","scope":"write"}"#)
        : (200, #"{"id":"token"}"#)
    }
    let account = Account(
      origin: TestServer.origin, store: InMemoryTokenStore("lxd_reader"),
      transport: server,
      providerKeyStore: { id in
        #expect(id == "reader")
        return keys
      })
    let session = try #require(try account.restore())
    let byok = try await session.nativeAI()
    try byok.replaceKey("native-session-secret")
    let reference = try byok.credentialReference()
    _ = try await session.signOut()
    #expect(keys.value == nil)
    await #expect(throws: NativeAIError.self) {
      try await byok.suggest(title: "", before: "", after: "", reference: reference)
    }
    await #expect(throws: NativeAIError.self) { try await session.nativeAI() }
  }

  @Test func preferenceSyncSendsOnlyModeAndProviderWithTheAppToken() async throws {
    let server = FakeServer { request in
      if request.method == .get {
        return (200, #"{"result":{"data":{"json":{"mode":"byok","provider":"openrouter"}}}}"#)
      }
      return (200, #"{"result":{"data":{"json":null}}}"#)
    }
    let session = try TestServer.session(server)
    #expect(try await session.powerPreference() == .byok)
    try await session.setPowerPreference(.local)
    #expect(
      server.requests.map { $0.url.path } == [
        "/api/trpc/auth.getPowerPreference", "/api/trpc/auth.setPowerPreference",
      ])
    #expect(server.requests.allSatisfy { $0.authorization == "Bearer lxd_kept" })
    #expect(server.requests.last?.object["json"] as? [String: String] == ["mode": "local"])
  }

  @Test func escapedJSONCannotUploadAConfiguredKey() async throws {
    let byok = NativeBYOK(store: DeviceKey())
    try byok.replaceKey("unusual-credential-escape-probe")
    let server = FakeServer { _ in (200, "{}") }
    let session = try TestServer.session(server)
    await #expect(throws: NativeAIError.self) {
      try await session.connection.send(
        HTTPRequest(method: .post, scheme: nil, authority: nil, path: "/telemetry"),
        json: Data(#"{"metadata":"unusual\u002dcredential\u002descape\u002dprobe"}"#.utf8),
        operationID: "telemetry")
    }
    #expect(server.requests.count == 0)
  }

  @Test(arguments: [200, 302, 401])
  func validationRefusesMalformedRepliesRedirectsAndProviderFailures(status: Int) async throws {
    ProviderProbe.requests = []
    ProviderProbe.status = status
    ProviderProbe.response = "{}"
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [ProviderProbe.self]
    let byok = NativeBYOK(store: DeviceKey(), configuration: config)
    try byok.replaceKey("validation-credential-native")
    await #expect(throws: NativeAIError.self) { try await byok.validate() }
    #expect(ProviderProbe.requests.count == 1)
    #expect(ProviderProbe.requests.first?.url?.absoluteString == "https://openrouter.ai/api/v1/key")
    #expect(ProviderProbe.requests.first?.httpMethod == "GET")
    #expect(ProviderProbe.requests.first?.httpBody == nil)
    ProviderProbe.status = 200
    ProviderProbe.response =
      #"{"data":{"is_free_tier":false,"is_management_key":false,"limit_remaining":10}}"#
    try await byok.validate()
  }

  @Test func cancellationStopsTheNativeRequestAndReportsCancellation() async throws {
    ProviderProbe.requests = []
    ProviderProbe.hold = true
    defer { ProviderProbe.hold = false }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [ProviderProbe.self]
    let byok = NativeBYOK(store: DeviceKey(), configuration: config)
    try byok.replaceKey("cancellation-native-credential")
    let task = Task { try await byok.suggest(title: "", before: "A ", after: "") }
    for _ in 0..<1000 {
      if !ProviderProbe.requests.isEmpty { break }
      try await Task.sleep(for: .milliseconds(1))
    }
    #expect(ProviderProbe.requests.count == 1)
    byok.cancel()
    do {
      _ = try await task.value
      Issue.record("Cancelled request returned a suggestion")
    } catch { #expect(error.localizedDescription == NativeAIError.cancelled.localizedDescription) }
  }

  @Test func rawNetworkErrorsCannotExposeConfiguredKeysToDiagnostics() async throws {
    let secret = "network-error-native-credential"
    let byok = NativeBYOK(store: DeviceKey())
    try byok.replaceKey(secret)
    let server = FakeServer { _ in
      throw NSError(
        domain: "Transport", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Request failed: " + secret])
    }
    let session = try TestServer.session(server)
    do {
      try await session.connection.send(
        HTTPRequest(method: .post, scheme: nil, authority: nil, path: "/diagnostic"),
        json: Data("{}".utf8), operationID: "diagnostic")
      Issue.record("Expected network failure")
    } catch {
      #expect(!error.localizedDescription.contains(secret))
      #expect(error is NativeAIError)
    }
  }

  @Test func signedInTracerUsesNativeProviderTransportWithoutAProOperation() async throws {
    ProviderProbe.requests = []
    ProviderProbe.status = 200
    ProviderProbe.response = #"{"choices":[{"message":{"content":"language grows"}}]}"#
    let server = FakeServer { _ in
      (
        200,
        #"{"userId":"native-reader","email":null,"name":null,"authKind":"token","scope":"write"}"#
      )
    }
    let account = Account(
      origin: TestServer.origin, store: InMemoryTokenStore("lxd_native_reader"),
      transport: server, providerKeyStore: { _ in DeviceKey() },
      providerConfiguration: {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [ProviderProbe.self]
        return config
      })
    let session = try #require(try account.restore())
    let runtime = try await session.nativeAI()
    try runtime.replaceKey("signed-in-native-provider-credential")
    #expect(try await runtime.suggest(title: "", before: "langu", after: "") == "age grows")
    #expect(server.requests.count == 1)
    #expect(server.requests.first?.url.path == "/api/v1/me")
    #expect(ProviderProbe.requests.count == 1)
    #expect(
      ProviderProbe.requests.first?.value(forHTTPHeaderField: "Authorization")
        == "Bearer signed-in-native-provider-credential")
  }

  @Test func signingOutAfterRelaunchRemovesThePersistedDeviceKey() async throws {
    let accountID = "native-keychain-test-" + UUID().uuidString
    let tokens = InMemoryTokenStore("lxd_keychain_test_" + accountID)
    let server = FakeServer { request in
      request.url.path == "/api/v1/me"
        ? (200, "{\"userId\":\"" + accountID + "\",\"email\":null,\"name\":null,\"authKind\":\"token\",\"scope\":\"write\"}")
        : (200, #"{"id":"token"}"#)
    }
    let account = Account(origin: TestServer.origin, store: tokens, transport: server)
    let first = try #require(try account.restore())
    let runtime = try await first.nativeAI()
    try runtime.replaceKey("keychain-relaunch-native-credential")
    defer { try? runtime.removeKey() }
    let relaunched = try #require(try account.restore())
    _ = try await relaunched.signOut()
    try tokens.save("lxd_keychain_test_" + accountID)
    let signedInAgain = try #require(try account.restore())
    let fresh = try await signedInAgain.nativeAI()
    #expect(!fresh.hasKey)
  }

  @Test func completedTextIsKeptLocallyWithoutCredentialMaterialAndClearedOnLogout() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: "native-text-test-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [ProviderProbe.self]
    ProviderProbe.requests = []
    ProviderProbe.status = 200
    ProviderProbe.response = #"{"choices":[{"message":{"content":"language grows"}}]}"#
    let files = NativeTextFileStore(directory: directory)
    let runtime = NativeBYOK(store: DeviceKey(), configuration: config, files: files)
    try runtime.replaceKey("local-file-native-credential")
    _ = try await runtime.suggest(title: "", before: "langu", after: "")
    #expect(try files.load() == "age grows")
    let records = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
    #expect(records.count == 1)
    let bytes = try Data(contentsOf: #require(records.first))
    #expect(!String(decoding: bytes, as: UTF8.self).contains("local-file-native-credential"))
    try runtime.endSession()
    #expect(try files.load() == nil)
  }

  @Test(arguments: ["OpenAI", "Anthropic", "OpenRouter"],
    ["nested-uri-base64", "nested-json", "hex", "unicode", "html"])
  func serializedRetiredCredentialsNeverReachAppUploadOrBridge(provider: String, encoding: String) async throws {
    let secret = "fake-" + provider + "-boundary!retired@value:279"
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [ProviderProbe.self]
    let runtime = NativeBYOK(store: DeviceKey(), configuration: config)
    try runtime.replaceKey(secret)
    let reference = try runtime.credentialReference()
    ProviderProbe.requests = []
    let payload: String
    switch encoding {
    case "nested-uri-base64":
      let percent = secret.utf8.map { String(format: "%%%02X", $0) }.joined()
      payload = Data(Data(percent.utf8).base64EncodedString().utf8).base64EncodedString()
    case "nested-json":
      let unicode = secret.utf8.map { String(format: "\\u%04x", $0) }.joined()
      payload = Data(("{\"detail\":\"" + unicode + "\"}").utf8).base64EncodedString()
    case "hex": payload = secret.utf8.map { String(format: "%02x", $0) }.joined()
    case "unicode": payload = secret.utf8.map { String(format: "\\u%04x", $0) }.joined()
    default: payload = secret.unicodeScalars.map { "&#x" + String($0.value, radix: 16) + ";" }.joined()
    }
    // Already-created output and queued work remain unsafe after every retirement path.
    try runtime.removeKey()
    try runtime.replaceKey("replacement-" + provider + "-fake-only")
    try runtime.endSession()
    let server = FakeServer { _ in (200, "{}") }
    let session = try TestServer.session(server)
    await #expect(throws: NativeAIError.self) {
      try await session.connection.send(
        HTTPRequest(method: .post, scheme: nil, authority: nil, path: "/telemetry"),
        json: Data(("{\"detail\":\"" + payload.replacingOccurrences(of: "\\", with: "\\\\") + "\"}").utf8),
        operationID: "telemetry")
    }
    await #expect(throws: NativeAIError.self) {
      _ = try await session.uploadVideo(Data(payload.utf8), in: "n1", send: { _, _ in
        Issue.record("Retired credential reached storage")
        return 200
      })
    }
    do {
      _ = try await runtime.suggest(title: payload, before: "", after: "", reference: reference)
      Issue.record("Credential entered the native bridge")
    } catch {
      if case NativeAIError.rejected = error {} else {
        Issue.record("Credential was not rejected at the bridge boundary")
      }
    }
    #expect(server.requests.count == 0)
    #expect(ProviderProbe.requests.count == 0)
  }

  @Test func customErrorFieldsCannotEscapeThroughDiagnostics() async throws {
    struct DetailedFailure: Error, LocalizedError {
      let debugPayload: String
      var errorDescription: String? { "Network unavailable" }
    }
    let runtime = NativeBYOK(store: DeviceKey())
    let secret = "fake-Anthropic-custom-error!279"
    try runtime.replaceKey(secret)
    let encoded = Data(Data(secret.utf8).base64EncodedString().utf8).base64EncodedString()
    try runtime.removeKey()
    let server = FakeServer { _ in throw DetailedFailure(debugPayload: encoded) }
    let session = try TestServer.session(server)
    do {
      try await session.connection.send(
        HTTPRequest(method: .post, scheme: nil, authority: nil, path: "/diagnostic"),
        json: Data("{}".utf8), operationID: "diagnostic")
      Issue.record("Expected failure")
    } catch { #expect(error is NativeAIError) }
  }

  @Test(arguments: ["OpenAI", "Anthropic", "OpenRouter"])
  func mixedPercentTextIsBlockedAtEveryNativeBoundary(provider: String) async throws {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [ProviderProbe.self]
    let runtime = NativeBYOK(store: DeviceKey(), configuration: config)
    let secret = "fake-" + provider + "-mixed!boundary:279"
    try runtime.replaceKey(secret)
    let once = secret.utf8.map { String(format: "%%%02X", $0) }.joined()
    let twice = once.replacingOccurrences(of: "%", with: "%25")
    let payload = "100% ordinary progress; " + twice
    ProviderProbe.requests = []
    await #expect(throws: NativeAIError.self) {
      _ = try await runtime.suggest(title: payload, before: "", after: "")
    }
    #expect(ProviderProbe.requests.count == 0)
    let server = FakeServer { _ in (200, "{}") }
    let session = try TestServer.session(server)
    await #expect(throws: NativeAIError.self) {
      _ = try await session.connection.sendOutside(
        Data(payload.utf8), method: .put,
        to: URL(string: "https://owned-bucket.test/upload")!, headers: [:])
    }
    await #expect(throws: NativeAIError.self) {
      var request = HTTPRequest(method: .post, scheme: nil, authority: nil, path: "/diagnostic")
      request.headerFields[HTTPField.Name("x-diagnostic")!] = payload
      try await session.connection.send(request, json: Data("{}".utf8), operationID: "diagnostic")
    }
    #expect(server.requests.count == 0)
  }

@Test @MainActor func nativeImageKeepsKeyOutsideSharedRuntimeAndRetainsSafeCompletedFile() async throws {
  let bytes = try Data(contentsOf: Bundle.module.url(forResource: "generated-image", withExtension: "png", subdirectory: "Fixtures")!)
  ProviderProbe.requests = []
  ProviderProbe.status = 200
  ProviderProbe.response = "{\"data\":[{\"media_type\":\"image/png\",\"b64_json\":\"\(bytes.base64EncodedString())\"}]}"
  let config = URLSessionConfiguration.ephemeral
  config.protocolClasses = [ProviderProbe.self]
  let byok = NativeBYOK(store: DeviceKey(), configuration: config, imageFixture: true)
  try byok.replaceKey("sk-or-v1-image-native-fixture-secret")
  let image = try await byok.generateImage(prompt: "tree")
  #expect(image.bytes == bytes)
  #expect(ProviderProbe.requests.count == 1)
  let request = try #require(ProviderProbe.requests.first)
  #expect(request.url?.absoluteString == "https://openrouter.ai/api/v1/images")
  #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer sk-or-v1-image-native-fixture-secret")
  #expect(!String(decoding: request.httpBody ?? Data(), as: UTF8.self).contains("fixture-secret"))
  let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let retained = NativeImageFileStore(directory: directory)
  try retained.save(image)
  try byok.removeKey()
  #expect(try retained.load()?.bytes == bytes)
  let production = NativeBYOK(store: DeviceKey(), configuration: config)
  try production.replaceKey("sk-or-v1-image-native-unverified")
  do { _ = try await production.generateImage(prompt: "tree"); Issue.record("Unverified production capability ran") } catch {}
  #expect(ProviderProbe.requests.count == 1)
}

}
