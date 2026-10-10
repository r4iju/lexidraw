import Foundation
import Testing
@testable import LexidrawKit

@Suite("Sandbox StoreKit boundary") @MainActor
struct StoreKitSandboxTests {
  @Test func defaultNativeAdapterHasNoPurchaseOrRestorePath() async throws {
    let store = StoreKit2SandboxTransport()
    await #expect(throws: (any Error).self) { _ = try await store.prepare(productID: "xyz.raiju.lexidraw.pro.monthly") }
    await #expect(throws: (any Error).self) { _ = try await store.purchase(productID: "xyz.raiju.lexidraw.pro.monthly", accountToken: UUID()) }
    await #expect(throws: (any Error).self) { _ = try await store.restore(productID: "xyz.raiju.lexidraw.pro.monthly") }
  }
  @Test func pendingCancellationAndServerRevocationNeverClaimOrFinish() async throws {
    let store = FixtureStore(environment: .sandbox)
    let server = FixtureAppleServer()
    let purchase = StoreKitSandbox(store: store, server: server)
    store.result = .pending
    #expect(try await purchase.purchase() == .pending)
    store.result = .cancelled
    #expect(try await purchase.purchase() == .cancelled)
    server.enabled = false
    await #expect(throws: (any Error).self) { try await purchase.purchase() }
    await #expect(throws: (any Error).self) { try await purchase.restore() }
    #expect(store.purchases == 2)
    #expect(store.restores == 0)
    #expect(server.claims.isEmpty)
  }
  @Test func sandboxResultFinishesOnlyAfterServerAcceptanceAndWrongAccountNeverClaims() async throws {
    let store = FixtureStore(environment: .sandbox)
    let server = FixtureAppleServer()
    let purchase = StoreKitSandbox(store: store, server: server)
    let token = try #require(try await server.gate().appAccountToken)
    var finishes = 0
    let transaction = SandboxStoreTransaction(signedTransaction: "mock-transport-not-apple-security-proof", environment: .sandbox, productID: "xyz.raiju.lexidraw.pro.monthly", accountToken: token, finish: { finishes += 1 })
    store.result = .transaction(transaction)
    server.reject = true
    await #expect(throws: (any Error).self) { try await purchase.purchase() }
    #expect(finishes == 0)
    server.reject = false
    #expect(try await purchase.purchase() == .verified)
    #expect(finishes == 1)
    store.restored = [transaction, transaction]
    #expect(try await purchase.restore() == .restored(2))
    #expect(finishes == 3)
    store.restored = [SandboxStoreTransaction(signedTransaction: "stolen", environment: .sandbox, productID: transaction.productID, accountToken: UUID(), finish: { finishes += 1 })]
    await #expect(throws: (any Error).self) { try await purchase.restore() }
    #expect(server.claims.count == 3)
    #expect(finishes == 3)
  }
  @Test func productionAndLocalXcodeNeverReachPurchaseOrRestore() async throws {
    for environment in [StoreKitTestEnvironment.production, .xcode, .unavailable] {
      let store = FixtureStore(environment: environment)
      let server = FixtureAppleServer()
      let purchase = StoreKitSandbox(store: store, server: server)
      await #expect(throws: (any Error).self) { try await purchase.purchase() }
      await #expect(throws: (any Error).self) { try await purchase.restore() }
      #expect(store.purchases == 0)
      #expect(store.restores == 0)
      #expect(server.claims.isEmpty)
    }
  }
}
@MainActor private final class FixtureStore: SandboxStoreTransport {
  var environment: StoreKitTestEnvironment
  var purchases = 0
  var restores = 0
  var result = SandboxPurchaseResult.cancelled
  var restored: [SandboxStoreTransaction] = []
  init(environment: StoreKitTestEnvironment) { self.environment = environment }
  func prepare(productID: String) async throws -> StoreKitTestEnvironment { environment }
  func purchase(productID: String, accountToken: UUID) async throws -> SandboxPurchaseResult { purchases += 1; return result }
  func restore(productID: String) async throws -> [SandboxStoreTransaction] { restores += 1; return restored }
}
@MainActor private final class FixtureAppleServer: SandboxAppleServer {
  var claims: [String] = []
  var enabled = true
  var reject = false
  func gate() async throws -> AppleSandboxGate { AppleSandboxGate(available: enabled, environment: "sandbox", appAccountToken: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!, productId: "xyz.raiju.lexidraw.pro.monthly", bundleId: "xyz.raiju.lexidraw") }
  func claim(_ jws: String) async throws { if reject { throw NativeAIError.unavailable }; claims.append(jws) }
}
@Suite("Apple authenticated wire contract")
struct AppleSandboxWireTests {
  @Test func malformedSuccessCannotAcknowledgeATransaction() async throws {
    let server = FakeServer { _ in (200, #"{"not":"a verified account result"}"#) }
    let session = try TestServer.session(server)
    await #expect(throws: (any Error).self) { try await session.appleSandboxClaim("fixture.signed.transport") }
  }
}
