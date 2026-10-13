import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization
import Testing

@testable import LexidrawKit

private final class Counter: Sendable {
  let value = Mutex(0)
}

private struct ObservedBytes: AsyncSequence, Sendable {
  typealias Element = ArraySlice<UInt8>
  let read: Counter
  let count: Int
  struct AsyncIterator: AsyncIteratorProtocol {
    let read: Counter
    let count: Int
    var finished = false
    mutating func next() async throws -> Element? {
      guard !finished else { return nil }
      finished = true
      read.value.withLock { $0 += 1 }
      return Array(repeating: UInt8(0), count: count)[...]
    }
  }
  func makeAsyncIterator() -> AsyncIterator { .init(read: read, count: count) }
}
private struct BodyBoundary: ClientTransport {
  let received: Counter
  let responseRead: Counter
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?) {
    if let body {
      let data = try await Data(collecting: body, upTo: Int.max)
      received.value.withLock { $0 = data.count }
    }
    return (HTTPResponse(status: .ok), HTTPBody(
      ObservedBytes(read: responseRead, count: 65 << 20), length: .unknown, iterationBehavior: .single))
  }
}
private struct ResponseBoundary: ClientTransport {
  let body: HTTPBody
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?) { (HTTPResponse(status: .ok), self.body) }
}
private class PayloadFailure: Error, @unchecked Sendable {
  let metadata: [String: String]
  init(_ value: String) { metadata = ["debug": value] }
}
private final class WrappedPayloadFailure: PayloadFailure, @unchecked Sendable {}
private final class BoundaryKey: TokenStore, @unchecked Sendable {
  var value: String?
  func load() throws -> String? { value }
  func save(_ token: String) throws { value = token }
  func delete() throws { value = nil }
}

struct CredentialGuardedTransportTests {
  @Test @MainActor func prefixHeavyInputStopsBeforeAppDispatchInsteadOfUnboundedFingerprintWork() async throws {
    let runtime = NativeBYOK(store: BoundaryKey())
    try runtime.replaceKey("hashwork-synthetic-credential-fixture")
    let received = Counter(), responseRead = Counter()
    let transport = CredentialGuardedTransport(underlying: BodyBoundary(received: received, responseRead: responseRead))
    let body = try JSONEncoder().encode(["message": String(repeating: "hash", count: 30_000)])
    await #expect(throws: NativeAIError.self) {
      _ = try await transport.send(HTTPRequest(method: .post, scheme: nil, authority: nil, path: "/diagnostic"), body: HTTPBody(body), baseURL: URL(string: "https://app.test")!, operationID: "diagnostic")
    }
    #expect(received.value.withLock { $0 } == 0)
  }

  @Test func mixedPercentTextCannotHideRetiredCredentialFingerprints() throws {
    let guarder = NativeCredentialGuard()
    let secret = "opaque-synthetic-native-credential-291"
    try guarder.remember(secret)
    let encoded = secret.utf8.map { String(format: "%%%02x", $0) }.joined()
    let restored = NativeCredentialGuard()
    try restored.restore(guarder.snapshot())
    for value in [encoded, encoded.replacingOccurrences(of: "%", with: "%25"), "%ff" + encoded] {
      #expect(throws: NativeAIError.self) {
        try restored.check(Data((value + " 100% complete %zz").utf8))
      }
    }
    try restored.check(Data("100% complete %zz".utf8))
  }

  @Test func fileTransfersKeepExistingSizesAndResponseConsumptionIsLazy() async throws {
    let received = Counter()
    let responseRead = Counter()
    let transport = CredentialGuardedTransport(underlying: BodyBoundary(received: received, responseRead: responseRead))
    let (_, response) = try await transport.send(
      HTTPRequest(method: .put, scheme: nil, authority: nil, path: "/file"),
      body: HTTPBody(Data(repeating: 0, count: 33 << 20)),
      baseURL: URL(string: "https://owned-bucket.test")!, operationID: "outside")
    #expect(received.value.withLock { $0 } == 33 << 20)
    #expect(responseRead.value.withLock { $0 } == 0)
    let data = try await Data(collecting: #require(response), upTo: Int.max)
    #expect(data.count == 65 << 20)
    #expect(responseRead.value.withLock { $0 } == 1)
  }
  @Test(arguments: ["remove", "replace", "logout"])
  @MainActor func lateInFlightErrorsCannotLeakRetiredCredentials(retirement: String) async throws {
    let runtime = NativeBYOK(store: BoundaryKey())
    let secret = "fake-OpenAI-late!error:279-" + retirement
    try runtime.replaceKey(secret)
    let reference = try runtime.credentialReference()
    let (stream, continuation) = AsyncThrowingStream<ArraySlice<UInt8>, Error>.makeStream()
    let transport = CredentialGuardedTransport(underlying: ResponseBoundary(body: HTTPBody(stream, length: .unknown)))
    let (_, response) = try await transport.send(
      HTTPRequest(method: .get, scheme: nil, authority: nil, path: "/diagnostic"), body: nil,
      baseURL: URL(string: "https://lexidraw.test")!, operationID: "diagnostic")
    switch retirement {
    case "remove": try runtime.removeKey()
    case "replace": try runtime.replaceKey("replacement-late-fake-279")
    default: try runtime.endSession()
    }
    let encoded = Data(Data(secret.utf8).base64EncodedString().utf8).base64EncodedString()
    continuation.finish(throwing: WrappedPayloadFailure(encoded))
    do {
      _ = try await Data(collecting: #require(response), upTo: Int.max)
      Issue.record("Expected late network failure")
    } catch { #expect(error is NativeAIError) }
    await #expect(throws: NativeAIError.self) {
      _ = try await runtime.suggest(title: "", before: "", after: "", reference: reference)
    }
  }

  @Test @MainActor func queuedRequestRechecksMetadataAfterBodySuspension() async throws {
    let runtime = NativeBYOK(store: BoundaryKey())
    let secret = "fake-OpenRouter-queued!headers:279"
    let (stream, continuation) = AsyncThrowingStream<ArraySlice<UInt8>, Error>.makeStream()
    let received = Counter()
    let responseRead = Counter()
    let transport = CredentialGuardedTransport(underlying: BodyBoundary(received: received, responseRead: responseRead))
    var request = HTTPRequest(method: .post, scheme: nil, authority: nil, path: "/telemetry")
    request.headerFields[HTTPField.Name("x-diagnostic")!] = Data(secret.utf8).base64EncodedString()
    let ready = Counter()
    let job = Task {
      try await transport.send(request,
        body: HTTPBody(stream.map { chunk in
          ready.value.withLock { $0 += 1 }
          return chunk
        }, length: .unknown, iterationBehavior: .single),
        baseURL: URL(string: "https://lexidraw.test")!, operationID: "telemetry")
    }
    continuation.yield(Array("{}".utf8)[...])
    for _ in 0..<1000 {
      if ready.value.withLock({ $0 }) > 0 { break }
      try await Task.sleep(for: .milliseconds(1))
    }
    #expect(ready.value.withLock { $0 } == 1)
    try runtime.replaceKey(secret)
    try runtime.removeKey()
    continuation.finish()
    do {
      _ = try await job.value
      Issue.record("Queued credential metadata was dispatched")
    } catch { #expect(error is NativeAIError) }
    #expect(received.value.withLock { $0 } == 0)
  }

}
