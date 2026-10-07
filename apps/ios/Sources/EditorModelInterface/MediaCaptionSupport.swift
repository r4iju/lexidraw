import CSSValues

/// Shapes the native media caption renderer can display without discarding
/// visual instructions. The caption's JSON is retained even when it refuses.
public enum MediaCaptionSupport {
  public static func refusal(in state: JSONValue?) -> String? {
    guard let root = (state?["editorState"] ?? state)?["root"] else { return nil }
    var pending = [root]
    while let node = pending.popLast() {
      let type = node["type"]?.stringValue ?? ""
      guard ["root", "paragraph", "text", "mention", "hashtag", "keyword", "emoji", "linebreak", "tab", "link", "autolink"].contains(type) else {
        return "This caption contains \(type) nodes the native app can't show yet (#134)."
      }
      if let style = node["style"]?.stringValue, !style.isEmpty, !supportedTextStyle(style) {
        return "This caption uses a text style the native app can't show yet (#135)."
      }
      if let style = node["textStyle"]?.stringValue, !style.isEmpty, !supportedTextStyle(style) {
        return "This caption uses a text style the native app can't show yet (#135)."
      }
      pending.append(contentsOf: node["children"]?.arrayValue ?? [])
    }
    return nil
  }
  private static func supportedTextStyle(_ value: String) -> Bool {
    var css = InlineCSS(value)
    if let rawSize = css["font-size"] {
      guard rawSize.hasSuffix("px"), let size = Double(rawSize.dropLast(2)), size.isFinite, size > 0 else { return false }
      css["font-size"] = nil
    }
    for property in ["color", "background-color"] {
      if let value = css[property] {
        guard CSSColor(value) != nil else { return false }
        css[property] = nil
      }
    }
    return css.serialized.isEmpty
  }
}
