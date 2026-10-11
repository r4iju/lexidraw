import Foundation
import JavaScriptCore
import Testing

@testable import LexidrawKit

@Suite(.serialized) @MainActor struct NativeChatTests {
  @Test func sharedChatBoundsAndHistorySurviveJavaScriptCore() throws {
    let input = NativeChatInput(
      prompt: "Why?", messages: [.init(role: "assistant", content: "Closed.")], context: "Repairs")
    let request = try nativeChatPrepared(input)
    #expect(request.contains("Closed."))
    #expect(request.contains("Repairs"))
    #expect(!request.contains("credential"))
    #expect(throws: NativeChatError.self) {
      try nativeChatPrepared(
        NativeChatInput(prompt: "x", context: String(repeating: "x", count: 1500)))
    }
  }
  @Test func localChatStreamsWithoutCloudAndUnsupportedModelCannotFallback() async throws {
    let model = ChatLocalFixture()
    let local = NativeLocalText(model: model)
    var updates: [String] = []
    let result = try await local.chat(
      NativeChatInput(prompt: "Why?"), onText: { updates.append($0) })
    #expect(result == "Local answer.")
    #expect(updates == ["Local ", "Local answer."])
    model.status = .modelNotReady
    await #expect(throws: LocalTextError.self) {
      try await local.chat(NativeChatInput(prompt: "Why?"), onText: { _ in })
    }
    #expect(model.calls == 1)
  }
}
@MainActor private final class ChatLocalFixture: LocalTextModel {
  var status: LocalTextAvailability = .available
  var calls = 0
  func availability(locale: Locale) -> LocalTextAvailability { status }
  func respond(_ request: LocalTextRequest) async throws -> String { "unused" }
  func stream(_ request: LocalTextRequest, onText: @escaping @MainActor (String) -> Void)
    async throws -> String
  {
    calls += 1
    onText("Local ")
    try await Task.sleep(for: .milliseconds(10))
    onText("Local answer.")
    return "Local answer."
  }
}

private final class NativeChatKey: TokenStore, @unchecked Sendable {
  var value: String? = "sk-or-v1-native-chat-network-fixture-123456"
  func load() throws -> String? { value }
  func save(_ value: String) throws { self.value = value }
  func delete() throws { value = nil }
}
private final class NativeChatProbe: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    guard request.url?.absoluteString == "https://openrouter.ai/api/v1/chat/completions",
      request.value(forHTTPHeaderField: "Authorization")
        == "Bearer sk-or-v1-native-chat-network-fixture-123456",
      !(String(decoding: request.httpBody ?? Data(), as: UTF8.self).contains("sk-or-v1"))
    else {
      client?.urlProtocol(self, didFailWithError: URLError(.badURL))
      return
    }
    client?.urlProtocol(
      self,
      didReceive: HTTPURLResponse(
        url: request.url!, statusCode: 200, httpVersion: nil,
        headerFields: ["Content-Type": "text/event-stream"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(
      self, didLoad: Data("data: {\"choices\":[{\"delta\":{\"content\":\"The \"}}]}\n\n".utf8))
    DispatchQueue.global().asyncAfter(deadline: .now() + 0.2) { [self] in
      client?.urlProtocol(
        self,
        didLoad: Data(
          "data: {\"choices\":[{\"delta\":{\"content\":\"answer.\"}}]}\n\ndata: [DONE]\n\n".utf8))
      client?.urlProtocolDidFinishLoading(self)
    }
  }
  override func stopLoading() {}
}
extension NativeChatTests {
  @Test func nativeDirectChatStreamsBeforeCompletionAndExpiresRemovedReferences() async throws {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [NativeChatProbe.self]
    let byok = NativeBYOK(store: NativeChatKey(), configuration: config, chatFixture: true)
    let reference = try byok.credentialReference()
    var updates: [String] = []
    let task = Task {
      try await byok.chat(
        NativeChatInput(prompt: "Hi", messages: [.init(role: "assistant", content: "Earlier.")]),
        reference: reference, onText: { updates.append($0) })
    }
    try await Task.sleep(for: .milliseconds(50))
    #expect(updates == ["The "])
    #expect(try await task.value == "The answer.")
    #expect(updates == ["The ", "The answer."])
    try byok.removeKey()
    await #expect(throws: (any Error).self) {
      try await byok.chat(NativeChatInput(prompt: "Hi"), reference: reference, onText: { _ in })
    }
  }
}

