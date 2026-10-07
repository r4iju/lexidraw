import Testing
@testable import LexidrawKit

@Suite struct SocialIdentityTests {
  @Test func usesTheAccountIdentityForVotingAndCommentAuthors() async throws {
    let server = FakeServer { _ in (200, #"{"userId":"reader","email":"reader@example.test","name":"Native Reader","authKind":"token","scope":"write"}"#) }
    let identity = try await TestServer.session(server).identity()
    #expect(identity.id == "reader")
    #expect(identity.name == "Native Reader")
    #expect(server.requests.count == 1)
    #expect(server.requests.first?.url.path.hasSuffix("/me") == true)
  }
}
