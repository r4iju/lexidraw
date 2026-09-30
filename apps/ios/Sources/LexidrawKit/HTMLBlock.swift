import Foundation

public struct HTMLBlockPreview: Sendable {
  public let png: Data
  public let width: Int
  public let height: Int
}

extension Session {
  public func htmlBlockLink(documentID: String, blockID: String) -> URL {
    var parts = URLComponents(
      url: origin.appending(path: "documents/\(documentID)"), resolvingAgainstBaseURL: false)!
    parts.fragment = "html-block-\(blockID)"
    return parts.url!
  }

  public func htmlBlockPreview(documentID: String, blockID: String, revision: String) async throws
    -> HTMLBlockPreview
  {
    let result = try await ask {
      try await $0.htmlBlocksPreview(
        path: .init(id: documentID, blockId: blockID), query: .init(revision: revision, width: 800))
    }.ok.body.json
    let ready: Operations.HtmlBlocksPreview.Output.Ok.Body.JsonPayload.Case1Payload
    switch result {
    case .case1(let preview): ready = preview
    case .case2(let failure):
      guard failure.revision == revision else {
        throw Refusal(status: 409, message: "The block changed. Reload its preview.")
      }
      throw Refusal(status: 422, message: failure.message)
    }
    guard ready.revision == revision else {
      throw Refusal(status: 409, message: "The block changed. Reload its preview.")
    }
    let encoded = ready.data
    guard ready.width >= 320, ready.width <= 1280, ready.height >= 180, ready.height <= 900,
      ready.width.rounded() == ready.width, ready.height.rounded() == ready.height,
      encoded.utf8.count <= 6 * 1024 * 1024,
      let png = Data(base64Encoded: encoded), png.count <= 4 * 1024 * 1024,
      png.starts(with: [137, 80, 78, 71, 13, 10, 26, 10])
    else { throw Refusal(status: 422, message: "Invalid block preview") }
    return HTMLBlockPreview(png: png, width: Int(ready.width), height: Int(ready.height))
  }
}
