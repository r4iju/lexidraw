import Foundation
import Security

/// Where the device's token is kept between launches.
public protocol TokenStore: Sendable {
  func load() throws -> String?
  func save(_ token: String) throws
  func delete() throws
}

/// The token in the Keychain, readable once the device has been unlocked after
/// a restart and never restored onto another device.
public struct KeychainTokenStore: TokenStore {
  public struct Failure: LocalizedError {
    public let status: OSStatus

    public var errorDescription: String? {
      let message = SecCopyErrorMessageString(status, nil) as String? ?? "Keychain error"
      return "\(message) (\(status))"
    }
  }

  let service: String

  public init(service: String) {
    self.service = service
  }

  private var item: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: "api-token",
    ]
  }

  public func load() throws -> String? {
    var query = item
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw Failure(status: status) }
    return String(decoding: data, as: UTF8.self)
  }

  public func save(_ token: String) throws {
    try delete()
    var attributes = item
    attributes[kSecValueData as String] = Data(token.utf8)
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = SecItemAdd(attributes as CFDictionary, nil)
    guard status == errSecSuccess else { throw Failure(status: status) }
  }

  public func delete() throws {
    let status = SecItemDelete(item as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
  }
}
