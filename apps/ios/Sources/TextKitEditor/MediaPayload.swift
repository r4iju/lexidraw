import EditorModelInterface
import Foundation

/// Rendering reads the payload without changing the JSON retained by the model.
struct MediaPayload: Sendable {
  let type: String
  let source: URL?
  let label: String
  let caption: String
  let aspectRatio: Double
  let width: Double?
  let height: Double?
  let maxWidth: Double?

  init?(_ node: JSONValue) {
    guard let type = node["type"]?.stringValue,
      ["image", "inline-image", "video", "youtube", "tweet", "figma"].contains(type) else { return nil }
    self.type = type
    let destination: String?
    switch type {
    case "youtube": destination = node["videoID"]?.stringValue.map { MediaLinks.youtube + $0 }
    case "tweet": destination = node["id"]?.stringValue.map { MediaLinks.tweet + $0 }
    case "figma": destination = node["documentID"]?.stringValue.map { MediaLinks.figma + $0 }
    default: destination = node["src"]?.stringValue
    }
    source = destination.flatMap(URL.init(string:)).flatMap {
      if ["https", "http"].contains($0.scheme?.lowercased() ?? ""), $0.host != nil { return $0 }
      if ["image", "inline-image"].contains(type), $0.scheme == "data",
        ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/gif;base64,", "data:image/webp;base64,"].contains(where: $0.absoluteString.hasPrefix) { return $0 }
      return nil
    }
    label = node["altText"]?.stringValue.flatMap { $0.isEmpty ? nil : $0 }
      ?? ["image": "Image", "inline-image": "Image", "video": "Video", "youtube": "YouTube", "tweet": "Post on X", "figma": "Figma design"][type]!
    width = Self.dimension(node["width"])
    height = Self.dimension(node["height"])
    maxWidth = Self.dimension(node["maxWidth"])
    let natural = node["$"]?["natural"]
    let w = width ?? Self.dimension(natural?["width"])
    let h = height ?? Self.dimension(natural?["height"])
    aspectRatio = max(0.1, min(10, w.flatMap { w in h.map { w / $0 } } ?? (type == "image" ? 4.0 / 3.0 : 16.0 / 9.0)))
    if node["showCaption"] == true {
      caption = Self.text(node["caption"]?["root"])
    } else { caption = node["$"]?["figure"]?["caption"]?.stringValue ?? "" }
  }

  private static func dimension(_ value: JSONValue?) -> Double? {
    value?.numberValue.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
  }
  private static func text(_ value: JSONValue?) -> String {
    guard let value else { return "" }
    if let text = value["text"]?.stringValue { return text }
    if value["type"] == "linebreak" { return "\n" }
    let children = value["children"]?.arrayValue ?? []
    return children.map { text($0) }.joined(separator: value["type"] == "root" ? "\n" : "")
  }
}
