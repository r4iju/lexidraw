import Foundation
import HTTPTypes
import OpenAPIRuntime
import StoreKit

public struct AppleSandboxGate: Decodable, Sendable {
  public let available: Bool
  public let environment: String
  public let appAccountToken: UUID?
  public let productId: String?
  public let bundleId: String?
}
public enum StoreKitTestEnvironment: Sendable { case sandbox, production, xcode, unavailable }
public struct SandboxStoreTransaction {
  public let signedTransaction: String
  public let environment: StoreKitTestEnvironment
  public let productID: String
  public let accountToken: UUID?
  public let finish: @MainActor () async -> Void
}
public enum SandboxPurchaseResult { case transaction(SandboxStoreTransaction), pending, cancelled }
@MainActor public protocol SandboxStoreTransport {
  func prepare(productID: String) async throws -> StoreKitTestEnvironment
  func purchase(productID: String, accountToken: UUID) async throws -> SandboxPurchaseResult
  func restore(productID: String) async throws -> [SandboxStoreTransaction]
}
@MainActor public protocol SandboxAppleServer {
  func gate() async throws -> AppleSandboxGate
  func claim(_ jws: String) async throws
}
public enum SandboxPurchaseOutcome: Sendable, Equatable { case verified, pending, cancelled, restored(Int) }
@MainActor public final class StoreKitSandbox {
  private let store: any SandboxStoreTransport
  private let server: any SandboxAppleServer
  public init(store: any SandboxStoreTransport, server: any SandboxAppleServer) { self.store = store; self.server = server }
  public convenience init(session: Session) { self.init(store: StoreKit2SandboxTransport(), server: SessionAppleSandboxServer(session: session)) }
  private func prepare() async throws -> (String, UUID) {
    let gate = try await server.gate()
    guard gate.available, gate.environment == "sandbox", gate.bundleId == "xyz.raiju.lexidraw",
      let product = gate.productId, product == "xyz.raiju.lexidraw.pro.monthly", let token = gate.appAccountToken
    else { throw NativeAIError.unavailable }
    guard try await store.prepare(productID: product) == .sandbox else { throw NativeAIError.unavailable }
    try Task.checkCancellation()
    return (product, token)
  }
  public func availability() async -> Bool { (try? await prepare()) != nil }
  private func accept(_ transaction: SandboxStoreTransaction, product: String, token: UUID) async throws {
    guard transaction.environment == .sandbox, transaction.productID == product, transaction.accountToken == token else { throw NativeAIError.unavailable }
    try Task.checkCancellation()
    // StoreKit verification is a device sanity check. Only the server can grant the account allowance.
    try await server.claim(transaction.signedTransaction)
    await transaction.finish()
  }
  public func purchase() async throws -> SandboxPurchaseOutcome {
    let (product, token) = try await prepare()
    switch try await store.purchase(productID: product, accountToken: token) {
    case .pending: return .pending
    case .cancelled: return .cancelled
    case .transaction(let transaction):
      try await accept(transaction, product: product, token: token)
      return .verified
    }
  }
  public func restore() async throws -> SandboxPurchaseOutcome {
    let (product, token) = try await prepare()
    let transactions = try await store.restore(productID: product)
    guard transactions.count <= 100 else { throw NativeAIError.unavailable }
    var accepted = 0
    var failure: (any Error)?
    for transaction in transactions {
      try Task.checkCancellation()
      // Store history is device-wide; foreign entries remain untouched.
      guard transaction.environment == .sandbox, transaction.productID == product, transaction.accountToken == token else { continue }
      do { try await accept(transaction, product: product, token: token); accepted += 1 }
      catch { failure = failure ?? error }
    }
    if let failure { throw failure }
    return .restored(accepted)
  }
  public func observeUpdates(onVerified: @MainActor () async -> Void = {}) async {
    for await result in StoreKit.Transaction.updates {
      guard !Task.isCancelled else { return }
      guard case .verified(let transaction) = result else { continue }
      do {
        let (product, token) = try await prepare()
        guard transaction.productID == product else { continue }
        try await accept(StoreKit2SandboxTransport.wrap(transaction, jws: result.jwsRepresentation), product: product, token: token)
        await onVerified()
      } catch { /* Keep unfinished transactions for retry after reconnect or restore. */ }
    }
  }
}

