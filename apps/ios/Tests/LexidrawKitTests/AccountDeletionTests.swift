import Foundation
import Testing

@testable import LexidrawKit

@Suite struct AccountDeletionTests {
  @Test func asksForWhatTheServerSaysConfirmsIt() async throws {
    let server = FakeServer { _ in (200, #"{"confirmation":"Nameless"}"#) }
    let session = try TestServer.session(server)

    #expect(try await session.deletionConfirmation().expected == "Nameless")
    let request = try #require(server.requests.only)
    #expect(request.method == .get)
    #expect(request.url.path == "/api/v1/me/delete")
  }

  /// As the web and the server compare it.
  @Test func whatIsTypedConfirmsItWhateverItsCaseAndSurroundingSpace() {
    let confirmation = DeletionConfirmation(expected: "Me@Example.test")

    #expect(confirmation.isConfirmed(by: " me@example.TEST "))
    #expect(!confirmation.isConfirmed(by: "me@example"))
    #expect(!DeletionConfirmation(expected: " ").isConfirmed(by: " "))
  }

  /// The token went with the account, so there is nothing left to revoke.
  @Test func deletingTheAccountForgetsTheToken() async throws {
    let server = FakeServer { _ in (200, #"{"id":"u1"}"#) }
    let store = InMemoryTokenStore("lxd_leaving")
    let session = try TestServer.session(server, store: store)

    try await session.deleteAccount(confirmation: "me@example.test")

    let request = try #require(server.requests.only)
    #expect(request.method == .post)
    #expect(request.url.path == "/api/v1/me/delete")
    #expect(request.json == ["confirmation": "me@example.test"])
    #expect(store.token == nil)
  }

  /// Once the server has deleted it, the token opens nothing, so the app is
  /// signed out whatever the Keychain says.
  @Test func theAccountIsGoneEvenWhenTheDeviceKeepsItsToken() async throws {
    let server = FakeServer { _ in (200, #"{"id":"u1"}"#) }
    let session = try TestServer.session(server, store: UndeletableTokenStore())

    try await session.deleteAccount(confirmation: "me@example.test")
  }

  @Test func aConfirmationTheServerRefusesKeepsTheAppSignedIn() async throws {
    let server = FakeServer { _ in
      (400, #"{"message":"The confirmation does not match this account","code":"BAD_REQUEST"}"#)
    }
    let store = InMemoryTokenStore("lxd_staying")
    let session = try TestServer.session(server, store: store)

    await #expect(throws: Refusal.self) { try await session.deleteAccount(confirmation: "someone else") }
    #expect(store.token == "lxd_staying")
  }
}
