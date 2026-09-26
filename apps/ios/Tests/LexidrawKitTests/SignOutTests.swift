import Foundation
import Testing

@testable import LexidrawKit

@Suite struct SignOutTests {
  @Test func revokesTheTokenOnTheServerAndForgetsIt() async throws {
    let server = FakeServer { _ in (200, #"{"id":"tok_1"}"#) }
    let store = InMemoryTokenStore("lxd_leaving")
    let session = try #require(try TestServer.account(store, server).restore())

    #expect(try await session.signOut() == .revoked)

    let request = try #require(server.requests.only)
    #expect(request.method == .post)
    #expect(request.url.path == "/api/v1/me/token/revoke")
    #expect(request.authorization == "Bearer lxd_leaving")
    #expect(store.token == nil)
  }

  @Test func forgetsTheTokenAndSaysSoWhenTheServerCannotBeReached() async throws {
    let server = FakeServer { _ in throw URLError(.notConnectedToInternet) }
    let store = InMemoryTokenStore("lxd_offline")
    let session = try #require(try TestServer.account(store, server).restore())

    #expect(try await session.signOut() == .stillValidOnServer)
    #expect(store.token == nil)
  }

  /// Revoked in Settings on the web already, which is what signing out asks.
  @Test func takesATokenTheServerNoLongerKnowsAsRevoked() async throws {
    let server = FakeServer { _ in (401, #"{"message":"Invalid, expired, or revoked API token","code":"UNAUTHORIZED"}"#) }
    let store = InMemoryTokenStore("lxd_gone")
    let session = try #require(try TestServer.account(store, server).restore())

    #expect(try await session.signOut() == .revoked)
    #expect(store.token == nil)
  }

}
