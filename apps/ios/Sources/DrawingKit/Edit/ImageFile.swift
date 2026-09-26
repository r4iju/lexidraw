import CoreGraphics
import CryptoKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// An image picked to place in a drawing, made ready to store as the web
/// makes a dropped file ready: named by the SHA-1 of the bytes picked, and
/// no more than 1440 pixels on a side. A kind of image the server doesn't
/// store, as a photo from the library often is, becomes a JPEG, or a PNG
/// when it has transparency.
public struct ImageFile: Sendable {
  public struct Unreadable: Error {}
  public struct TooLarge: Error {}

  /// `DEFAULT_MAX_IMAGE_WIDTH_OR_HEIGHT`.
  static let maxSide = 1440
  /// `MAX_DRAWING_FILE_BYTES`, which the server refuses files over.
  public static let maxBytes = 3 * 1024 * 1024

  private static let stored: [String: String] = [
    UTType.png.identifier: "image/png", UTType.jpeg.identifier: "image/jpeg",
    UTType.gif.identifier: "image/gif", UTType.webP.identifier: "image/webp",
    "public.avif": "image/avif",
  ]

  public let id: String
  public let mimeType: String
  public let data: Data
  public let width: Int
  public let height: Int

  public init(data picked: Data) throws {
    guard let source = CGImageSourceCreateWithData(picked as CFData, nil),
      let type = CGImageSourceGetType(source) as String?,
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int
    else { throw Unreadable() }
    id = Insecure.SHA1.hash(data: picked).map { String(format: "%02x", $0) }.joined()
    let orientation = properties[kCGImagePropertyOrientation] as? Int ?? 1
    if let mimeType = Self.stored[type], max(width, height) <= Self.maxSide, orientation == 1 {
      self.mimeType = mimeType
      data = picked
      self.width = width
      self.height = height
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
      mimeType = output == .png ? "image/png" : "image/jpeg"
      data = encoded as Data
      self.width = image.width
      self.height = image.height
    }
    guard data.count <= Self.maxBytes else { throw TooLarge() }
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
