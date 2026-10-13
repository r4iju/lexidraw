import Foundation
import CryptoKit
import HTTPTypes
import OpenAPIRuntime

/// Cleanup reports only fixed categories. Raw filesystem/Keychain errors can contain credentials.
public struct NativeCleanupFailure: Error, LocalizedError, Sendable {
  public enum Step: String, Sendable { case providerKey, textFiles, sessionActions, narrationFiles, appToken }
  public let steps: Set<Step>
  public let signedOut: Bool
  public let accountDeleted: Bool
  public let revocationUnconfirmed: Bool
  init(steps: Set<Step>, signedOut: Bool = false, accountDeleted: Bool = false,
    revocationUnconfirmed: Bool = false) {
    self.steps = steps
    self.signedOut = signedOut
    self.accountDeleted = accountDeleted
    self.revocationUnconfirmed = revocationUnconfirmed
  }
  public var errorDescription: String? {
    var message = accountDeleted ? "Your account was deleted. " : signedOut ? "You are signed out. " : ""
    message += "Some device cleanup failed. Retry removing the device key or local files. Any remaining provider key is disabled."
    if steps.contains(.appToken) { message += " The device could not remove its saved app token." }
    if revocationUnconfirmed { message += " Server token revocation was not confirmed; revoke it in web Settings." }
    return message
  }
}

@MainActor enum NativeProviderResidue {
  private static let transient = NSMapTable<AnyObject, NSNumber>(
    keyOptions: [.weakMemory, .objectPointerPersonality], valueOptions: .strongMemory)
  private static var unscopedValues = Set<String>()
  private static func persistedScope(_ store: any TokenStore) -> String? {
    (store as? KeychainProviderStore).map { "lexidraw.byok.pending-removal." + $0.custodyScope }
  }
  static func contains(_ store: any TokenStore) -> Bool {
    if let scope = persistedScope(store) { return UserDefaults.standard.bool(forKey: scope) }
    if Mirror(reflecting: store).displayStyle == .class {
      return transient.object(forKey: store as AnyObject) != nil
    }
    return unscopedValues.contains(String(reflecting: type(of: store)))
  }
  static func mark(_ store: any TokenStore) {
    if let scope = persistedScope(store) { UserDefaults.standard.set(true, forKey: scope) }
    else if Mirror(reflecting: store).displayStyle == .class {
      transient.setObject(true, forKey: store as AnyObject)
    } else { unscopedValues.insert(String(reflecting: type(of: store))) }
  }
  static func clear(_ store: any TokenStore) {
    if let scope = persistedScope(store) { UserDefaults.standard.removeObject(forKey: scope) }
    else if Mirror(reflecting: store).displayStyle == .class {
      transient.removeObject(forKey: store as AnyObject)
    }
    // Unscoped value stores cannot prove which surviving entry was removed.
    // They require explicit key setup for each subsequent runtime in this process.
  }
}

/// This check is inside the credential scanner, immediately before network dispatch.
struct SessionBoundTransport: ClientTransport {
  let underlying: any ClientTransport
  let lifetime: NativeAIHandle
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?) {
    try await lifetime.requireActive()
    return try await underlying.send(request, body: body, baseURL: baseURL, operationID: operationID)
  }
}

/// A failed token deletion must not turn a later local restore into sign-in.
/// The persisted flag identifies the Keychain namespace, never token material.
final class NativeAppTokenResidue: @unchecked Sendable {
  static let shared = NativeAppTokenResidue()
  private let lock = NSLock()
  private let transient = NSMapTable<AnyObject, NSNumber>(
    keyOptions: [.weakMemory, .objectPointerPersonality], valueOptions: .strongMemory)
  private var unscopedValues = Set<String>()
  private func scope(_ store: any TokenStore) -> String? {
    guard let keychain = store as? KeychainTokenStore else { return nil }
    let namespace = keychain.service + "\n" + (keychain.accessGroup ?? "")
    return "lexidraw.auth.pending-removal." + SHA256.hash(data: Data(namespace.utf8)).map { String(format: "%02x", $0) }.joined()
  }
  func contains(_ store: any TokenStore) -> Bool {
    lock.lock(); defer { lock.unlock() }
    if let scope = scope(store) { return UserDefaults.standard.bool(forKey: scope) }
    if Mirror(reflecting: store).displayStyle == .class { return transient.object(forKey: store as AnyObject) != nil }
    return unscopedValues.contains(String(reflecting: type(of: store)))
  }
  func mark(_ store: any TokenStore) {
    lock.lock(); defer { lock.unlock() }
    if let scope = scope(store) { UserDefaults.standard.set(true, forKey: scope) }
    else if Mirror(reflecting: store).displayStyle == .class { transient.setObject(true, forKey: store as AnyObject) }
    else { unscopedValues.insert(String(reflecting: type(of: store))) }
  }
  func clear(_ store: any TokenStore) {
    lock.lock(); defer { lock.unlock() }
    if let scope = scope(store) { UserDefaults.standard.removeObject(forKey: scope) }
    else if Mirror(reflecting: store).displayStyle == .class { transient.removeObject(forKey: store as AnyObject) }
    // An unscoped value store cannot prove which surviving entry was deleted.
  }
}
