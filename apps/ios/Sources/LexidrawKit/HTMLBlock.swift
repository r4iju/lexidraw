import Foundation

/// A saved-state capture: `width` and `height` are layout points, and the PNG has `scale` pixels per point.
public struct HTMLBlockPreview: Sendable {
  public let png: Data
  public let width: Int
  public let height: Int
  public let scale: Int
}

/// The block's own script failed, so its message is for the author to act on.
public struct HTMLBlockScriptError: Error, Equatable, LocalizedError {
  public let message: String
  public var errorDescription: String? { message }
}

extension Session {
  public func htmlBlockLink(documentID: String, blockID: String) -> URL {
    var parts = URLComponents(
      url: origin.appending(path: "documents/\(documentID)"), resolvingAgainstBaseURL: false)!
    parts.fragment = "html-block-\(blockID)"
    return parts.url!
  }

  /// The preview at the block's displayed `width` in points and the reader's appearance, so it
  /// matches the block when it runs.
  public func htmlBlockPreview(
    documentID: String, blockID: String, revision: String, width: Int, dark: Bool
  ) async throws -> HTMLBlockPreview {
    let result = try await ask {
      try await $0.htmlBlocksPreview(
        path: .init(id: documentID, blockId: blockID),
        query: .init(revision: revision, width: min(max(width, 240), 1280), theme: dark ? .dark : .light))
    }.ok.body.json
    let ready: Operations.HtmlBlocksPreview.Output.Ok.Body.JsonPayload.Case1Payload
    switch result {
    case .case1(let preview): ready = preview
    case .case2(let failure):
      guard failure.revision == revision else {
        throw Refusal(status: 409, message: "The block changed. Reload its preview.")
      }
      if failure.reason == .script { throw HTMLBlockScriptError(message: failure.message) }
      throw Refusal(status: 503, message: failure.message)
    }
    guard ready.revision == revision else {
      throw Refusal(status: 409, message: "The block changed. Reload its preview.")
    }
    let encoded = ready.data
    guard ready.width >= 240, ready.width <= 1280, ready.height >= 180, ready.height <= 900,
      (1...3).contains(ready.scale),
      ready.width.rounded() == ready.width, ready.height.rounded() == ready.height,
      encoded.utf8.count <= 6 * 1024 * 1024,
      let png = Data(base64Encoded: encoded), png.count <= 4 * 1024 * 1024,
      png.starts(with: [137, 80, 78, 71, 13, 10, 26, 10])
    else { throw Refusal(status: 422, message: "Invalid block preview") }
    return HTMLBlockPreview(
      png: png, width: Int(ready.width), height: Int(ready.height), scale: ready.scale)
  }
}
