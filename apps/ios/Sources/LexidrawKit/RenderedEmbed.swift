import Foundation
import LexidrawJSON

public struct RenderedEmbed: Sendable {
  public struct Link: Sendable {
    public let url: URL
    public let x: Double
    public let y: Double
    public let width: Double
    public let height: Double
  }
  public let accessibleText: String?
  public let links: [Link]
  public let hash: String
  public let svg: String
  public let png: Data
  public let width: Double
  public let height: Double
}

actor RenderedEmbedQueue {
  static let shared = RenderedEmbedQueue()
  private var active = 0
  private var waiting: [CheckedContinuation<Void, Never>] = []
  func perform<T: Sendable>(_ operation: @Sendable () async throws -> T) async throws -> T {
    if active >= 2 {
      guard waiting.count < 128 else { throw Refusal(status: 429, message: "Too many pending embed renders") }
      await withCheckedContinuation { waiting.append($0) }
    } else { active += 1 }
    defer {
      if waiting.isEmpty { active -= 1 }
      else { waiting.removeFirst().resume() }
    }
    try Task.checkCancellation()
    return try await operation()
  }
}

extension Session {
  public func renderEmbed(node: JSONValue, dark: Bool, width: Int, fontFamily: String, fontSize: Double) async throws -> RenderedEmbed {
    try await RenderedEmbedQueue.shared.perform {
    let result = try await ask {
      try await $0.embedsRender(body: .json(.init(node: node.stringified, theme: dark ? .dark : .light, width: width, fontFamily: fontFamily, fontSize: fontSize)))
    }.ok.body.json
    guard let png = Data(base64Encoded: result.png), png.count <= 12_000_000 else {
      throw Refusal(status: 502, message: "The renderer returned an invalid image")
    }
    return RenderedEmbed(accessibleText: result.accessibleText, links: (result.links ?? []).compactMap { link in
      guard let url = URL(string: link.url), ["http", "https", "mailto", "tel", "ftp"].contains(url.scheme?.lowercased() ?? "") else { return nil }
      return RenderedEmbed.Link(url: url, x: link.x, y: link.y, width: link.width, height: link.height)
    }, hash: result.hash, svg: result.svg, png: png, width: result.width, height: result.height)
    }
  }
}

public struct RenderedSVG: Sendable {
  public let png: Data
  public let width: Double
  public let height: Double
}

extension Session {
  public func rasterizeSVG(_ source: Data) async throws -> RenderedSVG {
    guard source.count <= 8_000_000 else { throw Refusal(status: 413, message: "SVG source exceeds the image limit") }
    return try await RenderedEmbedQueue.shared.perform {
      let result = try await ask {
        try await $0.embedsRasterizeSVG(body: .json(.init(source: source.base64EncodedString())))
      }.ok.body.json
      guard let png = Data(base64Encoded: result.png), png.count <= 12_000_000 else {
        throw Refusal(status: 502, message: "The renderer returned an invalid SVG preview")
      }
      return RenderedSVG(png: png, width: result.width, height: result.height)
    }
  }
}
