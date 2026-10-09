import Testing
@testable import LexidrawKit

@Suite struct AccountIdentityTests {
  @Test func accountDetailsUseOnlyTheNameAndEmailReturnedByTheService() async throws {
    let server = FakeServer { _ in
      (200, #"{"userId":"reader","email":"reader@example.test","name":"Native Reader","authKind":"token","scope":"write"}"#)
    }
    let details = try await TestServer.session(server).accountIdentity()
    #expect(details.name == "Native Reader")
    #expect(details.email == "reader@example.test")
    #expect(server.requests.only?.url.path == "/api/v1/me")
    #expect(server.requests.only?.authorization == "Bearer lxd_kept")

    let unnamed = FakeServer { _ in
      (200, #"{"userId":"reader","email":null,"name":null,"authKind":"token","scope":"write"}"#)
    }
    let missing = try await TestServer.session(unnamed).accountIdentity()
    #expect(missing.name == nil)
    #expect(missing.email == nil)
  }
}
