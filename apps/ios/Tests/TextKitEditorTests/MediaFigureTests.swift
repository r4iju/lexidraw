import EditorModelInterface
import Testing
@testable import TextKitEditor

@Suite struct MediaFigureTests {
  @Test func placedFiguresUseWebColumnsAndPhoneShareRules() throws {
    func width(_ placement: String?, available: Double) throws -> Double {
      var node: JSONValue = ["type": "image", "width": 200, "height": 100]
      if let placement, case .object(var fields) = node {
        fields["$"] = ["figure": ["width": .string(placement)]]
        node = .object(fields)
      }
      return try #require(MediaPayload(node)).figureWidth(fitting: available, em: 16)
    }
    #expect(try width(nil, available: 1200) == 704)
    #expect(try width("wide", available: 1200) == 1024)
    #expect(try width("full", available: 1200) == 1200)
    #expect(try width("50%", available: 1200) == 352)
    #expect(try width("25%", available: 1200) == 176)
    #expect(try width("10%", available: 1200) == 160)
    #expect(try width("50%", available: 500) == 500)
    #expect(try width("5%", available: 1200) == 704)
  }
  @Test func alignedEmbedsSitAtTheirSideOfTheColumn() throws {
    func x(_ format: String, width: Double) throws -> Double {
      try #require(MediaPayload(["type": "youtube", "videoID": "dQw4w9WgXcQ", "format": .string(format)]))
        .mediaX(width: width, fitting: 1200, em: 16)
    }
    // The 704pt column starts 248pt in.
    #expect(try x("left", width: 400) == 248)
    #expect(try x("start", width: 400) == 248)
    #expect(try x("", width: 400) == 400)
    #expect(try x("center", width: 400) == 400)
    #expect(try x("right", width: 400) == 552)
    #expect(try x("end", width: 400) == 552)
    // Wider than the column, it stays centred.
    #expect(try x("left", width: 1024) == 88)
  }
}

#if canImport(UIKit)
import UIKit

@MainActor @Suite struct InlineImageGeometryTests {
  @Test(arguments: [20.0, 1000.0]) func inheritedInlineDimensionsUseTheSourceImage(_ width: Double) async throws {
    let photo = UIGraphicsImageRenderer(size: CGSize(width: width, height: width / 2)).image { _ in
      UIColor.blue.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: width, height: width / 2))
    }
    let source = "data:image/png;base64," + photo.pngData()!.base64EncodedString()
    let payload = try #require(MediaPayload(["type": "inline-image", "src": .string(source), "width": "inherit", "height": "inherit"]))
    let attachment = MediaAttachment(payload)
    await withCheckedContinuation { continuation in attachment.load { continuation.resume() } }
    #expect(attachment.bounds.width == CGFloat(photo.cgImage!.width))
    #expect(attachment.bounds.height == CGFloat(photo.cgImage!.height))
  }
  @Test func storedBoxContainsImageWithoutStretching() async throws {
    let photo = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 10)).image { _ in
      UIColor.blue.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 20, height: 10))
    }
    let source = "data:image/png;base64," + photo.pngData()!.base64EncodedString()
    let payload = try #require(MediaPayload(["type": "inline-image", "src": .string(source), "width": 100, "height": 100]))
    let attachment = MediaAttachment(payload)
    await withCheckedContinuation { continuation in attachment.load { continuation.resume() } }
    let rendered = try #require(attachment.image?.cgImage)
    var pixels = [UInt8](repeating: 0, count: 100 * 100 * 4)
    let context = try #require(CGContext(data: &pixels, width: 100, height: 100, bitsPerComponent: 8, bytesPerRow: 400, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    context.draw(rendered, in: CGRect(x: 0, y: 0, width: 100, height: 100))
    #expect(pixels[3] == 0, "The square attachment should have transparent letterboxing around the 2:1 image")
    #expect(pixels[(50 * 100 + 50) * 4 + 3] == 255)
  }
}
#endif

#if canImport(UIKit)
import ImageIO

