import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization
import Testing
@testable import LexidrawKit

private final class ChatStreamBoundary: ClientTransport, Sendable {
  let body: HTTPBody
  let operations = Mutex<[String]>([])
  init(_ body: HTTPBody) { self.body = body }
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String)
    async throws -> (HTTPResponse, HTTPBody?) {
    operations.withLock { $0.append(operationID) }
    if operationID == "pro.cancel" {
      return (HTTPResponse(status: .ok), HTTPBody(#"{"result":{"data":{"json":{}}}}"#))
    }
    return (HTTPResponse(status: .ok), self.body)
  }
}
private actor GuardedChatUpdates {
  var values: [String] = []
  func append(_ text: String) { values.append(text) }
  func waitForPartial() async throws -> Bool {
    for _ in 0..<200 {
      if !values.isEmpty { return true }
      try await Task.sleep(for: .milliseconds(1))
    }
    return false
  }
}
private final class ChatReadCount: Sendable {
  let value = Mutex(0)
}
private struct CountedChatBytes: AsyncSequence, Sendable {
  typealias Element = ArraySlice<UInt8>
  let reads: ChatReadCount
  struct AsyncIterator: AsyncIteratorProtocol {
    let reads: ChatReadCount
    var count = 0
    mutating func next() async throws -> Element? {
      guard count < 32 else { return nil }
      count += 1
      reads.value.withLock { $0 += 1 }
      return Array(repeating: UInt8(32), count: 64 << 10)[...]
    }
  }
  func makeAsyncIterator() -> AsyncIterator { .init(reads: reads) }
}

@Suite(.serialized) struct GuardedChatStreamTests {
  private let partial = #"{"kind":"text","text":"Safe partial"}"# + "\n"
  private let terminal = #"{"kind":"operation","operation":{"id":"guarded-chat","state":"settled","result":"Safe partial","charged":10,"quote":100}}"# + "\n"
  private func operation() throws -> ProChatOperation {
    try JSONDecoder().decode(ProChatOperation.self, from: Data(
      #"{"id":"guarded-chat","state":"reserved","result":null,"charged":0,"quote":100}"#.utf8))
  }
  private func session(_ boundary: ChatStreamBoundary) throws -> Session {
    try #require(try Account(origin: TestServer.origin,
      store: InMemoryTokenStore("synthetic-guarded-chat-account"), transport: boundary).restore())
  }

  @Test func safeCompleteFrameArrivesThroughAccountBeforeEOF() async throws {
    let (stream, continuation) = AsyncThrowingStream<ArraySlice<UInt8>, Error>.makeStream()
    let boundary = ChatStreamBoundary(HTTPBody(stream, length: .unknown))
    let session = try session(boundary)
    let updates = GuardedChatUpdates()
    let job = Task {
      try await session.streamChat(NativeChatInput(prompt: "Hello"), operation: operation(),
        onText: { await updates.append($0) })
    }
    let bytes = Array(partial.utf8)
    continuation.yield(bytes.prefix(13))
    continuation.yield(bytes.dropFirst(13))
    #expect(try await updates.waitForPartial(), "Safe frame must be delivered while EOF is held open")
    continuation.yield(Array(terminal.utf8)[...])
    continuation.finish()
    #expect(try await job.value.state == .settled)
    #expect(await updates.values == ["Safe partial"])
    #expect(boundary.operations.withLock { $0 } == ["chat.stream"])
  }

  @Test(arguments: [false, true]) func errorAndCancellationRetainAlreadySafePartial(cancel: Bool) async throws {
    let (stream, continuation) = AsyncThrowingStream<ArraySlice<UInt8>, Error>.makeStream()
    let boundary = ChatStreamBoundary(HTTPBody(stream, length: .unknown))
    let session = try session(boundary)
    let updates = GuardedChatUpdates()
    let job = Task {
      try await session.streamChat(NativeChatInput(prompt: "Hello"), operation: operation(),
        onText: { await updates.append($0) })
    }
    continuation.yield(Array(partial.utf8)[...])
    #expect(try await updates.waitForPartial())
    if cancel { job.cancel() }
    continuation.finish(throwing: URLError(.networkConnectionLost))
    await #expect(throws: cancel ? NativeChatError.cancelled : NativeChatError.uncertain) {
      try await job.value
    }
    #expect(await updates.values == ["Safe partial"])
    // Cancelling the stream task only detaches; an explicit Stop issues pro.cancel itself.
    #expect(boundary.operations.withLock { $0 }.filter { $0 == "pro.cancel" }.isEmpty)
  }

  @Test @MainActor func splitActiveAndRetiredEncodedEchoNeverPublishesAnUnsafeFrame() async throws {
    let runtime = NativeBYOK(store: InMemoryTokenStore())
    let secret = "synthetic-guarded-chat-echo-291"
    try runtime.replaceKey(secret)
    for retired in [false, true] {
      if retired { try runtime.removeKey() }
      for representation in [secret,
        secret.utf8.map { String(format: "%%%02x", $0) }.joined(),
        Data(secret.utf8).base64EncodedString(),
        secret.utf8.map { String(format: "\\u%04x", $0) }.joined()] {
        let (stream, continuation) = AsyncThrowingStream<ArraySlice<UInt8>, Error>.makeStream()
        let boundary = ChatStreamBoundary(HTTPBody(stream, length: .unknown))
        let session = try session(boundary)
        let updates = GuardedChatUpdates()
        let job = Task {
          try await session.streamChat(NativeChatInput(prompt: "Hello"), operation: operation(),
            onText: { await updates.append($0) })
        }
        continuation.yield(Array(partial.utf8)[...])
        #expect(try await updates.waitForPartial())
        let wire = Array((#"{"kind":"text","text":"Safe partial "# + representation + #""}"# + "\n").utf8)
        for chunk in stride(from: 0, to: wire.count, by: 3) {
          continuation.yield(wire[chunk..<min(chunk + 3, wire.count)])
        }
        continuation.finish()
        await #expect(throws: NativeChatError.uncertain) { try await job.value }
        #expect(await updates.values == ["Safe partial"])
      }
    }
  }

  @Test func wireOverflowRejectsDuringConsumptionBeforeEOF() async throws {
    let reads = ChatReadCount()
    let boundary = ChatStreamBoundary(HTTPBody(CountedChatBytes(reads: reads), length: .unknown, iterationBehavior: .single))
    let session = try session(boundary)
    let updates = GuardedChatUpdates()
    await #expect(throws: NativeChatError.uncertain) {
      try await session.streamChat(NativeChatInput(prompt: "Hello"), operation: operation(),
        onText: { await updates.append($0) })
    }
    #expect(reads.value.withLock { $0 } < 32)
    #expect(await updates.values.isEmpty)
  }
}
