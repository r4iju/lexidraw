import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import DrawingKit

/// Images picked to place in a drawing are prepared as the web prepares a
/// dropped file.
@Suite struct ImageFileTests {
  @Test func shrinksALargeImageAndKeepsTheIdOfWhatWasPicked() throws {
    let picked = encoded(width: 2000, height: 1000, as: .png)
    let file = try ImageFile(data: picked)
    #expect(file.id == Insecure.SHA1.hash(data: picked).map { String(format: "%02x", $0) }.joined())
    #expect(file.mimeType == "image/png")
    #expect((file.width, file.height) == (1440, 720))
    let source = try #require(CGImageSourceCreateWithData(file.data as CFData, nil))
    #expect(CGImageSourceGetType(source) as String? == UTType.png.identifier)
  }

  @Test func turnsAPhotoTheServerDoesNotStoreIntoAJPEG() throws {
    let file = try ImageFile(data: encoded(width: 40, height: 30, as: .heic))
    #expect(file.mimeType == "image/jpeg")
    #expect((file.width, file.height) == (40, 30))
  }

  @Test func refusesWhatIsNotAnImage() {
    #expect(throws: ImageFile.Unreadable.self) { try ImageFile(data: Data("not an image".utf8)) }
  }
}

private func encoded(width: Int, height: Int, as type: UTType) -> Data {
  let context = CGContext(
    data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  context.setFillColor(CGColor(srgbRed: 0.2, green: 0.5, blue: 0.8, alpha: 1))
  context.fill(CGRect(x: 0, y: 0, width: width / 2, height: height))
  let data = NSMutableData()
  let destination = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, context.makeImage()!, nil)
  CGImageDestinationFinalize(destination)
  return data as Data
}
