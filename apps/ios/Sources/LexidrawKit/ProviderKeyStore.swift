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
  var custodyScope: String {
    SHA256.hash(data: Data((origin + "\n" + accountID).utf8)).map {
      String(format: "%02x", $0)
    }.joined()
  }
  var query: [String: Any] {
    let scope = custodyScope
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
  let proSuggestions = ProSuggestionRecovery()
  let defaultStore: (any TokenStore)?
  let files: NativeTextFileStore?
  let narrationDirectory: URL?
  init(
    defaultStore: (any TokenStore)? = nil, files: NativeTextFileStore? = nil,
    narrationDirectory: URL? = nil
  ) {
    self.defaultStore = defaultStore
    self.files = files
    self.narrationDirectory = narrationDirectory
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
    do { try restoreRetiredDetectors() }
    catch { throw NativeAIError.rejected }
    let created = NativeBYOK(store: store, configuration: configuration, files: files)
    runtime = created
    return created
  }
  @MainActor private func restoreRetiredDetectors() throws {
    guard let narrationDirectory, FileManager.default.fileExists(atPath: narrationDirectory.path) else { return }
    struct History: Decodable { let fingerprints: Data }
    var failed = false
    guard let entries = FileManager.default.enumerator(at: narrationDirectory,
      includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey],
      options: [.skipsHiddenFiles, .skipsPackageDescendants], errorHandler: { _, _ in failed = true; return false }) else { throw NativeAIError.rejected }
    var count = 0, bytes = 0
    for case let file as URL in entries where file.lastPathComponent == "checkpoint.json" {
      let values = try file.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
      guard values.isRegularFile == true, values.isSymbolicLink != true, let size = values.fileSize,
        size <= 63_000_000 else { throw NativeAIError.rejected }
      count += 1
      bytes += size
      // Admission has its own finite read/work budget; existing audio format
      // limits and checkpoint bytes remain unchanged and are never overwritten.
      guard count <= 128, bytes <= 128 << 20 else { throw NativeAIError.rejected }
      let history = try JSONDecoder().decode(History.self, from: Data(contentsOf: file))
      try NativeCredentialGuard.shared.restore(history.fingerprints)
    }
    guard !failed else { throw NativeAIError.rejected }
  }
  @MainActor func requireActive() throws {
    guard !ended else { throw NativeAIError.expired }
  }
  @MainActor func endSession() throws {
    ended = true
    var failures = Set<NativeCleanupFailure.Step>()
    if let runtime {
      do { try runtime.endSession() }
      catch let failure as NativeCleanupFailure { failures.formUnion(failure.steps) }
      catch { failures.insert(.sessionActions) }
    } else {
      if let defaultStore {
        NativeProviderResidue.mark(defaultStore)
        do { try defaultStore.delete(); NativeProviderResidue.clear(defaultStore) }
        catch { failures.insert(.providerKey) }
      }
      do { try files?.clear() } catch { failures.insert(.textFiles) }
    }
    if let narrationDirectory, FileManager.default.fileExists(atPath: narrationDirectory.path) {
      do { try FileManager.default.removeItem(at: narrationDirectory) }
      catch { failures.insert(.narrationFiles) }
    }
    if !failures.isEmpty { throw NativeCleanupFailure(steps: failures) }
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
