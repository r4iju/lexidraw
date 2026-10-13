import Foundation
import Synchronization
import Testing

@testable import LexidrawKit

private final class BudgetKey: TokenStore, @unchecked Sendable {
  var value: String?
  func load() throws -> String? { value }
  func save(_ token: String) throws { value = token }
  func delete() throws { value = nil }
}
private final class BudgetProbe: URLProtocol, @unchecked Sendable {
  struct State: Sendable {
    var payload = Data()
    var status = 200
    var requests: [URLRequest] = []
    var holdTail = false
    var finished = false
    var stopped = false
  }
  static let state = Mutex(State())
  private let stopped = Mutex(false)
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let (payload, hold) = Self.state.withLock { state in
      state.requests.append(request)
      return (state.payload, state.holdTail)
    }
    let response = HTTPURLResponse(url: request.url!, statusCode: Self.state.withLock { $0.status }, httpVersion: nil,
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    for offset in stride(from: 0, to: payload.count, by: 4096) {
      client?.urlProtocol(self, didLoad: payload.subdata(in: offset..<min(offset + 4096, payload.count)))
    }
    if hold {
      DispatchQueue.global().asyncAfter(deadline: .now() + 60) { [self] in finish() }
    } else { finish() }
  }
  private func finish() {
    let active = !stopped.withLock { $0 }
    if active { Self.state.withLock { $0.finished = true } }
    if active { client?.urlProtocolDidFinishLoading(self) }
  }
  override func stopLoading() {
    stopped.withLock { $0 = true }
    Self.state.withLock { $0.stopped = true }
  }
}

@Suite(.serialized) @MainActor struct NativeProviderBudgetTests {
  private func runtime() throws -> NativeBYOK {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [BudgetProbe.self]
    config.httpAdditionalHeaders = ["Authorization": "Bearer lxd_ambient", "Cookie": "ambient=1"]
    let runtime = NativeBYOK(store: BudgetKey(), configuration: config, imageFixture: true)
    try runtime.replaceKey("budget-provider-fixture")
    return runtime
  }
  @Test(arguments: ["key", "autocomplete", "image"])
  func oversizedChunkedProviderBodyIsCancelledBeforeCompletion(endpoint: String) async throws {
    let cap = endpoint == "image" ? 3 << 20 : 64 << 10
    BudgetProbe.state.withLock { $0 = .init(payload: Data(repeating: 32, count: cap + 4096), holdTail: true) }
    let byok = try runtime()
    do {
      switch endpoint {
      case "key": try await byok.validate()
      case "image": _ = try await byok.generateImage(prompt: "tree")
      default: _ = try await byok.suggest(title: "", before: "A ", after: "")
      }
      Issue.record("Oversized provider body was published")
    } catch { #expect(error is NativeAIError) }
    for _ in 0..<1000 {
      if BudgetProbe.state.withLock({ $0.stopped }) { break }
      try await Task.sleep(for: .milliseconds(1))
    }
    // Observe transport cancellation before the protocol's withheld completion.
    #expect(BudgetProbe.state.withLock { !$0.finished && $0.stopped })
    let request = try #require(BudgetProbe.state.withLock { $0.requests.first })
    #expect(request.url?.scheme == "https")
    #expect(request.url?.host == "openrouter.ai")
    #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer budget-provider-fixture")
  }
  @Test(arguments: ["choices", "ascii", "utf8"])
  func autocompleteRejectsUnboundedShapeWithoutOptionalFileStore(shape: String) async throws {
    let contents = shape == "choices" ? ["one", "two"]
      : [shape == "ascii" ? String(repeating: "a", count: 1025) : String(repeating: "界", count: 342)]
    let payload = try JSONSerialization.data(withJSONObject: [
      "choices": contents.map { ["message": ["content": $0]] }
    ])
    BudgetProbe.state.withLock { $0 = .init(payload: payload) }
    let byok = try runtime()
    await #expect(throws: NativeAIError.self) {
      _ = try await byok.suggest(title: "", before: "A ", after: "")
    }
  }

  @Test(arguments: [401, 402, 429])
  func providerStatusIsActionableBeforeAnUnfinishedErrorBody(status: Int) async throws {
    BudgetProbe.state.withLock { $0 = .init(payload: Data(), status: status, holdTail: true) }
    let byok = try runtime()
    do {
      try await byok.validate()
      Issue.record("Provider refusal was accepted")
    } catch NativeAIError.provider(let actual) { #expect(actual == status) }
      catch { Issue.record("Provider refusal lost its actionable HTTP status") }
    #expect(BudgetProbe.state.withLock { !$0.finished })
  }

}
