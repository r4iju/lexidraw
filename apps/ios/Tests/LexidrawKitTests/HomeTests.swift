import Foundation
import Testing

@testable import LexidrawKit

@Suite struct HomeTests {
  /// The web's Home with no preferences saved: the server sorts by last
  /// change, newest first, and the dashboard lifts the folders out in that
  /// order above the files.
  @Test func listsTheFoldersAboveTheFilesInTheWebsOrder() async throws {
    let listing = try Fixtures.text("root-listing.json")
    let server = FakeServer { _ in (200, listing) }
    let account = Account(
      origin: URL(string: "https://lexidraw.test")!, store: InMemoryTokenStore("lxd_home"), transport: server)
    let session = try #require(try account.restore())

    let home = try await session.home()

    #expect(home.folders.map(\.title) == ["Projects", "Archive"])
    #expect(home.files.map(\.title) == ["Meeting notes", "Floor plan", "An article", "Reading list"])
    #expect(home.files.map(\.kind) == [.document, .drawing, .url, .document])

    let request = try #require(server.requests.only)
    #expect(request.method == .get)
    #expect(request.url.path == "/api/v1/entities")
    #expect(request.url[query: "parentId"] == nil)
    #expect(request.url[query: "sortBy"] == "updatedAt")
    #expect(request.url[query: "sortOrder"] == "desc")
    #expect(request.authorization == "Bearer lxd_home")
  }
}