extension NativeChatTests {
  @Test func nativeProChatUsesAuthenticatedQuoteAcceptanceStreamAndSafeReplay() async throws {
    let server = FakeServer { request in
      #expect(request.authorization == "Bearer lxd_kept")
      #expect(!String(describing: request.object).contains("sk-or-v1"))
      switch request.url.path {
      case "/api/trpc/pro.chatQuote":
        return (200, #"{"result":{"data":{"json":{"maximum":1792000,"policy":"Completed responses are charged; unknown outcomes stay reserved.","periodId":"period","inputHash":"hash","book":{"version":"fixture"}}}}}"#)
      case "/api/trpc/pro.chatAccept":
        #expect((request.object["json"] as? [String: Any])?["idempotencyKey"] as? String == "same-turn")
        return (200, #"{"result":{"data":{"json":{"id":"chat","state":"reserved","result":null,"charged":0,"quote":1792000}}}}"#)
      case "/api/chat/stream":
        return (200, "{\"kind\":\"text\",\"text\":\"Hello \"}\n{\"kind\":\"text\",\"text\":\"Hello there.\"}\n{\"kind\":\"operation\",\"operation\":{\"id\":\"chat\",\"state\":\"settled\",\"result\":\"Hello there.\",\"charged\":31000,\"quote\":1792000}}\n")
      default: return (500, "unavailable")
      }
    }
    let session = try TestServer.session(server)
    let input = NativeChatInput(prompt: "Hello", messages: [.init(role: "assistant", content: "Earlier.")])
    let quote = try await session.quoteChat(input)
    #expect(quote.maximum == 1792000)
    let operation = try await session.acceptChat(input, quote: quote, idempotencyKey: "same-turn")
    let result = try await session.streamChat(input, operation: operation, onText: { _ in })
    #expect(result.charged == 31000); #expect(result.result == "Hello there.")
    let count = server.requests.count
    _ = try await session.streamChat(input, operation: result, onText: { _ in })
    #expect(server.requests.count == count)
  }
}

extension NativeChatTests {
  @Test func switchingChatAccountNeverShowsPreviousPrivateHistoryWhenAuthenticationFails() async throws {
    let flow = NativeChatFlow(source: .byok, messages: [.init(role: "assistant", content: "Previous private conversation")]) { _, _ in "unused" }
    let server = FakeServer { _ in (503, "unavailable") }
    await flow.load(session: try TestServer.session(server), document: "new-document", context: "")
    #expect(flow.messages.isEmpty)
  }
}

private func chatEnvelope(_ json: String) -> String { #"{"result":{"data":{"json":\#(json)}}}"# }
private func proChatServer() -> FakeServer {
  FakeServer { request in
    switch request.url.path {
    case "/api/v1/me":
      return (200, #"{"userId":"reader","email":null,"name":null,"authKind":"token","scope":"write"}"#)
    case "/api/trpc/auth.getPowerPreference": return (200, chatEnvelope(#"{"mode":"pro"}"#))
    case "/api/trpc/pro.chatUnscoped": return (200, chatEnvelope("[]"))
    case "/api/trpc/pro.chatCurrent": return (200, chatEnvelope("[]"))
    case "/api/trpc/pro.chatCapability": return (200, chatEnvelope(#"{"available":true,"reason":""}"#))
    case "/api/trpc/pro.chatQuote":
      return (200, chatEnvelope(#"{"maximum":1792000,"policy":"Disclosed.","periodId":"period","inputHash":"hash","book":{"version":"fixture"}}"#))
    case "/api/trpc/pro.chatAccept":
      return (200, chatEnvelope(#"{"id":"chat","state":"reserved","result":null,"charged":0,"quote":1792000}"#))
    case "/api/trpc/pro.chatCancel": return (200, chatEnvelope(#"{"id":"chat","state":"cancelled","result":null,"charged":0,"quote":1792000}"#))
    case "/api/trpc/pro.cancel": return (200, chatEnvelope("{}"))
    default: return (500, "unavailable")
    }
  }
}
extension NativeChatTests {
  private func quotedProChat(_ server: FakeServer) async throws -> NativeChatFlow {
    let flow = NativeChatFlow()
    await flow.load(session: try TestServer.session(server), document: "doc", context: "")
    flow.send("Hello")
    for _ in 0..<200 {
      if case .quote = flow.state { break }
      try await Task.sleep(for: .milliseconds(5))
    }
    guard case .quote = flow.state else { throw NativeChatError.unavailable }
    return flow
  }
  private func cancellations(_ server: FakeServer) -> Int {
    server.requests.filter { $0.url.path.hasSuffix("pro.cancel") || $0.url.path.hasSuffix("pro.chatCancel") }.count
  }
  @Test func leavingWhileAcceptancePendingKeepsTheServerOperationAndNeverDispatches() async throws {
    let server = proChatServer()
    let flow = try await quotedProChat(server)
    flow.accept()
    await flow.load(session: try TestServer.session(server), document: "other", context: "")
    #expect(cancellations(server) == 0)
    #expect(server.requests.filter { $0.url.path == "/api/chat/stream" }.isEmpty)
  }
  @Test func stopWhileAcceptancePendingCancelsTheAcceptedOperationOnceWithoutDispatch() async throws {
    let server = proChatServer()
    let flow = try await quotedProChat(server)
    flow.accept()
    flow.stop()
    for _ in 0..<200 {
      if case .result = flow.state { break }
      try await Task.sleep(for: .milliseconds(5))
    }
    #expect(cancellations(server) == 1)
    #expect(server.requests.filter { $0.url.path == "/api/chat/stream" }.isEmpty)
  }
}

extension NativeChatTests {
  @Test func remountReadsAcceptedChatAndExplicitStopCanReleaseItAfterPreferenceCloses() async throws {
    let server = FakeServer { request in
      switch request.url.path {
      case "/api/v1/me": return (200, #"{"userId":"reader","email":null,"name":null,"authKind":"token","scope":"write"}"#)
      case "/api/trpc/auth.getPowerPreference": throw URLError(.notConnectedToInternet)
      case "/api/trpc/pro.chatUnscoped": return (200, chatEnvelope("[]"))
      case "/api/trpc/pro.chatCurrent":
        #expect(request.method == .get)
        #expect(request.url.query?.contains("doc") == true)
        return (200, chatEnvelope(#"[{"id":"accepted-before-detach","state":"reserved","result":null,"charged":0,"quote":1792000}]"#))
      case "/api/trpc/pro.chatCancel":
        #expect((request.object["json"] as? [String: String])?["id"] == "accepted-before-detach")
        #expect((request.object["json"] as? [String: String])?["documentId"] == "doc")
        return (200, chatEnvelope(#"{"id":"accepted-before-detach","state":"cancelled","result":null,"charged":0,"quote":1792000}"#))
      default: throw URLError(.unsupportedURL)
      }
    }
    let flow = NativeChatFlow()
    await flow.load(session: try TestServer.session(server), document: "doc", context: "")
    flow.stop()
    for _ in 0..<100 where !server.requests.contains(where: { $0.url.path == "/api/trpc/pro.chatCancel" }) { try await Task.sleep(for: .milliseconds(2)) }
    #expect(server.requests.contains { $0.url.path == "/api/trpc/pro.chatCurrent" })
    #expect(server.requests.contains { $0.url.path == "/api/trpc/pro.chatCancel" })
    #expect(server.requests.allSatisfy { !$0.url.path.contains("chatAccept") && !$0.url.path.contains("chat/stream") })
  }
}

extension NativeChatTests {
  @Test func twoLostAcceptanceReadsRetainSubmissionAndNeverAllowAReplacementKey() async throws {
    let server = FakeServer { request in
      switch request.url.path {
      case "/api/v1/me": return (200, #"{"userId":"reader","email":null,"name":null,"authKind":"token","scope":"write"}"#)
      case "/api/trpc/auth.getPowerPreference": return (200, chatEnvelope(#"{"mode":"pro"}"#))
      case "/api/trpc/pro.chatCapability": return (200, chatEnvelope(#"{"available":true,"reason":""}"#))
      case "/api/trpc/pro.chatCurrent", "/api/trpc/pro.chatUnscoped": return (200, chatEnvelope("[]"))
      case "/api/trpc/pro.chatQuote": return (200, chatEnvelope(#"{"maximum":1792000,"policy":"Disclosed.","periodId":"period","inputHash":"hash","book":{"version":"fixture"}}"#))
      case "/api/trpc/pro.chatAccept", "/api/trpc/pro.chatRecovery": throw URLError(.networkConnectionLost)
      default: throw URLError(.unsupportedURL)
      }
    }
    let flow = try await quotedProChat(server)
    flow.accept()
    for _ in 0..<100 { if case .result = flow.state { break }; try await Task.sleep(for: .milliseconds(5)) }
    await flow.refreshOwnedChats()
    flow.decline(); flow.send("Hello again")
    try await Task.sleep(for: .milliseconds(50))
    #expect(server.requests.filter { $0.url.path.hasSuffix("pro.chatQuote") }.count == 1)
    #expect(server.requests.filter { $0.url.path.hasSuffix("pro.chatAccept") }.count == 1)
  }
}


extension NativeChatTests {
  @Test(arguments: [false, true]) func realSessionLocalChatWorksWhilePaidStatusIsUnknownOrUnreadable(readFails: Bool) async throws {
    let server = FakeServer { request in
      switch request.url.path {
      case "/api/v1/me": return (200, #"{"userId":"local-recovery-test","email":null,"name":null,"authKind":"token","scope":"write"}"#)
      case "/api/trpc/auth.getPowerPreference": return (200, chatEnvelope(#"{"mode":"local"}"#))
      case "/api/trpc/pro.chatUnscoped": return (200, chatEnvelope("[]"))
      case "/api/trpc/pro.chatCurrent":
        if readFails { throw URLError(.networkConnectionLost) }
        return (200, chatEnvelope(#"[{"id":"paid-unknown","state":"unknown","result":null,"charged":0,"quote":1792000}]"#))
      default: throw URLError(.unsupportedURL)
      }
    }
    let model = ChatLocalFixture()
    let flow = NativeChatFlow(local: NativeLocalText(model: model))
    let document = "local-recovery-" + UUID().uuidString
    defer { UserDefaults.standard.removeObject(forKey: "chat-v1:local-recovery-test:" + document) }
    await flow.load(session: try TestServer.session(server), document: document, context: "")
    flow.send("Why?")
    for _ in 0..<100 where flow.messages.last?.content != "Local answer." { try await Task.sleep(for: .milliseconds(2)) }
    #expect(flow.messages.last?.content == "Local answer.")
    #expect(model.calls == 1)
    if readFails { #expect(flow.ownedReadState != .current) }
    else { #expect(flow.ownedOperations.first?.id == "paid-unknown") }
    #expect(server.requests.allSatisfy { !$0.url.path.contains("chatAccept") && !$0.url.path.contains("chatQuote") && !$0.url.path.contains("chat/stream") && !$0.url.path.contains("chatCancel") })
  }
}

extension NativeChatTests {
  @Test func unknownOriginLegacyChatHistoryIsQuarantined() async throws {
    let doc = UUID().uuidString
    let key = "chat-v1:fixture-account:" + doc
    let defaults = UserDefaults.standard
    let original = try JSONEncoder().encode([NativeChatMessage(role: "assistant", content: "Unknown origin private history")])
    defaults.set(original, forKey: key)
    defer { defaults.removeObject(forKey: key) }
    let server = FakeServer { request in
      switch request.url.path {
      case "/api/v1/me": return (200, #"{"userId":"fixture-account","name":null,"email":null,"authKind":"token","scope":"write"}"#)
      case "/api/trpc/auth.getPowerPreference": return (200, #"{"result":{"data":{"json":{"mode":"local"}}}}"#)
      case "/api/trpc/pro.chatCurrent": return (200, #"{"result":{"data":{"json":[]}}}"#)
      default: throw URLError(.unsupportedURL)
      }
    }
    let flow = NativeChatFlow()
    await flow.load(session: try TestServer.session(server), document: doc, context: "")
    #expect(flow.messages.isEmpty)
    #expect(defaults.data(forKey: key) == original)
  }
}
