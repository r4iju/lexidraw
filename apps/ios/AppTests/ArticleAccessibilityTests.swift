import XCTest
import UIKit
import ImageIO
import UniformTypeIdentifiers
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
      "articleImages": [["source":"https://example.com/disposable.gif", "alt":"Disposable picture", "textIndex":1, "x":0,"y":30,"width":64,"height":20,"objectFit":"fill","overlay":false,"refusal":"Unsupported style (#134)"]],
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
    XCTAssertEqual(elements.map(\.accessibilityLabel), ["Ideas", "Disposable picture", "First paragraph", "Read more"])
    guard elements.count == 4 else { return }
    XCTAssertTrue(elements[0].accessibilityTraits.contains(.header))
    XCTAssertTrue(elements[1].accessibilityTraits.contains(.image))
    XCTAssertTrue(elements[3].accessibilityTraits.contains(.link))
    XCTAssertTrue(elements[3].accessibilityTraits.contains(.header), "A linked heading must remain in the heading rotor")
    XCTAssertEqual(elements[3].accessibilityFrameInContainerSpace, CGRect(x: 0, y: 80, width: 80, height: 20))
    XCTAssertFalse(view.isAccessibilityElement)
  }
  func testArticleAnimatedImageUsesSharedDecoderAndVisibleAnimation() async throws {
    let data = NSMutableData()
    let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, UTType.gif.identifier as CFString, 2, nil))
    CGImageDestinationSetProperties(destination, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
    for color in [UIColor.red, UIColor.blue] {
      let image = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).image { context in color.setFill(); context.fill(CGRect(x:0,y:0,width:8,height:8)) }
      CGImageDestinationAddImage(destination, try XCTUnwrap(image.cgImage), [kCGImagePropertyGIFDictionary:[kCGImagePropertyGIFDelayTime:0.1]] as CFDictionary)
    }
    XCTAssertTrue(CGImageDestinationFinalize(destination))
    let source = "data:image/gif;base64," + (data as Data).base64EncodedString()
    let png = try XCTUnwrap(UIGraphicsImageRenderer(size: CGSize(width:100,height:100)).image { context in UIColor.white.setFill();context.fill(CGRect(x:0,y:0,width:100,height:100)) }.pngData())
    let payload: [String:Any] = ["hash":"animation","svg":"<svg/>","png":png.base64EncodedString(),"width":100,"height":100,"articleImageBasePNG":png.base64EncodedString(),"accessibility":[],"articleImages":[["source":source,"alt":"Animated colors","textIndex":0,"x":10,"y":20,"width":64,"height":48,"objectFit":"fill","overlay":true]]]
    let response = String(decoding:try JSONSerialization.data(withJSONObject:payload),as:UTF8.self)
    let session = try XCTUnwrap(Account(origin:URL(string:"https://example.test")!,store:Store(),transport:Renderer(response:response)).restore())
    let view=RenderedEmbedView(session:session,fontFamily:"sans")
    view.show(["type":"article","version":1])
    let window=UIWindow(frame:CGRect(x:0,y:0,width:100,height:100))
    let controller=UIViewController();window.rootViewController=controller;controller.view.addSubview(view);window.makeKeyAndVisible()
    defer { window.isHidden=true }
    view.frame=CGRect(x:0,y:0,width:100,height:100)
    _=view.contentSize(fitting:100)
    let presented=expectation(for:NSPredicate { _,_ in view.subviews.compactMap { $0 as? UIImageView }.contains { $0.animationImages?.count == 2 && $0.isAnimating && $0.frame == CGRect(x:10,y:20,width:64,height:48) } },evaluatedWith:view)
    await fulfillment(of:[presented],timeout:5)
  }

}
