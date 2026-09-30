/// Shapes the native media caption renderer can display without discarding
/// visual instructions. The caption's JSON is retained even when it refuses.
public enum MediaCaptionSupport {
  public static func refusal(in state: JSONValue?) -> String? {
    guard let root = (state?["editorState"] ?? state)?["root"] else { return nil }
    var pending = [root]
    while let node = pending.popLast() {
      let type = node["type"]?.stringValue ?? ""
      guard ["root", "paragraph", "text", "linebreak", "tab", "link", "autolink"].contains(type) else {
        return "This caption contains \(type) nodes the native app can't show yet (#134)."
      }
      if let style = node["style"]?.stringValue, !style.isEmpty {
        return "This caption uses a text style the native app can't show yet (#135)."
      }
      if let style = node["textStyle"]?.stringValue, !style.isEmpty {
        return "This caption uses a text style the native app can't show yet (#135)."
      }
      pending.append(contentsOf: node["children"]?.arrayValue ?? [])
    }
    return nil
  }
}