@MainActor public final class StoreKit2SandboxTransport: SandboxStoreTransport {
  private var product: Product?
  public init() {}
  private func sandboxDistribution() async throws {
    // Default, release, App Store and simulator builds cannot invoke purchase or sync.
    // A dedicated internal DEBUG build must opt in, then prove the app receipt is sandbox before purchase.
    #if DEBUG && LEXIDRAW_STOREKIT_SANDBOX && !targetEnvironment(simulator)
      guard Bundle.main.bundleIdentifier == "xyz.raiju.lexidraw",
        case .verified(let app) = try await AppTransaction.shared, app.environment == .sandbox
      else { throw NativeAIError.unavailable }
    #else
      throw NativeAIError.unavailable
    #endif
  }
  public func prepare(productID: String) async throws -> StoreKitTestEnvironment {
    try await sandboxDistribution()
    let products = try await Product.products(for: [productID])
    guard let selected = products.first, products.count == 1, selected.id == productID,
      selected.type == .autoRenewable, let subscription = selected.subscription,
      subscription.subscriptionPeriod.unit == .month, subscription.subscriptionPeriod.value == 1
    else { throw NativeAIError.unavailable }
    product = selected
    return .sandbox
  }
  public func purchase(productID: String, accountToken: UUID) async throws -> SandboxPurchaseResult {
    try await sandboxDistribution()
    guard let product, product.id == productID else { throw NativeAIError.unavailable }
    switch try await product.purchase(options: [.appAccountToken(accountToken)]) {
    case .pending: return .pending
    case .userCancelled: return .cancelled
    case .success(let result):
      guard case .verified(let transaction) = result else { throw NativeAIError.unavailable }
      return .transaction(Self.wrap(transaction, jws: result.jwsRepresentation))
    @unknown default: throw NativeAIError.unavailable
    }
  }
  public func restore(productID: String) async throws -> [SandboxStoreTransaction] {
    try await sandboxDistribution()
    try await AppStore.sync()
    var transactions: [SandboxStoreTransaction] = []
    for await result in StoreKit.Transaction.all {
      guard case .verified(let transaction) = result, transaction.productID == productID else { continue }
      guard transactions.count < 100 else { throw NativeAIError.unavailable }
      transactions.append(Self.wrap(transaction, jws: result.jwsRepresentation))
    }
    return transactions
  }
  static func wrap(_ transaction: StoreKit.Transaction, jws: String) -> SandboxStoreTransaction {
    SandboxStoreTransaction(signedTransaction: jws, environment: transaction.environment == .sandbox ? .sandbox : transaction.environment == .xcode ? .xcode : .production, productID: transaction.productID, accountToken: transaction.appAccountToken, finish: { await transaction.finish() })
  }
}
@MainActor private struct SessionAppleSandboxServer: SandboxAppleServer {
  let session: Session
  func gate() async throws -> AppleSandboxGate { try await session.appleSandboxGate() }
  func claim(_ jws: String) async throws { try await session.appleSandboxClaim(jws) }
}
extension Session {
  public func appleSandboxGate() async throws -> AppleSandboxGate {
    let data = try await appleSandboxRequest("appleSandboxGate", method: .get, json: nil)
    struct Envelope: Decodable {
      struct Result: Decodable {
        struct Body: Decodable { let json: AppleSandboxGate }
        let data: Body
      }
      let result: Result
    }
    return try JSONDecoder().decode(Envelope.self, from: data).result.data.json
  }
  public func appleSandboxClaim(_ jws: String) async throws {
    guard jws.utf8.count <= 64000 else { throw NativeAIError.unavailable }
    let data = try await appleSandboxRequest("appleSandboxClaim", method: .post, json: ["signedTransaction": jws])
    struct Envelope: Decodable {
      struct Result: Decodable {
        struct Body: Decodable { let json: ProAllowance }
        let data: Body
      }
      let result: Result
    }
    let allowance = try JSONDecoder().decode(Envelope.self, from: data).result.data.json
    guard allowance.billing?.environment == "sandbox", allowance.availableSubcredits >= 0 else { throw NativeAIError.unavailable }
  }
  private func appleSandboxRequest(_ methodName: String, method: HTTPRequest.Method, json: [String: String]?) async throws -> Data {
    let request = HTTPRequest(method: method, scheme: nil, authority: nil, path: "/pro.\(methodName)")
    let encoded = try json.map { try JSONSerialization.data(withJSONObject: ["json": $0]) }
    let (response, body) = try await connection.exchange(request, json: encoded, operationID: "pro.\(methodName)", baseURL: origin.appending(path: "api/trpc"))
    guard (200..<300).contains(response.status.code), let body else { throw NativeAIError.unavailable }
    return try await Data(collecting: body, upTo: 1 << 18)
  }
}
