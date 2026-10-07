import EditorModelInterface
import Foundation

/// Rendering reads the payload without changing the JSON retained by the model.
struct MediaPayload: Sendable {
  let type: String
  let source: URL?
  let label: String
  let caption: String
  let captionState: JSONValue?
  let captionRefusal: String?
  let figurePlacement: String?
  let naturalWidth: Double?
  let aspectRatio: Double
  let width: Double?
  let height: Double?
  let maxWidth: Double?
  /// The block's `format`: the side of the column an embed narrower than it sits at.
  let alignment: Alignment
  enum Alignment { case leading, center, trailing }

  /// `string` as a browser parses a URL from it: without the controls and
  /// spaces around it, nor any tab or newline within.
  static func browserURLString(_ string: String) -> String {
    let isControlOrSpace = { (scalar: Unicode.Scalar) in scalar.value <= 0x20 }
    var scalars = Substring(string).unicodeScalars.drop(while: isControlOrSpace)
    while let last = scalars.last, isControlOrSpace(last) { scalars.removeLast() }
    return String(String.UnicodeScalarView(scalars.filter { !["\t", "\n", "\r"].contains($0) }))
  }

  init?(_ node: JSONValue) {
    guard let type = node["type"]?.stringValue,
      ["image", "inline-image", "video", "youtube", "tweet", "figma"].contains(type) else { return nil }
    self.type = type
    let destination: String?
    switch type {
    case "youtube": destination = Self.link(MediaLinks.youtube, node["videoID"], MediaLinks.youtubeID)
    case "tweet": destination = Self.link(MediaLinks.tweet, node["id"], MediaLinks.tweetID)
    case "figma": destination = Self.link(MediaLinks.figma, node["documentID"], MediaLinks.figmaID)
    default: destination = node["src"]?.stringValue
    }
    source = destination.map(Self.browserURLString).flatMap(URL.init(string:)).flatMap {
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
    switch node["format"]?.stringValue {
    case "left", "start": alignment = .leading
    case "right", "end": alignment = .trailing
    default: alignment = .center
    }
    figurePlacement = node["$"]?["figure"]?["width"]?.stringValue.flatMap { width in
      if ["wide", "full"].contains(width) { return width }
      if width.hasSuffix("%"), (1...3).contains(width.dropLast().count), width.dropLast().allSatisfy({ $0.isASCII && $0.isNumber }), let number = Int(width.dropLast()), (10..<100).contains(number) { return "\(number)%" }
      return nil
    }
    let natural = node["$"]?["natural"]
    naturalWidth = Self.dimension(natural?["width"])
    let w = Self.dimension(natural?["width"]) ?? width
    let h = Self.dimension(natural?["height"]) ?? height
    aspectRatio = w.flatMap { w in h.map { w / $0 } } ?? 16.0 / 9.0
    if node["showCaption"] == true && (type == "inline-image" ? node["captionsEnabled"] != false : type != "video" || node["captionsEnabled"] == true) {
      captionState = node["caption"]?["editorState"] ?? node["caption"]
      captionRefusal = MediaCaptionSupport.refusal(in: captionState)
      caption = captionRefusal ?? Self.text(captionState?["root"])
    } else {
      captionState = nil
      captionRefusal = nil
      caption = node["$"]?["figure"]?["caption"]?.stringValue ?? ""
    }
  }

  func figureWidth(fitting available: Double, em: Double) -> Double {
    let column = min(available, FigureStyle.columnRem * em)
    switch figurePlacement {
    case "wide": return min(available, FigureStyle.wideRem * em)
    case "full": return available
    case .some(let share):
      let percent = Double(share.dropLast()) ?? 100
      let least = available <= FigureStyle.phoneWidth ? available : min(available, FigureStyle.minimumShareRem * em)
      return min(available, max(column * percent / 100, least))
    case nil: return column
    }
  }

  /// Where a media body `width` wide starts in `available`: at its aligned
  /// side of the column, or centred when it is as wide as the column or wider.
  func mediaX(width: Double, fitting available: Double, em: Double) -> Double {
    let centered = (available - width) / 2
    let inset = max(0, (available - min(available, FigureStyle.columnRem * em)) / 2)
    switch alignment {
    case .leading: return min(inset, centered)
    case .center: return centered
    case .trailing: return max(available - inset - width, centered)
    }
  }

  /// What an embed whose id links nowhere says instead.
  var unlinkedMessage: String {
    switch type {
    case "youtube": "No video linked"
    case "tweet": "No post linked"
    case "figma": "No Figma file linked"
    default: "\(label): source unavailable"
    }
  }

  /// `base` and `id`, when `id` is one its provider can have something under.
  private static func link(_ base: String, _ id: JSONValue?, _ pattern: String) -> String? {
    guard let id = id?.stringValue, id.range(of: pattern, options: .regularExpression) != nil else { return nil }
    return base + id
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
