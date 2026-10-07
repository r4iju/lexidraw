// Generated from the actual nested editor JSX plugin mounts and node constructors.

public enum EditorContext: String, Codable, Sendable {
  case document
  case stickyCaption
  case imageCaption
  case inlineImageCaption
  case videoCaption
  case slide

  var mountedPlugins: [String] {
    switch self {
    case .document: []
    case .stickyCaption: Self.stickyCaptionPlugins
    case .imageCaption: Self.imageCaptionPlugins
    case .inlineImageCaption: Self.inlineImageCaptionPlugins
    case .videoCaption: Self.videoCaptionPlugins
    case .slide: Self.slidePlugins
    }
  }

  public var registeredTypes: Set<String>? {
    switch self {
    case .document: nil
    case .imageCaption: Self.imageCaptionRegistry
    case .inlineImageCaption: Self.inlineImageCaptionRegistry
    case .videoCaption: nil
    case .stickyCaption: nil
    case .slide: Self.slideRegistry
    }
  }

  private static let stickyCaptionPlugins: [String] = ["PlainTextPlugin"]
  private static let imageCaptionPlugins: [String] = ["MentionsPlugin", "LinkPlugin", "EmojisPlugin", "HashtagPlugin", "KeywordsPlugin", "HistoryPlugin", "TreeViewPlugin"]
  private static let inlineImageCaptionPlugins: [String] = ["MentionsPlugin", "LinkPlugin", "EmojisPlugin", "HashtagPlugin", "KeywordsPlugin", "HistoryPlugin", "TreeViewPlugin"]
  private static let videoCaptionPlugins: [String] = ["MentionsPlugin", "LinkPlugin", "EmojisPlugin", "HashtagPlugin", "KeywordsPlugin", "HistoryPlugin", "TreeViewPlugin"]
  private static let slidePlugins: [String] = ["DisableChecklistSpacebarPlugin", "TabIndentationPlugin", "EmojiPickerPlugin", "ChartPlugin", "RichTextPlugin", "BlurPlugin", "AutocompletePlugin", "PageBreakPlugin", "MermaidPlugin", "HistoryPlugin", "MarkdownShortcutPlugin", "HorizontalRulePlugin", "EquationsPlugin", "AutoFocusPlugin", "TablePlugin", "MentionsPlugin", "LinkPlugin", "EmojisPlugin", "HashtagPlugin", "KeywordsPlugin", "TwitterPlugin", "YouTubePlugin", "ExcalidrawPlugin", "FigmaPlugin", "ImagePlugin", "InlineImagePlugin", "VideoPlugin", "LayoutPlugin", "CollapsiblePlugin", "CalloutPlugin", "PollPlugin", "TableActionMenuPlugin", "CodeActionMenuPlugin", "CodeLineNumbersPlugin", "FloatingLinkEditorPlugin", "FloatingTextFormatToolbarPlugin"]

  private static let imageCaptionRegistry: Set<String> = ["artificial", "emoji", "hashtag", "keyword", "linebreak", "link", "mention", "paragraph", "root", "tab", "text"]
  private static let inlineImageCaptionRegistry: Set<String> = ["artificial", "emoji", "hashtag", "keyword", "linebreak", "link", "mention", "paragraph", "root", "tab", "text"]
  private static let slideRegistry: Set<String> = ["article", "artificial", "autocomplete", "autolink", "callout", "chart", "code", "code-highlight", "collapsible-container", "collapsible-content", "collapsible-title", "comment", "emoji", "equation", "excalidraw", "figma", "footnote-definition", "footnote-reference", "hashtag", "heading", "horizontalrule", "html-block", "image", "inline-image", "keyword", "layout-container", "layout-item", "linebreak", "link", "list", "listitem", "mark", "mention", "mermaid", "page-break", "paragraph", "poll", "quote", "root", "slide-deck", "sticky", "tab", "table", "tablecell", "tablerow", "text", "thread", "tweet", "video", "youtube"]
}
