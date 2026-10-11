import Foundation
import Testing

@testable import LexidrawKit

private final class FailingLifecycleKey: TokenStore, @unchecked Sendable {
  var value: String? = "lifecycle-synthetic-provider-key"
  var fail = true
  var deleteAttempts = 0
  func load() throws -> String? { value }
  func save(_ token: String) throws { value = token }
  func delete() throws {
    deleteAttempts += 1
    if fail { throw NSError(domain: "fixture", code: 1,
      userInfo: [NSLocalizedDescriptionKey: value ?? "failed"]) }
    value = nil
  }
}

private final class FailingAppToken: TokenStore, @unchecked Sendable {
  var deleteAttempts = 0
  func load() throws -> String? { "lxd_failed_local_deletion_fixture" }
  func save(_ token: String) throws {}
  func delete() throws { deleteAttempts += 1; throw NativeAIError.unavailable }
}
private final class UnadmittedKey: TokenStore, @unchecked Sendable {
  var value: String? = "stored-unadmitted-custody-fixture"
  let failLoad: Bool
  init(failLoad: Bool) { self.failLoad = failLoad }
  func load() throws -> String? {
    if failLoad { throw NativeAIError.unavailable }
    return value
  }
  func save(_ token: String) throws { value = token }
  func delete() throws { value = nil }
}
@Suite(.serialized) @MainActor struct NativeLifecycleTests {
  @Test func failedLocalTokenDeletionAndOfflineRevocationCannotRestoreUsableAuthentication() async throws {
    let tokens = FailingAppToken()
    let keys = FailingLifecycleKey()
    let server = FakeServer { request in
      if request.url.path == "/api/v1/me" {
        return (200, #"{"userId":"failed-token-reader","email":null,"name":null,"authKind":"token","scope":"write"}"#)
      }
      throw URLError(.notConnectedToInternet)
    }
    let account = Account(origin: TestServer.origin, store: tokens, transport: server, providerKeyStore: { _ in keys })
    let session = try #require(try account.restore())
    _ = try await session.nativeAI()
    do { _ = try await session.signOut(); Issue.record("Expected cleanup failure") }
    catch let failure as NativeCleanupFailure {
      #expect(failure.signedOut && failure.revocationUnconfirmed)
      #expect(failure.steps.contains(.appToken) && failure.steps.contains(.providerKey))
    }
    #expect(tokens.deleteAttempts == 1)
    #expect(server.requests.contains { $0.url.path == "/api/v1/me/token/revoke" })
    #expect(try account.restore() == nil)
    await #expect(throws: NativeAIError.self) { _ = try await session.accountIdentity() }
  }
  @Test func failedKeyDeletionStillClearsTextAndEveryCallbackAndQuarantinesResidue() throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let files = NativeTextFileStore(directory: directory)
    try files.save("Retained suggestion")
    let keys = FailingLifecycleKey()
    let runtime = NativeBYOK(store: keys, files: files)
    let reference = try runtime.credentialReference()
    var first = false, second = false
    runtime.onSessionEnd { first = true; throw NativeAIError.unavailable }
    runtime.onSessionEnd { second = true }
    do { try runtime.endSession(); Issue.record("Cleanup failure was hidden") }
    catch { #expect(!error.localizedDescription.contains("synthetic-provider-key")) }
    #expect(!runtime.isCurrent(reference))
    #expect(try files.load() == nil)
    #expect(first && second)
    let fresh = NativeBYOK(store: keys)
    #expect(!fresh.hasKey)
    // Retrying cleanup succeeds without restoring credential usability.
    keys.fail = false
    do { try runtime.endSession() } catch {}
    #expect(keys.value == nil)
    #expect(keys.deleteAttempts == 2)
  }
  @Test(arguments: [true, false])
  func providerFailureDoesNotPreventRevocationTokenDeletionOrNarrationCleanup(serverAvailable: Bool) async throws {
    let keys = FailingLifecycleKey()
    let tokens = InMemoryTokenStore("lxd_lifecycle_fixture")
    let server = FakeServer { request in
      if request.url.path == "/api/v1/me" {
        return (200, #"{"userId":"lifecycle-reader","email":null,"name":null,"authKind":"token","scope":"write"}"#)
      }
      if !serverAvailable { throw URLError(.notConnectedToInternet) }
      return (200, #"{"id":"token"}"#)
    }
    let account = Account(origin: TestServer.origin, store: tokens, transport: server,
      providerKeyStore: { _ in keys })
    let session = try #require(try account.restore())
    let runtime = try await session.nativeAI()
    let directory = try #require(session.aiHandle.narrationDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    try Data("retained recording fixture".utf8).write(to: directory.appending(path: "fixture"))
    var callback = false
    runtime.onSessionEnd { callback = true }
    do { _ = try await session.signOut(); Issue.record("Cleanup failure hidden") }
    catch { #expect(!error.localizedDescription.contains("synthetic-provider-key")) }
    #expect(server.requests.contains { $0.url.path == "/api/v1/me/token/revoke" })
    #expect(tokens.token == nil)
    #expect(callback)
    #expect(!FileManager.default.fileExists(atPath: directory.path))
    #expect(try account.restore() == nil)
    await #expect(throws: NativeAIError.self) { _ = try await session.accountIdentity() }
  }

  @Test func accountDeletionReportsCleanupFailureAfterDeletingAuthAndAttemptsAllFiles() async throws {
    let keys = FailingLifecycleKey()
    let tokens = InMemoryTokenStore("lxd_delete_lifecycle_fixture")
    let server = FakeServer { request in
      request.url.path == "/api/v1/me"
        ? (200, #"{"userId":"delete-reader","email":null,"name":null,"authKind":"token","scope":"write"}"#)
        : (200, #"{"id":"delete-reader"}"#)
    }
    let session = try #require(try Account(origin: TestServer.origin, store: tokens, transport: server,
      providerKeyStore: { _ in keys }).restore())
    let runtime = try await session.nativeAI()
    var callback = false
    runtime.onSessionEnd { callback = true }
    do { try await session.deleteAccount(confirmation: "delete-reader"); Issue.record("Cleanup failure hidden") }
    catch { #expect(error is NativeCleanupFailure) }
    #expect(tokens.token == nil)
    #expect(callback)
    await #expect(throws: NativeAIError.self) { _ = try await session.accountIdentity() }
  }

  @Test func endedSessionCannotUseAppAuthThroughManualRequestPath() async throws {
    let server = FakeServer { _ in (200, #"{"id":"token"}"#) }
    let session = try TestServer.session(server, store: InMemoryTokenStore("lxd_manual_lifecycle"))
    _ = try await session.signOut()
    let priorRequests = server.requests.count
    await #expect(throws: NativeAIError.self) { try await session.move("doc", to: nil) }
    #expect(server.requests.count == priorRequests)
  }

  @Test(arguments: [false, true])
  func storedOrUnreadableKeyRemainsVisibleForRemovalWhenAdmissionFails(failLoad: Bool) throws {
    let keys = UnadmittedKey(failLoad: failLoad)
    let guarder = NativeCredentialGuard()
    for index in 1...128 { try guarder.remember("custody-retired-fixture-\(index)") }
    let runtime = NativeBYOK(store: keys, credentialGuard: guarder)
    #expect(!runtime.hasKey)
    // The existing device UI exposes removal only for these public custody flags.
    #expect(runtime.hasKey || runtime.cleanupPending)
    #expect(throws: NativeAIError.self) { try runtime.credentialReference() }
    try runtime.removeKey()
    #expect(keys.value == nil)
    #expect(!runtime.hasKey && !runtime.cleanupPending)
  }

}
