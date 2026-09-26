import Foundation
import Synchronization
import Testing

@testable import LexidrawKit

@Suite struct SignInTests {
  @Test func tradesTheCodeTheBrowserReturnsForATokenAndKeepsIt() async throws {
    let server = FakeServer { _ in (200, TestServer.issuedToken) }
    let store = InMemoryTokenStore()
    let opened = Mutex<URLComponents?>(nil)

    _ = try await TestServer.account(store, server)
      .signIn(deviceName: "iPhone") { url in
        opened.withLock { $0 = URLComponents(url: url, resolvingAgainstBaseURL: false) }
        return URL(string: "lexidraw://auth/callback?code=the-code")!
      }

    let page = try #require(opened.withLock { $0 })
    #expect(page.host == "lexidraw.test")
    #expect(page.path == "/native-sign-in")
    #expect(page[query: "redirectUri"] == "lexidraw://auth/callback")
    #expect(page[query: "codeChallengeMethod"] == "S256")
    #expect(page[query: "deviceName"] == "iPhone")

    let exchange = try #require(server.requests.only)
    #expect(exchange.method == .post)
    #expect(exchange.url.path == "/api/v1/native-sign-in/token")
    #expect(exchange.authorization == nil)
    #expect(exchange.json["code"] == "the-code")
    #expect(exchange.json["redirectUri"] == "lexidraw://auth/callback")
    let verifier = try #require(exchange.json["codeVerifier"])
    #expect(PKCE(verifier: verifier).challenge == page[query: "codeChallenge"])

    #expect(store.token == "lxd_new")
  }

  @Test func revokesTheNewTokenWhenTheDeviceCannotKeepIt() async throws {
    let server = FakeServer { request in
      request.url.path.hasSuffix("/revoke")
        ? (200, #"{"id":"token-id"}"#)
        : (200, TestServer.issuedToken)
    }

    await #expect(throws: UnwritableTokenStore.Refused.self) {
      try await TestServer.account(UnwritableTokenStore(), server)
        .signIn(deviceName: "iPhone") { _ in URL(string: "lexidraw://auth/callback?code=the-code")! }
    }
    let revoke = try #require(server.requests.last)
    #expect(server.requests.count == 2)
    #expect(revoke.method == .post)
    #expect(revoke.url.path == "/api/v1/me/token/revoke")
    #expect(revoke.authorization == "Bearer lxd_new")
  }

  @Test func keepsNothingWhenTheServerRefusesTheCode() async throws {
    let server = FakeServer { _ in
      (400, #"{"message":"Invalid, expired, or already used sign-in code","code":"BAD_REQUEST"}"#)
    }
    let store = InMemoryTokenStore()

    await #expect(throws: SignInError.refused) {
      try await TestServer.account(store, server)
        .signIn(deviceName: "iPhone") { _ in URL(string: "lexidraw://auth/callback?code=spent")! }
    }
    #expect(store.token == nil)
  }

  @Test func asksTheServerNothingWhenTheCallbackCarriesNoCode() async throws {
    let server = FakeServer { _ in (200, TestServer.issuedToken) }
    let store = InMemoryTokenStore()

    await #expect(throws: SignInError.noCode) {
      try await TestServer.account(store, server)
        .signIn(deviceName: "iPhone") { _ in URL(string: "lexidraw://auth/callback")! }
    }
    #expect(server.requests.isEmpty)
    #expect(store.token == nil)
  }

  @Test func aKeptTokenSignsInWithoutTheBrowser() throws {
    let down = FakeServer { _ in (500, "") }

    #expect(try TestServer.account(InMemoryTokenStore("lxd_kept"), down).restore() != nil)
    #expect(try TestServer.account(InMemoryTokenStore(), down).restore() == nil)
  }
}

extension Array {
  var only: Element? { count == 1 ? first : nil }
}
