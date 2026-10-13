import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization
import Testing
@testable import LexidrawKit

private final class ResponseBudgetCounter: Sendable { let reads = Mutex(0) }
private struct BudgetBytes: AsyncSequence, Sendable {
  typealias Element = ArraySlice<UInt8>
  let counter: ResponseBudgetCounter
  let count: Int
  struct AsyncIterator: AsyncIteratorProtocol {
    let counter: ResponseBudgetCounter
    let count: Int
    var index = 0
    mutating func next() async throws -> Element? {
      guard index < count else { return nil }
      index += 1
      counter.reads.withLock { $0 += 1 }
      return Array(repeating: UInt8(32), count: 64 << 10)[...]
    }
  }
  func makeAsyncIterator() -> AsyncIterator { .init(counter: counter, count: count) }
}
private struct BudgetTransport: ClientTransport {
  let body: HTTPBody
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    (HTTPResponse(status: .ok), self.body)
  }
}
struct GuardedResponseBudgetTests {
  @Test func allowanceBudgetStopsUpstreamConsumptionBeforeWholeBodyScan() async throws {
    let counter = ResponseBudgetCounter()
    let server = BudgetTransport(body: HTTPBody(BudgetBytes(counter: counter, count: 32), length: .unknown, iterationBehavior: .single))
    let session = try #require(try Account(origin: TestServer.origin, store: InMemoryTokenStore("lxd_budget"), transport: server).restore())
    await #expect(throws: (any Error).self) { try await session.proAllowance() }
    #expect(counter.reads.withLock { $0 } <= 5, "A 256 KiB status bound must stop consumption at the first overflowing chunk")
  }
  @Test func documentAndNarrationResponsesKeepTheirLargerFiniteBudgets() async throws {
    for operation in ["entities-load", "narration.operation"] {
      let counter = ResponseBudgetCounter()
      let transport = CredentialGuardedTransport(underlying: BudgetTransport(body: HTTPBody(BudgetBytes(counter: counter, count: 24), length: .unknown, iterationBehavior: .single)))
      let (_, body) = try await transport.send(HTTPRequest(method: .get, scheme: nil, authority: nil, path: "/fixture"), body: nil, baseURL: TestServer.origin, operationID: operation)
      let bytes = try await Data(collecting: try #require(body), upTo: 2 << 20)
      #expect(bytes.count == 1_572_864)
    }
  }
}
