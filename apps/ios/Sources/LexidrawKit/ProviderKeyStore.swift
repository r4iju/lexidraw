import CryptoKit
import Foundation
import Security

/// Account identity scopes custody; there is no shared access group or cloud
/// synchronization. Signing out deletes this account's entry on this device.
public struct KeychainProviderStore: TokenStore {
  let accountID: String
  let origin: String
  public init(accountID: String, origin: URL) {
    self.accountID = accountID
    self.origin = origin.absoluteString
  }
  var query: [String: Any] {
    let scope = SHA256.hash(data: Data((origin + "\n" + accountID).utf8)).map {
      String(format: "%02x", $0)
    }.joined()
    return [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "xyz.raiju.lexidraw.byok.openrouter",
      kSecAttrAccount as String: scope,
      kSecAttrSynchronizable as String: false,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    ]
  }
  public func load() throws -> String? {
    var attributes = query
    attributes[kSecReturnData as String] = true
    attributes[kSecMatchLimit as String] = kSecMatchLimitOne
    var found: CFTypeRef?
    let status = SecItemCopyMatching(attributes as CFDictionary, &found)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let bytes = found as? Data else {
      throw NativeAIError.unavailable
    }
    return String(decoding: bytes, as: UTF8.self)
  }
  public func save(_ token: String) throws {
    let changes = [kSecValueData as String: Data(token.utf8)]
    let status = SecItemUpdate(query as CFDictionary, changes as CFDictionary)
    if status == errSecItemNotFound {
      var attributes = query
      attributes[kSecValueData as String] = Data(token.utf8)
      guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else {
        throw NativeAIError.unavailable
      }
    } else if status != errSecSuccess {
      throw NativeAIError.unavailable
    }
  }
  public func delete() throws {
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw NativeAIError.unavailable
    }
  }
}

final class NativeAIHandle: Sendable {
  let defaultStore: (any TokenStore)?
  let files: NativeTextFileStore?
  init(defaultStore: (any TokenStore)? = nil, files: NativeTextFileStore? = nil) {
    self.defaultStore = defaultStore
    self.files = files
  }
  @MainActor private var runtime: NativeBYOK?
  @MainActor private var ended = false
  @MainActor func existing() throws -> NativeBYOK? {
    guard !ended else { throw NativeAIError.expired }
    return runtime
  }
  @MainActor func attach(store: any TokenStore, configuration: URLSessionConfiguration) throws
    -> NativeBYOK
  {
    guard !ended else { throw NativeAIError.expired }
    if let runtime { return runtime }
    let created = NativeBYOK(store: store, configuration: configuration, files: files)
    runtime = created
    return created
  }
  @MainActor func endSession() throws {
    ended = true
    if let runtime { try runtime.endSession() }
    else { try defaultStore?.delete(); try files?.clear() }
  }
}

extension Session {
  @MainActor public func nativeAI() async throws -> NativeBYOK {
    if let existing = try aiHandle.existing() { return existing }
    let identity = try await accountIdentity()
    guard let keys = providerKeyStore?(identity.id) ?? aiHandle.defaultStore else {
      throw NativeAIError.unavailable
    }
    return try aiHandle.attach(store: keys, configuration: providerConfiguration())
  }
}
