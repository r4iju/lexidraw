// Generated from the actual nested editor JSX plugin mounts and node constructors.

public enum EditorContext: String, Codable, Sendable {
  case document
  case imageCaption
  case inlineImageCaption
  case videoCaption
  case slide

  var mountedPlugins: [String] {
    switch self {
    case .document: []
    case .imageCaption: ["MentionsPlugin", "LinkPlugin", "EmojisPlugin", "HashtagPlugin", "KeywordsPlugin", "HistoryPlugin", "TreeViewPlugin"]
    case .inlineImageCaption: ["MentionsPlugin", "LinkPlugin", "EmojisPlugin", "HashtagPlugin", "KeywordsPlugin", "HistoryPlugin", "TreeViewPlugin"]
    case .videoCaption: ["MentionsPlugin", "LinkPlugin", "EmojisPlugin", "HashtagPlugin", "KeywordsPlugin", "HistoryPlugin", "TreeViewPlugin"]
    case .slide: ["DisableChecklistSpacebarPlugin", "TabIndentationPlugin", "EmojiPickerPlugin", "ChartPlugin", "RichTextPlugin", "BlurPlugin", "AutocompletePlugin", "PageBreakPlugin", "MermaidPlugin", "HistoryPlugin", "MarkdownShortcutPlugin", "HorizontalRulePlugin", "EquationsPlugin", "AutoFocusPlugin", "TablePlugin", "MentionsPlugin", "LinkPlugin", "EmojisPlugin", "HashtagPlugin", "KeywordsPlugin", "TwitterPlugin", "YouTubePlugin", "ExcalidrawPlugin", "FigmaPlugin", "ImagePlugin", "InlineImagePlugin", "VideoPlugin", "LayoutPlugin", "CollapsiblePlugin", "CalloutPlugin", "PollPlugin", "TableActionMenuPlugin", "CodeActionMenuPlugin", "FloatingLinkEditorPlugin", "FloatingTextFormatToolbarPlugin"]
    }
  }

  public var registeredTypes: Set<String>? {
    switch self {
    case .document: nil
    case .imageCaption: ["artificial", "emoji", "hashtag", "keyword", "linebreak", "link", "paragraph", "root", "tab", "text"]
    case .inlineImageCaption: ["artificial", "emoji", "hashtag", "keyword", "linebreak", "link", "paragraph", "root", "tab", "text"]
    case .videoCaption: nil
    case .slide: ["article", "artificial", "autocomplete", "autolink", "callout", "chart", "code", "code-highlight", "collapsible-container", "collapsible-content", "collapsible-title", "comment", "emoji", "equation", "excalidraw", "figma", "footnote-definition", "footnote-reference", "hashtag", "heading", "horizontalrule", "html-block", "image", "inline-image", "keyword", "layout-container", "layout-item", "linebreak", "link", "list", "listitem", "mark", "mermaid", "page-break", "paragraph", "poll", "quote", "root", "slide-deck", "sticky", "tab", "table", "tablecell", "tablerow", "text", "thread", "tweet", "video", "youtube"]
    }
  }
}
