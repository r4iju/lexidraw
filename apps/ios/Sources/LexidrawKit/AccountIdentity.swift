/// Account details the service actually supplies, without a placeholder profile.
public struct AccountIdentity: Sendable {
  public let name: String?
  public let email: String?
}

extension Session {
  public func accountIdentity() async throws -> AccountIdentity {
    let user = try await ask { try await $0.authMe() }.ok.body.json
    return AccountIdentity(name: user.name, email: user.email)
  }
}
