import XCTest
import UIKit
import LexidrawKit
import HTTPTypes
import OpenAPIRuntime
@testable import EditorHarness

@MainActor final class ArticleAccessibilityTests: XCTestCase {
  private struct Store: TokenStore {
    func load() throws -> String? { "disposable-test-token" }
    func save(_ token: String) throws {}
    func delete() throws {}
  }
  private struct Renderer: ClientTransport {
    let response: String
    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
      var headers = HTTPFields(); headers[.contentType] = "application/json"
      return (HTTPResponse(status: .ok, headerFields: headers), HTTPBody(response))
    }
  }
  func testArticleBodyExposesHeadingParagraphAndLinkInReadingOrder() async throws {
    let png = try XCTUnwrap(UIGraphicsImageRenderer(size: CGSize(width: 4, height: 4)).image { context in
      UIColor.white.setFill(); context.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
    }.pngData())
    let payload: [String: Any] = ["hash": "article", "svg": "<svg/>", "png": png.base64EncodedString(), "width": 390, "height": 200,
      "accessibleText": "Ideas\nFirst paragraph\nRead more", "links": [], "accessibility": [
        ["role": "heading", "text": "Ideas", "x": 0, "y": 0, "width": 390, "height": 30],
        ["role": "text", "text": "First paragraph", "x": 0, "y": 40, "width": 390, "height": 20],
        ["role": "link", "heading": true, "text": "Read more", "url": "https://example.com/article", "x": 0, "y": 80, "width": 80, "height": 20]
      ]]
    let response = String(decoding: try JSONSerialization.data(withJSONObject: payload), as: UTF8.self)
    let session = try XCTUnwrap(Account(origin: URL(string: "https://example.test")!, store: Store(), transport: Renderer(response: response)).restore())
    let view = RenderedEmbedView(session: session, fontFamily: "sans")
    view.isAccessibilityElement = true
    view.show(["type": "article", "version": 1])
    let rendered = expectation(description: "Article body rendered")
    view.onRendered = { rendered.fulfill() }
    view.frame = CGRect(x: 0, y: 0, width: 390, height: 200)
    _ = view.contentSize(fitting: 390)
    await fulfillment(of: [rendered], timeout: 5)
    let elements = try XCTUnwrap(view.accessibilityElements as? [UIAccessibilityElement])
    XCTAssertEqual(elements.map(\.accessibilityLabel), ["Ideas", "First paragraph", "Read more"])
    XCTAssertTrue(elements[0].accessibilityTraits.contains(.header))
    XCTAssertTrue(elements[2].accessibilityTraits.contains(.link))
    XCTAssertTrue(elements[2].accessibilityTraits.contains(.header), "A linked heading must remain in the heading rotor")
    XCTAssertEqual(elements[2].accessibilityFrameInContainerSpace, CGRect(x: 0, y: 80, width: 80, height: 20))
    XCTAssertFalse(view.isAccessibilityElement)
  }
}
