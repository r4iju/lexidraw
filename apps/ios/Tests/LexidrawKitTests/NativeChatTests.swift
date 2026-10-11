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
    case "/api/trpc/pro.chatCapability": return (200, chatEnvelope(#"{"available":true,"reason":""}"#))
    case "/api/trpc/pro.chatQuote":
      return (200, chatEnvelope(#"{"maximum":1792000,"policy":"Disclosed.","periodId":"period","inputHash":"hash","book":{"version":"fixture"}}"#))
    case "/api/trpc/pro.chatAccept":
      return (200, chatEnvelope(#"{"id":"chat","state":"reserved","result":null,"charged":0,"quote":1792000}"#))
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
    server.requests.filter { $0.url.path.hasSuffix("pro.cancel") }.count
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
