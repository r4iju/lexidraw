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
  /// The server stores a file only under the SHA-1 of its bytes.
  @Test func shrinksALargeImageAndNamesItByTheBytesItStores() throws {
    let file = try ImageFile(data: encoded(width: 2000, height: 1000, as: .png))
    #expect(file.id == Insecure.SHA1.hash(data: file.data).map { String(format: "%02x", $0) }.joined())
    #expect(file.mimeType == .png)
    #expect((file.width, file.height) == (1440, 720))
    let source = try #require(CGImageSourceCreateWithData(file.data as CFData, nil))
    #expect(CGImageSourceGetType(source) as String? == UTType.png.identifier)
  }

  @Test func turnsAPhotoTheServerDoesNotStoreIntoAJPEG() throws {
    let file = try ImageFile(data: encoded(width: 40, height: 30, as: .heic))
    #expect(file.mimeType == .jpeg)
    #expect((file.width, file.height) == (40, 30))
  }

  @Test func refusesAnImageLargerThanADrawingStores() {
    let noise = (0..<(1400 * 1400 * 4)).map { _ in UInt8.random(in: 0...255) }
    let picked = encoded(width: 1400, height: 1400, as: .png, pixels: noise)
    #expect(picked.count > maxDrawingFileBytes)
    #expect(throws: ImageFile.TooLarge.self) { try ImageFile(data: picked) }
  }

  @Test func refusesWhatIsNotAnImage() {
    #expect(throws: ImageFile.Unreadable.self) { try ImageFile(data: Data("not an image".utf8)) }
  }
}

private func encoded(width: Int, height: Int, as type: UTType, pixels: [UInt8]? = nil) -> Data {
  let space = CGColorSpace(name: CGColorSpace.sRGB)!
  let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue)
  let image: CGImage
  if let pixels {
    image = CGImage(
      width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4, space: space,
      bitmapInfo: bitmapInfo, provider: CGDataProvider(data: Data(pixels) as CFData)!, decode: nil,
      shouldInterpolate: false, intent: .defaultIntent)!
  } else {
    let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: space,
      bitmapInfo: bitmapInfo.rawValue)!
    context.setFillColor(CGColor(srgbRed: 0.2, green: 0.5, blue: 0.8, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width / 2, height: height))
    image = context.makeImage()!
  }
  let data = NSMutableData()
  let destination = CGImageDestinationCreateWithData(data, type.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(destination, image, nil)
  CGImageDestinationFinalize(destination)
  return data as Data
}
