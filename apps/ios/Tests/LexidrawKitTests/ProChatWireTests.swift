import Foundation
import Testing
@testable import LexidrawKit

struct ProChatWireTests {
  @Test func unknownOperationStateCannotEnterRecovery() throws {
    let bytes = Data(#"{"id":"chat","state":"surprise","result":null,"charged":0,"quote":100}"#.utf8)
    #expect(throws: DecodingError.self) { try JSONDecoder().decode(ProChatOperation.self, from: bytes) }
  }
}

struct ChatEventWireTests {
  @Test func missingPayloadUnknownKindAndExtraPayloadReject() {
    for wire in [#"{"kind":"text"}"#, #"{"kind":"operation"}"#, #"{"kind":"error"}"#,
      #"{"kind":"future","text":"hello"}"#, #"{"kind":"text","text":"hello","operation":null}"#,
      #"{"kind":"text","text":null}"#] {
      #expect(throws: DecodingError.self) { try JSONDecoder().decode(ChatEvent.self, from: Data(wire.utf8)) }
    }
  }
}

extension ProChatWireTests {
  @Test func missingNullableResultIsMalformedRatherThanAnUnfinishedOperation() {
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(ProChatOperation.self, from: Data(#"{"id":"chat","state":"reserved","charged":0,"quote":100}"#.utf8))
    }
  }
}

@Suite(.serialized) struct ProChatStreamWireTests {
  private func operation(_ state: String = "reserved", result: String? = nil) throws -> ProChatOperation {
    let wire: [String: Any] = ["id": "chat", "state": state, "result": result ?? NSNull(), "charged": 0, "quote": 100]
    return try JSONDecoder().decode(ProChatOperation.self, from: JSONSerialization.data(withJSONObject: wire))
  }
  @Test func partialThenSettledAndDurableStateDecoding() async throws {
    for state in ["reserved", "running", "unknown", "settled", "refunded", "cancelled"] {
      #expect(try operation(state).state.rawValue == state)
    }
    let wire = #"{"kind":"text","text":"Hello "}"# + "\n" + #"{"kind":"text","text":"Hello world"}"# + "\n" + #"{"kind":"operation","operation":{"id":"chat","state":"settled","result":"Hello world","charged":10,"quote":100}}"# + "\n"
    let server = FakeServer { _ in (200, wire) }
    let updates = ChatUpdates()
    let result = try await TestServer.session(server).streamChat(NativeChatInput(prompt: "Hi"), operation: operation(), onText: { await updates.append($0) })
    #expect(result.state == .settled)
    #expect(await updates.values == ["Hello ", "Hello world"])
    #expect(server.requests.count == 1)
  }
  @Test func cancellationRetainsPartialTextAndRequestsOnlyCancellation() async throws {
    let server = FakeServer { request in
      if request.url.path.hasSuffix("pro.cancel") { return (200, #"{"result":{"data":{"json":{}}}}"#) }
      return (200, #"{"kind":"text","text":"Partial "}"# + "\n")
    }
    let session = try TestServer.session(server)
    let task = Task {
      try await session.streamChat(NativeChatInput(prompt: "Hi"), operation: operation(), onText: { _ in
        withUnsafeCurrentTask { $0?.cancel() }
      })
    }
    await #expect(throws: NativeChatError.cancelled) { try await task.value }
    #expect(server.requests.filter { $0.url.path.hasSuffix("pro.cancel") }.count == 1)
    #expect(server.requests.filter { $0.url.path.hasSuffix("/chat/stream") }.count == 1)
  }
  @Test func textAfterTerminalCompletionFailsClosed() async throws {
    let wire = #"{"kind":"operation","operation":{"id":"chat","state":"settled","result":"Done","charged":10,"quote":100}}"# + "\n" + #"{"kind":"text","text":"Late"}"# + "\n"
    let session = try TestServer.session(FakeServer { _ in (200, wire) })
    await #expect(throws: NativeChatError.uncertain) {
      try await session.streamChat(NativeChatInput(prompt: "Hi"), operation: operation(), onText: { _ in })
    }
  }
}
private actor ChatUpdates {
  var values: [String] = []
  func append(_ text: String) { values.append(text) }
}
