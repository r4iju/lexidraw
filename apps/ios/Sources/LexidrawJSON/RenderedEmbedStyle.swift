// Generated from web node constructors, documentFont and diagramStyle.
// Run bun run codegen in apps/ios to update.
public enum RenderedEmbedStyle {
  public static let defaultFontFamily = #"var(--doc-font-sans)"#
  public static let diagramMinimumScale = 0.8
  public static let chartTypes = [#"bar"#, #"line"#, #"area"#, #"pie"#, #"radar"#, #"scatter"#, #"composed"#]
  public static let insertionNodeJSON: [String: String] = [
    #"mermaid"#: #"{"type":"mermaid","version":1,"schema":"graph TD;\n  A[Start] --> B>Stop]","width":"inherit","height":"inherit"}"#,
    #"equation"#: #"{"equation":"","inline":false,"type":"equation","version":1}"#,
    #"chart"#: #"{"type":"chart","version":1,"chartType":"bar","chartData":"[]","chartConfig":"{}","width":"inherit","height":"inherit"}"#,
    #"code"#: #"{"children":[],"direction":null,"format":"","indent":0,"type":"code","version":1,"showLineNumbers":false}"#,
  ]
}
