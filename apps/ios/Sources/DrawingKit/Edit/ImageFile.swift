import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// An image picked to place in a drawing, made ready to store as the web
/// makes a dropped file ready: no more than 1440 pixels on a side, or an SVG
/// normalized as the web normalizes it, and named by the SHA-1 of the bytes
/// stored, the only name the server takes. A kind of image the server doesn't
/// store, as a photo from the library often is, becomes a JPEG, or a PNG
/// when it has transparency.
public struct ImageFile: Sendable {
  public struct Unreadable: Error {}
  public struct TooLarge: Error {}

  /// `DEFAULT_MAX_IMAGE_WIDTH_OR_HEIGHT`.
  static let maxSide = 1440

  private static let stored: [String: DrawingFileType] = [
    UTType.png.identifier: .png, UTType.jpeg.identifier: .jpeg, UTType.gif.identifier: .gif,
    UTType.webP.identifier: .webp, "public.avif": .avif,
  ]

  public let id: String
  public let mimeType: DrawingFileType
  public let data: Data
  public let width: Int
  public let height: Int

  public init(data picked: Data) throws {
    guard let source = CGImageSourceCreateWithData(picked as CFData, nil),
      let type = CGImageSourceGetType(source) as String?,
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int
    else {
      // ImageIO doesn't read SVG.
      guard let svg = NormalizedSVG(picked) else { throw Unreadable() }
      try self.init(stored: svg.data, mimeType: .svg, width: svg.width, height: svg.height)
      return
    }
    let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
    if let mimeType = Self.stored[type], max(width, height) <= Self.maxSide, orientation == 1 {
      try self.init(stored: picked, mimeType: mimeType, width: width, height: height)
    } else {
      // The thumbnail is turned upright, as a browser shows the image.
      guard
        let image = CGImageSourceCreateThumbnailAtIndex(
          source, 0,
          [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: min(max(width, height), Self.maxSide),
          ] as CFDictionary)
      else { throw Unreadable() }
      let opaque = properties[kCGImagePropertyHasAlpha] as? Bool != true
      let keepsType = type == UTType.png.identifier || type == UTType.jpeg.identifier
      let output = keepsType ? UTType(type)! : opaque ? UTType.jpeg : UTType.png
      let encoded = NSMutableData()
      guard
        let destination = CGImageDestinationCreateWithData(
          encoded, output.identifier as CFString, 1, nil)
      else { throw Unreadable() }
      CGImageDestinationAddImage(
        destination, image, [kCGImageDestinationLossyCompressionQuality: 0.9] as CFDictionary)
      guard CGImageDestinationFinalize(destination) else { throw Unreadable() }
      try self.init(
        stored: encoded as Data, mimeType: output == .png ? .png : .jpeg, width: image.width, height: image.height)
    }
  }

  private init(stored data: Data, mimeType: DrawingFileType, width: Int, height: Int) throws {
    guard data.count <= maxDrawingFileBytes else { throw TooLarge() }
    id = Insecure.SHA1.hash(data: data).map { String(format: "%02x", $0) }.joined()
    self.mimeType = mimeType
    self.data = data
    self.width = width
    self.height = height
  }
}

extension DrawingEditor {
  /// `handleAppOnDrop` with an image: the image is placed centred on
  /// `point` at its own size, but no taller than half the view, and
  /// selected. It is "pending" until its file is stored.
  @discardableResult
  public func placeImage(_ file: ImageFile, at point: Point2D, viewportHeight: Double) -> String {
    var element = newElement(.image, at: point, roundness: nil)
    element.merge(
      ["strokeColor": "transparent", "status": "pending", "fileId": nil, "scale": [1, 1], "crop": nil]
    ) { $1 }
    let id = element.id
    insert(element)
    // `initializeImageDimensions` runs twice on the web, first while the
    // file is read, then with its size, and each is a new version.
    let placeholder = 100 / zoom
    mutate(
      id,
      [
        "x": .number(point.x - placeholder / 2), "y": .number(point.y - placeholder / 2),
        "width": .number(placeholder), "height": .number(placeholder),
      ])
    selectedIds = [id]
    mutate(id, ["fileId": .string(file.id)])
    let maxHeight = min(max(viewportHeight - 120, 160), (viewportHeight * 0.5).rounded(.down) / zoom)
    let height = min(Double(file.height), maxHeight)
    let width = height * Double(file.width) / Double(file.height)
    mutate(
      id,
      [
        "x": .number(point.x - width / 2), "y": .number(point.y - height / 2),
        "width": .number(width), "height": .number(height), "crop": nil,
      ])
    capture()
    return id
  }

  /// Marks the images showing `fileId` as stored, or as refused, as the web
  /// does once an upload ends; like the web, this is not a step to undo.
  public func setStatus(_ status: String, ofImagesShowing fileId: String) {
    for position in store.indices
    where store[position].type == .image && store[position]["fileId"]?.stringValue == fileId {
      if environment.mutate(&store[position], ["status": .string(status)]) {
        history.adopt(store[position])
      }
    }
  }
}
