import CoreGraphics
import Foundation
import HTTPTypes
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import LexidrawKit

@Suite struct SharedContentTests {
  /// Safari shares the page's address, and sometimes its title as text too.
  @Test func aWebAddressIsSavedAsALink() {
    let page = URL(string: "https://example.com/post")!

    #expect(Shared(urls: [page], texts: ["Example post"], images: []) == .link(page))
  }

  /// As the web's New link reads what is typed, a bare host gets https.
  @Test func textThatIsOnlyAnAddressIsALink() {
    #expect(
      Shared(urls: [], texts: ["  example.com/post \n"], images: [])
        == .link(URL(string: "https://example.com/post")!))
    #expect(
      Shared(urls: [], texts: ["http://example.com"], images: []) == .link(URL(string: "http://example.com")!))
  }

  @Test func aFileAddressIsNoLink() {
    #expect(Shared(urls: [URL(fileURLWithPath: "/tmp/a.txt")], texts: [], images: []) == nil)
  }

  /// A document shows its title once, above its text, so the line that
  /// became the title is not repeated below it.
  @Test func otherTextIsADocumentTitledByItsFirstLine() {
    #expect(
      Shared(urls: [], texts: ["Groceries\nMilk\n\nEggs\n"], images: [])
        == .document(.init(title: "Groceries", body: "Milk\n\nEggs", images: [])))
    #expect(
      Shared(urls: [], texts: ["Read this: https://example.com"], images: [])
        == .document(.init(title: "Read this: https://example.com", body: "", images: [])))
  }

  /// A paragraph is no title: it keeps all its text, under the words it
  /// starts with.
  @Test func aLongFirstLineIsShortenedForTheTitleAndKeptWhole() {
    let paragraph = String(repeating: "Words that run on and on. ", count: 8).trimmingCharacters(in: .whitespaces)

    guard case .document(let document) = Shared(urls: [], texts: [paragraph], images: []) else {
      Issue.record("not a document")
      return
    }
    #expect(document.title == "Words that run on and on. Words that run on and on. Words…")
    #expect(document.body == paragraph)
  }

  @Test func picturesAreADocumentCaptionedByTheTextWithThem() throws {
    let picture = try #require(SharedImage(data: try TestImages.png(width: 4, height: 4), type: .png))

    #expect(
      Shared(urls: [], texts: ["Whiteboard"], images: [picture])
        == .document(.init(title: "Whiteboard", body: "", images: [picture])))
    #expect(Shared(urls: [], texts: [], images: [picture]) == .document(.init(title: nil, body: "", images: [picture])))
  }

  @Test func nothingSavableIsNothing() {
    #expect(Shared(urls: [], texts: ["  \n"], images: []) == nil)
  }
}

@Suite struct SharedImageTests {
  @Test func anImageTheServerTakesIsSentAsItIs() throws {
    let png = try TestImages.png(width: 4, height: 4)

    let image = try #require(SharedImage(data: png, type: .png))

    #expect(image == SharedImage(data: png, contentType: .imagePng))
  }

  /// Photos come as HEIC, which a browser can't show.
  @Test func anImageTheServerWontTakeBecomesAJPEG() throws {
    let heic = try TestImages.encoded(TestImages.image(width: 8, height: 8), as: .heic)

    let image = try #require(SharedImage(data: heic, type: .heic))

    #expect(image.contentType == .imageJpeg)
    #expect(CGImageSourceGetType(CGImageSourceCreateWithData(image.data as CFData, nil)!) as String? == UTType.jpeg.identifier)
  }

  @Test func aPhotoLargerThanAnyScreenIsMadeSmaller() throws {
    let heic = try TestImages.encoded(TestImages.image(width: 6000, height: 30), as: .heic)

    let image = try #require(SharedImage(data: heic, type: .heic))

    let properties = try #require(
      CGImageSourceCopyPropertiesAtIndex(CGImageSourceCreateWithData(image.data as CFData, nil)!, 0, nil)
        as? [CFString: Any])
    #expect(properties[kCGImagePropertyPixelWidth] as? Int == SharedImage.longestSide)
  }

  /// An SVG can carry script, so the server takes none.
  @Test func anSVGIsLeftOut() {
    let svg = Data(#"<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>"#.utf8)

    #expect(SharedImage(data: svg, type: .svg) == nil)
  }

  @Test func whatIsNoImageIsLeftOut() {
    #expect(SharedImage(data: Data("not an image".utf8), type: .png) == nil)
  }
}

@Suite struct SavingSharedTests {
  /// As the web's New link saves one: titled as new, the address its content.
  @Test func aLinkIsSavedIntoTheChosenFolder() async throws {
    let server = FakeServer { request in
      (200, Summary.json(id: request.json["id"] ?? "", type: "url", title: "New link", parentId: "dir-1"))
    }
    let session = try TestServer.session(server)

    let saved = try await session.saveLink(URL(string: "https://example.com/post")!, in: "dir-1")

    let request = try #require(server.requests.only)
    #expect(request.method == .post)
    #expect(request.url.path == "/api/v1/entities")
    #expect(request.json["entityType"] == "url")
    #expect(request.json["title"] == "New link")
    #expect(request.json["elements"] == #"{"url":"https://example.com/post"}"#)
    #expect(request.json["parentId"] == "dir-1")
    #expect(saved.id == request.json["id"])
    #expect(saved.kind == .url)
  }

