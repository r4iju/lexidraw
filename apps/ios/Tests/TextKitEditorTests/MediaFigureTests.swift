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
    #expect(try width("10%", available: 1200) == 320)
    #expect(try width("50%", available: 500) == 500)
    #expect(try width("5%", available: 1200) == 704)
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
