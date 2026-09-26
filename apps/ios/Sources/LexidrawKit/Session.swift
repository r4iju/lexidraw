import Foundation

/// What a signed-in app can do. Only an ``Account`` makes one, from a token it
/// holds.
public struct Session: Sendable {
  let client: Client
  let store: any TokenStore

  /// The top of the caller's files, as the web's Home shows them.
  public func home() async throws -> Home {
    let listing = try await client.entitiesList(query: .init(sortBy: .updatedAt, sortOrder: .desc))
    return Home(listing: try listing.ok.body.json)
  }

  public enum SignOut: Sendable, Equatable {
    case revoked
    /// The token is gone from this device, but the server may still take it
    /// until it is revoked in Settings on the web.
    case stillValidOnServer
  }

  /// Revokes the token on the server, then forgets it here whatever the
  /// server said, so a failed request never leaves the app signed in.
  public func signOut() async throws -> SignOut {
    let outcome: SignOut
    do {
      switch try await client.tokensRevokeCurrent(body: .json(.init())) {
      // A token the server no longer takes has been revoked already.
      case .ok, .unauthorized: outcome = .revoked
      default: outcome = .stillValidOnServer
      }
    } catch {
      outcome = .stillValidOnServer
    }
    try store.delete()
    return outcome
  }
}
