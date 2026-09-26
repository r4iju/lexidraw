import CoreGraphics
import Foundation
import ImageIO

/// A file an image element shows, as the web's image cache holds it: its
/// type, and its pixels, or nil when they couldn't be read.
public final class DrawingImage: @unchecked Sendable {
  public let mimeType: DrawingFileType
  public let bitmap: CGImage?
  /// Bitmap pixels to each of the image's own, above 1 for a vector image
  /// drawn sharper than its own size.
  public let scale: Double

  private var filteredBitmaps: [String: CGImage] = [:]
  private let lock = NSLock()

  public init(bitmap: CGImage?, mimeType: DrawingFileType, scale: Double = 1) {
    self.bitmap = bitmap
    self.mimeType = mimeType
    self.scale = scale
  }

  /// The image's own size, which a crop is measured in.
  var naturalSize: (width: Double, height: Double) {
    (Double(bitmap?.width ?? 0) / scale, Double(bitmap?.height ?? 0) / scale)
  }

  /// Decodes `data` with ImageIO.
  public convenience init(data: Data, mimeType: DrawingFileType) {
    let source = CGImageSourceCreateWithData(data as CFData, nil)
    self.init(bitmap: source.flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) }, mimeType: mimeType)
  }
}

extension DrawingImage {
  /// The pixels with `filters` applied, each pixel mapped as a CSS filter
  /// maps a colour, kept for the next time they are drawn.
  func filtered(by filters: [ColorFilter]) -> CGImage? {
    guard let bitmap else { return nil }
    let key = filters.map(\.css).joined(separator: "|")
    lock.lock()
    defer { lock.unlock() }
    if let kept = filteredBitmaps[key] { return kept }
    let width = bitmap.width
    let height = bitmap.height
    guard
      let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
        space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
      let pixels = context.data?.bindMemory(to: UInt8.self, capacity: width * height * 4)
    else { return nil }
    context.draw(bitmap, in: CGRect(x: 0, y: 0, width: width, height: height))
    for offset in stride(from: 0, to: width * height * 4, by: 4) {
      let alpha = Double(pixels[offset + 3]) / 255
      guard alpha > 0 else { continue }
      let channel = { (index: Int) in min(1, Double(pixels[offset + index]) / 255 / alpha) }
      let color = filters.reduce(CSSColor(red: channel(0), green: channel(1), blue: channel(2), alpha: 1)) {
        $1.apply($0)
      }
      pixels[offset] = UInt8((color.red * alpha * 255).rounded())
      pixels[offset + 1] = UInt8((color.green * alpha * 255).rounded())
      pixels[offset + 2] = UInt8((color.blue * alpha * 255).rounded())
    }
    let filtered = context.makeImage()
    filteredBitmaps[key] = filtered
    return filtered
  }
}

/// What `drawImage` draws: a file, or one of the icons an image shows
/// while its file is missing.
public enum CanvasImage {
  case bitmap(DrawingImage)
  case placeholder
  case errorPlaceholder
}
