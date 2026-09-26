import CoreGraphics
import Foundation
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
        == .document(title: "Groceries", body: "Milk\n\nEggs", images: []))
    #expect(
      Shared(urls: [], texts: ["Read this: https://example.com"], images: [])
        == .document(title: "Read this: https://example.com", body: "", images: []))
  }

  /// A paragraph is no title: it keeps all its text, under the words it
  /// starts with.
  @Test func aLongFirstLineIsShortenedForTheTitleAndKeptWhole() {
    let paragraph = String(repeating: "Words that run on and on. ", count: 8).trimmingCharacters(in: .whitespaces)

    guard case .document(let title, let body, _) = Shared(urls: [], texts: [paragraph], images: []) else {
      Issue.record("not a document")
      return
    }
    #expect(title == "Words that run on and on. Words that run on and on. Words…")
    #expect(body == paragraph)
  }

  @Test func picturesAreADocumentCaptionedByTheTextWithThem() throws {
    let picture = try #require(SharedImage(data: try TestImages.png(width: 4, height: 4), type: .png))

    #expect(
      Shared(urls: [], texts: ["Whiteboard"], images: [picture])
        == .document(title: "Whiteboard", body: "", images: [picture]))
    #expect(Shared(urls: [], texts: [], images: [picture]) == .document(title: nil, body: "", images: [picture]))
  }

  @Test func nothingSavableIsNothing() {
    #expect(Shared(urls: [], texts: ["  \n"], images: []) == nil)
  }
}

@Suite struct SharedImageTests {
  @Test func anImageTheServerTakesIsSentAsItIs() throws {
    let png = try TestImages.png(width: 4, height: 4)

    let image = try #require(SharedImage(data: png, type: .png))

    #expect(image == SharedImage(data: png, contentType: "image/png"))
  }

  /// Photos come as HEIC, which a browser can't show.
  @Test func anImageTheServerWontTakeBecomesAJPEG() throws {
    let heic = try TestImages.encoded(TestImages.image(width: 8, height: 8), as: .heic)

    let image = try #require(SharedImage(data: heic, type: .heic))

    #expect(image.contentType == "image/jpeg")
    #expect(CGImageSourceGetType(CGImageSourceCreateWithData(image.data as CFData, nil)!) as String? == UTType.jpeg.identifier)
  }

  @Test func anImageTooLargeToSendIsMadeSmallerUntilItFits() throws {
    let noisy = try TestImages.png(width: 3000, height: 3000, noise: true)
    #expect(noisy.count > SharedImage.maxBytes)

    let image = try #require(SharedImage(data: noisy, type: .png))

    #expect(image.contentType == "image/jpeg")
    #expect(image.data.count <= SharedImage.maxBytes)
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

  /// The body replaces the new document's empty paragraph, against the
  /// revision the create made, as the CLI writes one.
  @Test func aDocumentIsWrittenWithItsTextThenItsPictures() async throws {
    let png = try TestImages.png(width: 4, height: 4)
    let picture = SharedImage(data: png, contentType: "image/png")
    let server = FakeServer { request in
      switch (request.method, request.url.path) {
      case (.post, "/api/v1/entities"):
        (200, Summary.json(id: request.json["id"] ?? "", type: "document", title: request.json["title"] ?? ""))
      case (.post, let path) where path.hasSuffix("/uploads"):
        (200, #"{"url":"https://blob.test/doc-a.png"}"#)
      default:
        (200, #"{"id":"doc","title":"Whiteboard","updatedAt":"2026-09-26T08:00:01.000Z","notes":[],"blocks":2,"restoredPlaceholders":0,"removedPlaceholders":0}"#)
      }
    }
    let session = try TestServer.session(server)

    let saved = try await session.saveDocument(
      title: "Whiteboard", body: "From the meeting", images: [picture], in: nil)

    let (create, upload, write) = (server.requests[0], server.requests[1], server.requests[2])
    #expect(server.requests.count == 3)
    #expect(create.json["entityType"] == "document")
    #expect(create.json["title"] == "Whiteboard")
    #expect(upload.url.path == "/api/v1/entities/\(saved.id)/uploads")
    #expect(upload.json == ["contentType": "image/png", "data": png.base64EncodedString()])
    #expect(write.method == .put)
    #expect(write.url.path == "/api/v1/documents/\(saved.id)/markdown")
    #expect(write.json["markdown"] == "From the meeting\n\n![](https://blob.test/doc-a.png)")
    #expect(write.json["ifUnmodifiedSince"] == "2026-09-26T08:00:00.000Z")
  }

  /// Nothing to write under the title, so nothing but the create.
  @Test func aDocumentThatIsOnlyATitleIsOnlyMade() async throws {
    let server = FakeServer { request in
      (200, Summary.json(id: request.json["id"] ?? "", type: "document", title: "Idea"))
    }
    let session = try TestServer.session(server)

    _ = try await session.saveDocument(title: "Idea", body: "", images: [], in: "dir-1")

    #expect(server.requests.count == 1)
  }

  /// Made, but not everything in it: the file is there to open or delete.
  @Test func aDocumentThatCouldNotBeFilledSaysItWasMade() async throws {
    let server = FakeServer { request in
      request.url.path.hasSuffix("/uploads")
        ? (413, #"{"message":"This image is 3.1 MB","code":"PAYLOAD_TOO_LARGE"}"#)
        : (200, Summary.json(id: request.json["id"] ?? "", type: "document", title: "Photo"))
    }
    let session = try TestServer.session(server)
    let picture = SharedImage(data: try TestImages.png(width: 4, height: 4), contentType: "image/png")

    let failure = await #expect(throws: PartlySaved.self) {
      try await session.saveDocument(title: "Photo", body: "", images: [picture], in: nil)
    }
    #expect(failure?.entry.title == "Photo")
    #expect(failure?.reason.localizedDescription == "This image is 3.1 MB")
  }
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