@MainActor @Suite struct UnsupportedMediaFormatTests {
  @Test func svgUsesAnExplicitRasterPreviewWithoutReplacingOriginalSource() async throws {
    let svg = Data("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"20\" height=\"10\"><rect width=\"20\" height=\"10\" fill=\"blue\"/></svg>".utf8)
    let source = try #require(URL(string: "data:image/svg+xml;base64," + svg.base64EncodedString()))
    var calls = 0
    let result = try await NativeMediaImages.load(source, rasterizeSVG: { data in
      #expect(data == svg)
      calls += 1
      return UIGraphicsImageRenderer(size: CGSize(width: 20, height: 10)).image { _ in
        UIColor.blue.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 20, height: 10))
      }
    })
    #expect(calls == 1)
    #expect(result.size == CGSize(width: 20, height: 10))
    #expect(source.absoluteString.hasPrefix("data:image/svg+xml;base64,"))
  }
  @Test func svgPercentEncodedDataURLsReachTheRasterizerAsOriginalBytes() async throws {
    let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"30\" height=\"15\"><text>+ &amp; words</text></svg>"
    let encoded = try #require(svg.addingPercentEncoding(withAllowedCharacters: .alphanumerics))
    let source = try #require(URL(string: "data:image/svg+xml;charset=utf-8," + encoded))
    var received: Data?
    _ = try await NativeMediaImages.load(source, rasterizeSVG: { data in
      received = data
      return UIGraphicsImageRenderer(size: CGSize(width: 30, height: 15)).image { _ in }
    })
    #expect(received == Data(svg.utf8))
  }
  @Test func imageLoadingCanBeProvidedWithoutChangingThePayload() async throws {
    let payload = try #require(MediaPayload(["type": "inline-image", "src": "https://example.com/test.svg", "width": 100, "height": 50]))
    var calls = 0
    let attachment = MediaAttachment(payload, imageLoader: { _ in
      calls += 1
      return UIGraphicsImageRenderer(size: CGSize(width: 20, height: 10)).image { _ in }
    })
    await withCheckedContinuation { continuation in attachment.load { continuation.resume() } }
    #expect(calls == 1)
    #expect(attachment.payload.source?.absoluteString == "https://example.com/test.svg")
  }
  @Test func animatedInlineAttachmentPresentsSuccessiveFramesWithItsCaption() async throws {
    func frame(_ color: UIColor) -> UIImage {
      UIGraphicsImageRenderer(size: CGSize(width: 20, height: 10)).image { _ in
        color.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 20, height: 10))
      }
    }
    let animation = try #require(UIImage.animatedImage(with: [frame(.blue), frame(.red)], duration: 0.2))
    let payload = try #require(MediaPayload(["type": "inline-image", "src": "https://example.com/check.gif", "width": 20, "height": 10, "showCaption": true, "caption": ["editorState": ["root": ["type": "root", "children": [["type": "paragraph", "children": [["type": "text", "text": "Caption", "format": 0]]]]]]]]))
    let attachment = MediaAttachment(payload, imageLoader: { _ in animation })
    var changes = 0
    var pixels = Set<Data>()
    attachment.load {
      changes += 1
      if let png = attachment.image?.pngData() { pixels.insert(png) }
    }
    try await Task.sleep(for: .milliseconds(350))
    #expect(changes >= 3)
    #expect(pixels.count == 2)
    #expect(attachment.bounds.height > 10)
  }
  @Test func animatedAttachmentResumesRedrawingAfterItsTextBoxIsReplaced() async throws {
    let frame = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 10)).image { _ in }
    let animation = try #require(UIImage.animatedImage(with: [frame, frame], duration: 0.1))
    let payload = try #require(MediaPayload(["type": "inline-image", "src": "https://example.com/rebind.gif"]))
    let attachment = MediaAttachment(payload, imageLoader: { _ in animation })
    attachment.load { }
    try await Task.sleep(for: .milliseconds(80))
    attachment.setAnimationVisible(false)
    var changes = 0
    attachment.load { changes += 1 }
    attachment.setAnimationVisible(true)
    try await Task.sleep(for: .milliseconds(160))
    #expect(changes >= 2)
    attachment.setAnimationVisible(false)
  }
  private func gif(delays: [Double], size: CGFloat = 20) throws -> URL {
    let frame = UIGraphicsImageRenderer(size: CGSize(width: size, height: size / 2)).image { _ in }
    let data = NSMutableData()
    let destination = try #require(CGImageDestinationCreateWithData(data, "com.compuserve.gif" as CFString, delays.count, nil))
    for delay in delays { CGImageDestinationAddImage(destination, frame.cgImage!, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: delay]] as CFDictionary) }
    #expect(CGImageDestinationFinalize(destination))
    return try #require(URL(string: "data:image/gif;base64," + (data as Data).base64EncodedString()))
  }
  @Test func longUnequalDelaysArePreservedAndSharedFramesDoNotEvictTheCache() async throws {
    let source = try gif(delays: [61, 0.05], size: 512)
    let image = try await NativeMediaImages.load(source)
    #expect(abs(image.duration - 61.05) < 0.001)
    let cached = try await NativeMediaImages.load(source)
    #expect(image === cached)
  }
  @Test func unrepresentableTimingIsRefusedInsteadOfRounded() async throws {
    let source = try gif(delays: [60.01, 0.02])
    await #expect(throws: MediaImageError.unsupportedFormat("Animation frame timings beyond the native presentation budget")) { try await NativeMediaImages.load(source) }
  }
  @Test func animationRetainsFramesAndTimingInsteadOfBecomingAStillFrame() async throws {
    let photo = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 10)).image { _ in
      UIColor.blue.setFill(); UIRectFill(CGRect(x: 0, y: 0, width: 20, height: 10))
    }
    let data = NSMutableData()
    let destination = try #require(CGImageDestinationCreateWithData(data, "com.compuserve.gif" as CFString, 2, nil))
    CGImageDestinationAddImage(destination, photo.cgImage!, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 0.1]] as CFDictionary)
    CGImageDestinationAddImage(destination, photo.cgImage!, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 0.2]] as CFDictionary)
    #expect(CGImageDestinationFinalize(destination))
    let url = try #require(URL(string: "data:image/gif;base64," + (data as Data).base64EncodedString()))
    let animation = try await NativeMediaImages.load(url)
    #expect(animation.images?.count == 3)
    #expect(abs(animation.duration - 0.3) < 0.001)
  }
}
#endif
