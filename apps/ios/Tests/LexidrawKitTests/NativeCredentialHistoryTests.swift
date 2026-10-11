import Foundation
import Testing

@testable import LexidrawKit

private final class HistoryKey: TokenStore, @unchecked Sendable {
  var value: String?
  func load() throws -> String? { value }
  func save(_ token: String) throws { value = token }
  func delete() throws { value = nil }
}
@Suite(.serialized) @MainActor struct NativeCredentialHistoryTests {
  @Test func coldSessionAdmissionLoadsRetiredCheckpointDetectorsBeforePersistingANewKey() async throws {
    let keys = HistoryKey()
    keys.value = "cold-checkpoint-credential-128"
    let admitted = NativeCredentialGuard()
    let server = FakeServer { _ in
      (200, #"{"userId":"cold-history-reader","email":null,"name":null,"authKind":"token","scope":"write"}"#)
    }
    let session = try #require(try Account(origin: TestServer.origin, store: InMemoryTokenStore("lxd_cold_history_fixture"), transport: server, providerKeyStore: { _ in keys }, providerCredentialGuard: admitted).restore())
    let root = try #require(session.aiHandle.narrationDirectory)
    defer { try? FileManager.default.removeItem(at: root) }
    let directory = root.appending(path: UUID().uuidString)
    let retired = NativeCredentialGuard()
    for index in 1...128 { try retired.remember("cold-checkpoint-credential-\(index)") }
    let checkpoint = DeviceNarrationCheckpoint(version: 1, account: "cold-history-reader", document: "doc", id: "retained", created: Date(), status: "paused", parts: [.init(kind: .pending, text: "Hello", output: nil)], fingerprints: Data())
    try NativeDeviceNarrationStore(directory: directory, credentialGuard: retired).save(checkpoint)
    let file = directory.appending(path: "checkpoint.json")
    let prior = try Data(contentsOf: file)
    // The injected detector is the exact subject, independent of process-wide capacity.
    let runtime = try await session.nativeAI()
    #expect(runtime.hasKey)
    do {
      try runtime.replaceKey("cold-checkpoint-credential-129")
      Issue.record("129th cold-history key was persisted")
    } catch NativeAIError.rejected {} catch { Issue.record("Unexpected admission refusal") }
    #expect(keys.value == "cold-checkpoint-credential-128")
    #expect(try Data(contentsOf: file) == prior)
    let reopen = NativeCredentialGuard()
    #expect(try NativeDeviceNarrationStore(directory: directory, credentialGuard: reopen).load()?.id == "retained")
    for index in 1...128 {
      #expect(throws: NativeAIError.self) { try admitted.check(Data("cold-checkpoint-credential-\(index)".utf8)) }
      #expect(throws: NativeAIError.self) { try reopen.check(Data("cold-checkpoint-credential-\(index)".utf8)) }
    }
  }
  @Test func credentialAdmissionLimitPreservesSavedCheckpointAndPriorKeyOnReopen() throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let keys = HistoryKey()
    let guarder = NativeCredentialGuard()
    let runtime = NativeBYOK(store: keys, credentialGuard: guarder)
    for index in 1...128 { try runtime.replaceKey("history-fixture-key-\(index)") }
    let files = NativeDeviceNarrationStore(directory: directory, credentialGuard: guarder)
    let checkpoint = DeviceNarrationCheckpoint(version: 1, account: "alice", document: "doc",
      id: "saved", created: Date(), status: "paused",
      parts: [.init(kind: .pending, text: "Hello", output: nil)], fingerprints: Data())
    try files.save(checkpoint)
    let file = directory.appending(path: "checkpoint.json")
    let prior = try Data(contentsOf: file)
    let reference = try runtime.credentialReference()
    #expect(throws: NativeAIError.self) { try runtime.replaceKey("history-fixture-key-129") }
    #expect(keys.value == "history-fixture-key-128")
    #expect(runtime.isCurrent(reference))
    #expect(try Data(contentsOf: file) == prior)
    let reopened = NativeDeviceNarrationStore(directory: directory, credentialGuard: guarder)
    #expect(try reopened.load()?.id == "saved")
    let restored = NativeCredentialGuard()
    try restored.restore(try #require(try reopened.load()).fingerprints)
    for index in 1...128 {
      #expect(throws: NativeAIError.self) { try restored.check(Data("history-fixture-key-\(index)".utf8)) }
    }
  }
  @Test func restoringDisjointHistoryRejectsUnionOverflowWithoutDiscardingRetiredDetectors() throws {
    let full = NativeCredentialGuard()
    for index in 1...128 { try full.remember("union-fixture-key-\(index)") }
    let extra = NativeCredentialGuard()
    try extra.remember("union-fixture-key-129")
    let prior = try full.snapshot()
    #expect(throws: NativeAIError.self) { try full.restore(extra.snapshot()) }
    #expect(try full.snapshot() == prior)
    let reopened = NativeCredentialGuard()
    try reopened.restore(full.snapshot())
    #expect(throws: NativeAIError.self) { try reopened.check(Data("union-fixture-key-1".utf8)) }
    #expect(throws: NativeAIError.self) { try reopened.check(Data("union-fixture-key-128".utf8)) }
  }

  @Test func checkpointOverwriteRejectsDetectorUnionOverflowAndPreservesOriginalFile() throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let retired = NativeCredentialGuard()
    for index in 1...128 { try retired.remember("saved-retired-fixture-\(index)") }
    let value = DeviceNarrationCheckpoint(version: 1, account: "alice", document: "doc",
      id: "retained", created: Date(), status: "paused",
      parts: [.init(kind: .pending, text: "Hello", output: nil)], fingerprints: Data())
    try NativeDeviceNarrationStore(directory: directory, credentialGuard: retired).save(value)
    let file = directory.appending(path: "checkpoint.json")
    let prior = try Data(contentsOf: file)
    let newlyAdmitted = NativeCredentialGuard()
    try newlyAdmitted.remember("different-saved-fixture-key")
    let writer = NativeDeviceNarrationStore(directory: directory, credentialGuard: newlyAdmitted)
    #expect(throws: NativeAIError.self) { try writer.save(value, expected: value.revision) }
    #expect(try Data(contentsOf: file) == prior)
    let reopenGuard = NativeCredentialGuard()
    let reopened = NativeDeviceNarrationStore(directory: directory, credentialGuard: reopenGuard)
    #expect(try reopened.load()?.id == "retained")
    #expect(throws: NativeAIError.self) { try reopenGuard.check(Data("saved-retired-fixture-1".utf8)) }
    #expect(throws: NativeAIError.self) { try reopenGuard.check(Data("saved-retired-fixture-128".utf8)) }
  }

}
