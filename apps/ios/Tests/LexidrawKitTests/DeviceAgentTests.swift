import Foundation
import Synchronization
import Testing
@testable import LexidrawKit
private final class AgentKey: TokenStore, @unchecked Sendable {
 var value: String?
 func load() throws -> String? { value }
 func save(_ token: String) throws { value = token }
 func delete() throws { value = nil }
}
private final class AgentProvider: URLProtocol, @unchecked Sendable {
 static let requests = Mutex<[URLRequest]>([])
 override class func canInit(with request: URLRequest) -> Bool { true }
 override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
 override func startLoading() {
  let count = Self.requests.withLock { $0.append(request); return $0.count }
  let output = count == 1 ? #"{"edits":["Add paragraph"]}"# : count == 2 ? #"{"kind":"append","text":"Native saved edit"}"# : #"{"kind":"done"}"#
  let data = try! JSONSerialization.data(withJSONObject: ["choices": [["message": ["content": output]]]])
  client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type":"application/json"])!, cacheStoragePolicy: .notAllowed)
  client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
 }
 override func stopLoading() {}
}
@Suite(.serialized) @MainActor struct DeviceAgentTests {
 @Test func sharedJavaScriptOrchestrationDirectProviderAndKeyFreeDocumentEdit() async throws {
  AgentProvider.requests.withLock { $0 = [] }
  let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [AgentProvider.self]
  let runtime = NativeBYOK(store: AgentKey(), configuration: config, agentFixture: true)
  try runtime.replaceKey("opaque-native-agent-fixture-288")
  let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  var mutations: [NativeDeviceMutation] = []
  let flow = NativeDeviceAgentFlow(account: "alice", document: "doc", runtime: runtime, directory: directory, available: true, read: { .init(revision: 1, text: "Existing") }, apply: { input in mutations.append(input); return .init(revision: 2, description: "Native saved edit") })
  try await flow.start(prompt: "Add paragraph")
  #expect(flow.checkpoint?.status == "complete")
  #expect(flow.checkpoint?.receipts.count == 1)
  #expect(mutations.count == 1)
  for request in AgentProvider.requests.withLock({ $0 }) {
   #expect(request.url?.absoluteString == "https://openrouter.ai/api/v1/chat/completions")
   #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer opaque-native-agent-fixture-288")
   #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
   #expect(!String(decoding: request.httpBody ?? Data(), as: UTF8.self).contains("opaque-native-agent-fixture-288"))
  }
  try runtime.removeKey()
  let restored = NativeDeviceAgentFlow(account: "alice", document: "doc", runtime: runtime, directory: directory, available: true, read: { .init(revision: 1, text: "Existing") }, apply: { _ in Issue.record("Duplicate edit"); return .init(revision: 3, description: "duplicate") })
  try restored.restore(); try await restored.resume()
  #expect(restored.checkpoint?.receipts.count == 1)
  #expect(AgentProvider.requests.withLock { $0.count } == 3)
 }
 @Test func replacingKeyDuringDocumentReadCannotStartOldAction() async throws {
  AgentProvider.requests.withLock { $0 = [] }
  let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [AgentProvider.self]
  let runtime = NativeBYOK(store: AgentKey(), configuration: config, agentFixture: true)
  try runtime.replaceKey("opaque-native-read-old-288")
  let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let flow = NativeDeviceAgentFlow(account: "alice", document: "doc", runtime: runtime, directory: directory, available: true, read: {
   try runtime.removeKey(); try runtime.replaceKey("opaque-native-read-new-288")
   return .init(revision: 1, text: "Existing")
  }, apply: { _ in Issue.record("Unexpected mutation"); return .init(revision: 2, description: "unexpected") })
  try await flow.start(prompt: "Add paragraph")
  #expect(flow.checkpoint == nil)
  #expect(AgentProvider.requests.withLock { $0.isEmpty })
 }

}
