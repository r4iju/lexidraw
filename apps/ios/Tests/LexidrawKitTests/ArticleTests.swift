import Foundation
import Testing
@testable import LexidrawKit

@Suite struct ArticleTests {
  @Test func savedArticlePickerRequestsTheWebRecentURLList() async throws {
    let server = FakeServer { _ in (200, "[]") }
    let articles = try await TestServer.session(server).savedArticles()
    #expect(articles.isEmpty)
    let request = try #require(server.requests.first)
    #expect(request.url.query?.contains("url") == true)
    #expect(request.url.query?.contains("updatedAt") == true)
  }
  @Test func entityArticleUsesLatestDistilled() async throws {
    let server = FakeServer { _ in (200, #"{"id":"saved","title":"Saved","entityType":"url","publicAccess":"PRIVATE","shared":false,"accessLevel":"READ","elements":"{\"distilled\":{\"title\":\"Fresh\",\"contentHtml\":\"<p>Fresh</p>\"}}","appState":null,"updatedAt":"2026-10-01T00:00:00.000Z"}"#) }
    let fresh = try await TestServer.session(server).articleSnapshot(entityID: "saved")
    #expect(fresh?["title"] == "Fresh")
  }
  @Test func extractsAnArticleThroughTheAuthenticatedGeneratedAPI() async throws {
    let server = FakeServer { _ in (200, #"{"title":"Disposable article","byline":null,"siteName":"Example","wordCount":2,"excerpt":null,"contentHtml":"<p>Disposable article</p>","bestImageUrl":null,"datePublished":null,"updatedAt":"2026-10-01T00:00:00.000Z","__options":{}}"#) }
    let result = try await TestServer.session(server).extractArticle(url: URL(string: "https://example.test/article")!)
    #expect(result["title"] == "Disposable article")
    #expect(result["contentHtml"] == "<p>Disposable article</p>")
    #expect(result["byline"] == .null)
    let request = try #require(server.requests.first)
    #expect(request.method == .post)
    #expect(request.url.path.hasSuffix("/articles/extract"))
    #expect(request.authorization == "Bearer lxd_kept")
    #expect(request.json["url"] == "https://example.test/article")
  }
}