  @Test func readingTheLinksPageAnswersItsNewTitle() async throws {
    let server = FakeServer { _ in (200, Summary.json(id: "link-1", type: "url", title: "The post")) }
    let session = try TestServer.session(server)

    let read = try await session.distill("link-1")

    let request = try #require(server.requests.only)
    #expect(request.method == .post)
    #expect(request.url.path == "/api/v1/entities/link-1/distill")
    #expect(read == "The post")
  }

  /// The pictures go straight to the store first, so the document is made
  /// whole in one request, or not at all.
  @Test func aDocumentIsMadeWithItsTextAndPicturesInOneRequest() async throws {
    let png = try TestImages.png(width: 4, height: 4)
    let picture = SharedImage(data: png, contentType: .imagePng)
    let server = FakeServer { request in
      switch (request.method, request.url.host, request.url.path) {
      case (.post, _, "/api/v1/uploads"):
        (200, Signed.picture)
      case (.put, "store.test", _):
        (200, #"{"url":"https://blob.test/u-1.png"}"#)
      default:
        (200, Summary.json(id: request.json["id"] ?? "", type: "document", title: request.json["title"] ?? ""))
      }
    }
    let session = try TestServer.session(server)

    _ = try await session.saveDocument(
      .init(title: "Whiteboard", body: "From the meeting", images: [picture]), in: "dir-1")

    #expect(server.requests.count == 3)
    let (sign, send, create) = (server.requests[0], server.requests[1], server.requests[2])
    #expect(sign.object["contentType"] as? String == "image/png")
    #expect(sign.object["size"] as? Int == png.count)
    #expect(send.method == .put)
    #expect(send.url.string == "https://store.test/api/blob/?pathname=u-1.png")
    #expect(send.headers[HTTPField.Name("x-content-type")!] == "image/png")
    #expect(send.authorization == "Bearer vercel_blob_client_store_token")
    #expect(send.body == png)
    #expect(create.url.path == "/api/v1/entities")
    #expect(create.json["entityType"] == "document")
    #expect(create.json["title"] == "Whiteboard")
    #expect(create.json["parentId"] == "dir-1")
    #expect(create.json["markdown"] == "From the meeting\n\n![](https://blob.test/u-1.png)")
  }

  /// Nothing to write under the title, so nothing but the create.
  @Test func aDocumentThatIsOnlyATitleIsOnlyMade() async throws {
    let server = FakeServer { request in
      (200, Summary.json(id: request.json["id"] ?? "", type: "document", title: "Idea"))
    }
    let session = try TestServer.session(server)

    _ = try await session.saveDocument(.init(title: "Idea", body: "", images: []), in: "dir-1")

    let create = try #require(server.requests.only)
    #expect(!create.keys.contains("markdown"))
  }

  @Test func aPictureTheStoreRefusesSavesNothing() async throws {
    let server = FakeServer { request in
      switch (request.method, request.url.host) {
      case (.put, "store.test"): (400, #"{"error":{"message":"Content type mismatch"}}"#)
      default: (200, Signed.picture)
      }
    }
    let session = try TestServer.session(server)
    let picture = SharedImage(data: try TestImages.png(width: 4, height: 4), contentType: .imagePng)

    await #expect(throws: (any Error).self) {
      try await session.saveDocument(.init(title: "Photo", body: "", images: [picture]), in: nil)
    }
    #expect(!server.requests.contains { $0.url.path == "/api/v1/entities" })
  }
}

/// What the server answers when it signs a picture's upload.
private enum Signed {
  static let picture = """
    {"url":"https://blob.test/u-1.png","upload":{"method":"PUT",\
    "url":"https://store.test/api/blob/?pathname=u-1.png",\
    "headers":{"authorization":"Bearer vercel_blob_client_store_token","x-content-type":"image/png"}}}
    """
}

@Suite struct ShareLinkTests {
  @Test(arguments: [
    (Entry.Kind.document, "/documents/f-1"),
    (.drawing, "/drawings/f-1"),
    (.folder, "/dashboard/f-1"),
    (.url, "/urls/f-1"),
  ])
  func aFileIsSharedByTheAddressTheWebOpensItAt(kind: Entry.Kind, path: String) throws {
    let session = try TestServer.session(FakeServer { _ in (200, "{}") })

    #expect(session.link(to: .stub(id: "f-1", kind: kind, access: .read)) == URL(string: "https://lexidraw.test\(path)"))
  }
}

/// Images made for a test, so none has to be committed.
enum TestImages {
  static func image(width: Int, height: Int, noise: Bool = false) throws -> CGImage {
    let context = try #require(
      CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    if noise, let pixels = context.data?.assumingMemoryBound(to: UInt32.self) {
      var state: UInt32 = 1
      for index in 0..<(width * height) {
        // A cheap generator is enough: the point is that nothing compresses.
        state = state &* 1_664_525 &+ 1_013_904_223
        pixels[index] = state | 0xFF00_0000
      }
    } else {
      context.setFillColor(red: 0.2, green: 0.4, blue: 0.8, alpha: 1)
      context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    }
    return try #require(context.makeImage())
  }

  static func encoded(_ image: CGImage, as type: UTType) throws -> Data {
    let data = NSMutableData()
    let destination = try #require(CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(destination, image, nil)
    try #require(CGImageDestinationFinalize(destination))
    return data as Data
  }

  static func png(width: Int, height: Int, noise: Bool = false) throws -> Data {
    try encoded(image(width: width, height: height, noise: noise), as: .png)
  }
}
