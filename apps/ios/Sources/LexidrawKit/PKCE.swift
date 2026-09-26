import CryptoKit
import Foundation
import Security

/// The proof that the app trading a sign-in code is the one that asked for it
/// (RFC 7636, S256): the browser only ever sees the challenge.
struct PKCE: Sendable {
  let verifier: String

  /// 32 random bytes, which base64url writes as 43 characters, the least the
  /// RFC allows.
  init() {
    var bytes = [UInt8](repeating: 0, count: 32)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    precondition(status == errSecSuccess, "The system random number generator failed")
    self.init(verifier: Data(bytes).base64URLEncoded)
  }

  init(verifier: String) {
    self.verifier = verifier
  }

  var challenge: String {
    Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded
  }
}

extension Data {
  fileprivate var base64URLEncoded: String {
    base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
