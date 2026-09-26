import Foundation
import ImageIO
import UniformTypeIdentifiers

/// What someone shared into Lexidraw from another app, as it will be saved:
/// a web address as a link whose page is read into an article, as the web's
/// New link saves one, and anything else as a document.
public enum Shared: Sendable, Equatable {
  case link(URL)
  /// Titled by its text's first line, or as the server titles a new document
  /// when there is no text.
  case document(title: String?, body: String, images: [SharedImage])

  /// The longest title a line makes; a longer line is a paragraph.
  static let titleLength = 60

  /// Nil when nothing shared can be saved.
  public init?(urls: [URL], texts: [String], images: [SharedImage]) {
    if let page = urls.first(where: \.isWebAddress) {
      self = .link(page)
      return
    }
    let text = texts
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
      .joined(separator: "\n\n")
    if images.isEmpty, let page = Self.address(text) {
      self = .link(page)
      return
    }
    guard !text.isEmpty || !images.isEmpty else { return nil }
    let (title, body) = Self.titled(text)
    self = .document(title: title, body: body, images: images)
  }

  /// `text` as a web address when it is nothing else, reading a bare host as
  /// https as the web's New link does.
  private static func address(_ text: String) -> URL? {
    guard !text.isEmpty, !text.contains(where: \.isWhitespace) else { return nil }
    let url = URL(string: text.contains("://") ? text : "https://\(text)")
    guard let url, url.isWebAddress, url.host()?.contains(".") == true else { return nil }
    return url
  }

  /// A document shows its title above its text, so a first line that is the
  /// title is not repeated in the body.
  private static func titled(_ text: String) -> (title: String?, body: String) {
    guard !text.isEmpty else { return (nil, "") }
    let lines = text.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false)
    let first = lines[0].trimmingCharacters(in: .whitespaces)
    if first.count <= titleLength {
      let rest = lines.count > 1 ? String(lines[1]) : ""
      return (first, rest.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    var title = ""
    for word in first.split(separator: " ") {
      guard title.count + word.count + 1 <= titleLength else { break }
      title += title.isEmpty ? String(word) : " \(word)"
    }
    return ("\(title)…", text)
  }
}

extension URL {
  fileprivate var isWebAddress: Bool {
    ["http", "https"].contains(scheme?.lowercased()) && host() != nil
  }
}

/// An image as the server will store it for a document to show.
public struct SharedImage: Sendable, Equatable {
  /// The most one upload may carry, as the server's contract says.
  public static let maxBytes = 3_000_000
  /// What a browser shows, so what a document may hold.
  static let shownTypes: Set<String> = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/svg+xml"]
  /// Past this, a photo is sharper than any screen shows it.
  static let longestSide = 4096

  public let data: Data
  public let contentType: String

  init(data: Data, contentType: String) {
    self.data = data
    self.contentType = contentType
  }

  /// `data` as it is when the server takes it, and otherwise as a JPEG small
  /// enough to send. Nil when it is no image.
  public init?(data: Data, type: UTType) {
    let mime = type.preferredMIMEType ?? ""
    if mime == "image/svg+xml" {
      guard data.count <= Self.maxBytes else { return nil }
      self.init(data: data, contentType: mime)
      return
    }
    guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0,
      let size = Self.pixelSize(source)
    else { return nil }
    if Self.shownTypes.contains(mime), data.count <= Self.maxBytes {
      self.init(data: data, contentType: mime)
      return
    }
    var side = min(size, Self.longestSide)
    while true {
      if let jpeg = Self.jpeg(source, longestSide: side), jpeg.count <= Self.maxBytes {
        self.init(data: jpeg, contentType: "image/jpeg")
        return
      }
      guard side > 64 else { return nil }
      side = max(64, side * 3 / 4)
    }
  }

  private static func pixelSize(_ source: CGImageSource) -> Int? {
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    guard let width = properties?[kCGImagePropertyPixelWidth] as? Int,
      let height = properties?[kCGImagePropertyPixelHeight] as? Int
    else { return nil }
    return max(width, height)
  }

  /// Turned upright, since a JPEG made from the pixels loses the photo's
  /// orientation tag.
  private static func jpeg(_ source: CGImageSource, longestSide: Int) -> Data? {
    let options: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: longestSide,
    ]
    guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    let data = NSMutableData()
    guard
      let destination = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    return CGImageDestinationFinalize(destination) ? data as Data : nil
  }
}

/// A file was made, but what should have gone into it didn't all make it.
public struct PartlySaved: Error, LocalizedError {
  public let entry: Entry
  public let reason: any Error

  public var errorDescription: String? { reason.localizedDescription }
}

extension Session {
  /// Saves a web address into `folder`, or the top of Home, as the web's New
  /// link does; ``distill(_:)`` then reads its page.
  public func saveLink(_ url: URL, in folder: String?) async throws -> Entry {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .withoutEscapingSlashes
    let elements = String(decoding: try encoder.encode(["url": url.absoluteString]), as: UTF8.self)
    return try await create(.url, title: "New link", elements: elements, in: folder)
  }

  /// Reads a link's page into an article; answers the title the link has
  /// after it, which is the page's when the link was still titled as new.
  public func distill(_ id: String) async throws -> String {
    try await ask { try await $0.entitiesDistillUrl(path: .init(id: id), body: .json(.init())) }.ok.body.json.title
  }

  /// Makes a document in `folder`, or the top of Home, holding `body` and
  /// then `images`. The body replaces the new document's empty paragraph,
  /// against the revision the create made, as the CLI writes one.
  public func saveDocument(title: String?, body: String, images: [SharedImage], in folder: String?) async throws
    -> Entry
  {
    let made = try await create(.document, title: title, elements: nil, in: folder)
    do {
      var parts = body.isEmpty ? [] : [body]
      for image in images {
        let url = try await ask {
          try await $0.entitiesUploadImage(
            path: .init(id: made.id),
            body: .json(
              .init(
                contentType: .init(rawValue: image.contentType)!,
                data: .init(image.data))))
        }.ok.body.json.url
        parts.append("![](\(url))")
      }
      guard !parts.isEmpty else { return made }
      _ = try await ask {
        try await $0.documentsReplaceMarkdown(
          path: .init(id: made.id),
          body: .json(.init(markdown: parts.joined(separator: "\n\n"), ifUnmodifiedSince: made.updatedAt)))
      }.ok
      return made
    } catch {
      throw PartlySaved(entry: made, reason: error)
    }
  }

  /// The address the web opens `entry` at, for sending to someone.
  public func link(to entry: Entry) -> URL {
    origin.appending(path: "\(entry.kind.webPath)/\(entry.id)")
  }
}

extension Entry.Kind {
  fileprivate var webPath: String {
    switch self {
    case .document: "documents"
    case .drawing: "drawings"
    case .folder: "dashboard"
    case .url: "urls"
    }
  }
}
