import CryptoKit
import Foundation

public struct NativeArtifactOwner: Codable, Equatable, Sendable {
  public let origin: String
  public let account: String
  public let document: String
  public let namespace: String
  public init(origin: URL, account: String, document: String, namespace: String) throws {
    guard var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
      let scheme = parts.scheme?.lowercased(), ["https", "http"].contains(scheme),
      let host = parts.host?.lowercased(), !host.isEmpty,
      parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
      ["", "/"].contains(parts.path), !account.isEmpty, account.utf8.count <= 100,
      !document.isEmpty, document.utf8.count <= 100, !namespace.isEmpty, namespace.utf8.count <= 100
    else { throw NativeAIError.rejected }
    parts.scheme = scheme; parts.host = host; parts.path = ""
    if (scheme == "https" && parts.port == 443) || (scheme == "http" && parts.port == 80) { parts.port = nil }
    guard let canonical = parts.string, canonical.utf8.count <= 2048 else { throw NativeAIError.rejected }
    self.origin = canonical; self.account = account; self.document = document; self.namespace = namespace
  }
  public var storageKey: String {
    let tuple = ["artifact-owner-v1", origin, account, document, namespace]
    // A string array has no failing Encodable customization.
    let data = try! JSONEncoder().encode(tuple)
    return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
  }
}
