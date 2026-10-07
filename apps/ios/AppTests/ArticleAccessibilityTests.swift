import XCTest
import UIKit
import ImageIO
import UniformTypeIdentifiers
import LexidrawKit
import LexicalSwift
import TextKitEditor
import EditorModelInterface
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
  func testReadOnlyRichCopyPublishesStandardRTFBoldAndLink() throws {
    let model=Editor()
    try model.load(["root":["type":"root","version":1,"children":[["type":"paragraph","version":1,"children":[["type":"text","version":1,"text":"bold","format":1],["type":"link","version":1,"url":"https://example.com","children":[["type":"text","version":1,"text":"link"]]]]]]]])
    let view=EditorView(model:model,isEditable:false)
    view.frame=CGRect(x:0,y:0,width:390,height:300)
    view.layoutIfNeeded()
    view.selectedTextRange=view.textRange(from:view.beginningOfDocument,to:view.endOfDocument)
    view.pasteboard=UIPasteboard(name:UIPasteboard.Name(rawValue:UUID().uuidString),create:true)!
    view.copy(nil)
    let data=view.pasteboard.data(forPasteboardType:UTType.rtf.identifier)
    XCTAssertNotNil(data,"External rich copy must publish standard RTF")
    guard let data else {return}
    let attributed=try NSAttributedString(data:data,options:[.documentType:NSAttributedString.DocumentType.rtf],documentAttributes:nil)
    let font=try XCTUnwrap(attributed.attribute(.font,at:0,effectiveRange:nil) as? UIFont)
    XCTAssertTrue(font.fontDescriptor.symbolicTraits.contains(.traitBold))
    XCTAssertNotNil(attributed.attribute(.link,at:4,effectiveRange:nil))
  }

  func testSelectedArticleTextCopiesRichNodesWithoutEditingTheArticle() async throws {
    let session = try XCTUnwrap(Account(origin: URL(string:"https://example.test")!, store:Store(), transport:Renderer(response:"{}")).restore())
    let view=RenderedEmbedView(session:session,fontFamily:"sans")
    let html="<p>Read <strong>bold</strong> and <a href=\"https://example.com\">link</a>.</p><ul><li>First item</li><li>Second item</li></ul>"
    view.show(["type":"article","version":1,"data":["mode":"url","url":"https://example.com","distilled":["contentHtml":.string(html)]]])
    let window=UIWindow(frame:CGRect(x:0,y:0,width:390,height:844))
    let parent=UIViewController();window.rootViewController=parent;parent.view.addSubview(view);window.makeKeyAndVisible()
    defer {window.isHidden=true}
    view.selectArticleText("Read bold and link.\nFirst item\nSecond item")
    let shown=expectation(for:NSPredicate {_,_ in parent.presentedViewController != nil},evaluatedWith:parent)
    await fulfillment(of:[shown],timeout:3)
    let navigation=try XCTUnwrap(parent.presentedViewController as? UINavigationController)
    let sheet=try XCTUnwrap(navigation.topViewController)
    func inputs(_ view:UIView)->[UIView] { ([view] + view.subviews.flatMap(inputs)).filter {$0 is UITextInput} }
    let input=try XCTUnwrap(inputs(sheet.view).first)
    let selection=try XCTUnwrap(input as? any UITextInput)
    selection.selectedTextRange=selection.textRange(from:selection.beginningOfDocument,to:selection.endOfDocument)
    UIPasteboard.general.items=[]
    input.perform(#selector(UIResponderStandardEditActions.copy(_:)),with:nil)
    let data=UIPasteboard.general.data(forPasteboardType:LexicalClipboardPayload.mimeType)
    XCTAssertNotNil(data,"Selected article prose must retain rich clipboard structure")
    guard let data else {return}
    let copied=try JSONDecoder().decode(LexicalClipboardPayload.self,from:data)
    let target=Editor();try target.load(["root":["type":"root","version":1,"children":[["type":"paragraph","version":1,"children":[]]]]])
    try target.apply(.caret(Point(path:[0],offset:0,type:.element)))
    try target.apply(.paste(Clipboard(plainText:"",lexical:copied)))
    let saved=try target.serializedState().stringified
    XCTAssertTrue(saved.contains("\"format\":1"),"Bold survives native rich paste")
    XCTAssertTrue(saved.contains("https://example.com"),"Link survives native rich paste")
    XCTAssertTrue(saved.contains("\"type\":\"list\""),"List structure survives native rich paste")
    XCTAssertFalse((input as? EditorView)?.isEditable ?? (input as? UITextView)?.isEditable ?? true)
    navigation.dismiss(animated:false)
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
