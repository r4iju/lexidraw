import Foundation
import HTTPTypes
import ImageIO
import OpenAPIRuntime
import UniformTypeIdentifiers

/// What someone shared into Lexidraw from another app, as it will be saved:
/// a web address as a link whose page is read into an article, as the web's
/// New link saves one, and anything else as a document.
public enum Shared: Sendable, Equatable {
  case link(URL)
  case document(SharedDocument)

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
    self = .document(SharedDocument(title: title, body: body, images: images))
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

/// Text and pictures to save as a new document.
public struct SharedDocument: Sendable, Equatable {
  /// Titled by its text's first line, or as the server titles a new document
  /// when there is no text.
  public let title: String?
  public let body: String
  public let images: [SharedImage]
}

/// An image as the server will store it for a document to show.
public struct SharedImage: Sendable, Equatable {
  typealias ContentType = Operations.EntitiesSignImageUpload.Input.Body.JsonPayload.ContentTypePayload

  /// Past this, a photo is sharper than any screen shows it.
  static let longestSide = 4096

  public let data: Data
  let contentType: ContentType

  init(data: Data, contentType: ContentType) {
    self.data = data
    self.contentType = contentType
  }

  /// `data` as it is when the server takes its type, and otherwise as a JPEG
  /// no larger than a screen shows. Nil when it is no picture the server
  /// takes.
  public init?(data: Data, type: UTType) {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0 else {
      return nil
    }
    if let taken = type.preferredMIMEType.flatMap(ContentType.init(rawValue:)) {
      self.init(data: data, contentType: taken)
      return
    }
    guard !type.conforms(to: .svg), let jpeg = Self.jpeg(source) else { return nil }
    self.init(data: jpeg, contentType: .imageJpeg)
  }

  /// Turned upright, since a JPEG made from the pixels loses the photo's
  /// orientation tag.
  private static func jpeg(_ source: CGImageSource) -> Data? {
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

/// The store would not take a picture the server signed.
public struct PictureRefused: Error, LocalizedError, Sendable {
  public let message: String

  public var errorDescription: String? { message }
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

  /// Makes `document` in `folder`, or the top of Home: its pictures go to the
  /// store first, so the document is made whole in one request or not at all.
  public func saveDocument(_ document: SharedDocument, in folder: String?) async throws -> Entry {
    var parts = document.body.isEmpty ? [] : [document.body]
    for image in document.images {
      parts.append("![](\(try await send(image)))")
    }
    return try await create(
      .document, title: document.title, markdown: parts.isEmpty ? nil : parts.joined(separator: "\n\n"), in: folder)
  }

  /// Sends `image` to the store as the server signed it; answers its address.
  private func send(_ image: SharedImage) async throws -> String {
    let signed = try await ask {
      try await $0.entitiesSignImageUpload(body: .json(.init(contentType: image.contentType, size: image.data.count)))
    }.ok.body.json
    guard let url = URL(string: signed.upload.url) else {
      throw PictureRefused(message: "The server signed the picture for no address.")
    }
    let (response, body) = try await connection.sendOutside(
      image.data, method: .put, to: url, headers: signed.upload.headers.additionalProperties)
    guard response.status.kind == .successful else {
      throw PictureRefused(message: await StoreSaid.message(in: body) ?? "The store answered \(response.status.code).")
    }
    return signed.url
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

/// How the store says why it refused.
private struct StoreSaid: Decodable {
  struct Error: Decodable {
    let message: String
  }

  let error: Error

  static func message(in body: HTTPBody?) async -> String? {
    guard let body, let data = try? await Data(collecting: body, upTo: 1 << 16) else { return nil }
    return (try? JSONDecoder().decode(Self.self, from: data))?.error.message
  }
}
