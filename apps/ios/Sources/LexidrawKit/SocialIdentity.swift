public struct SocialIdentity: Sendable {
  public let id: String
  public let name: String
}

extension Session {
  public func identity() async throws -> SocialIdentity {
    let user = try await ask { try await $0.authMe() }.ok.body.json
    return SocialIdentity(id: user.userId, name: user.name ?? "Guest")
  }
}
