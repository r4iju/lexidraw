// Generated from structural node factories, web presets and document CSS.
// Run bun run codegen in apps/ios to update.
public enum StructuralBlockConfiguration {
  public static let columnWhitespacePattern = "\\s+"
  public static let isolatedNodeTypes: Set<String> = ["sticky"]
  public static let stickyWidth = 192.0
  public static let stickyHeight = 192.0
  public static let stickyPadding = 4.0
  public static let chartTypes: [String] = ["bar", "line", "area", "pie", "radar", "scatter", "composed"]
  public static let slideElements: [String:String] = ["box": #"{"kind":"box","id":"__id__","x":20,"y":20,"width":200,"height":100,"editorStateJSON":{"root":{"children":[{"key":"1","type":"paragraph","version":1,"direction":"ltr","format":"","indent":0,"textFormat":0,"textStyle":"","children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"","type":"text","version":1,"key":"initial-text-content-node"}]}],"direction":"ltr","format":"","indent":0,"type":"root","version":1,"key":"root"}},"zIndex":0}"#, "chart": #"{"kind":"chart","id":"__id__","x":40,"y":40,"width":400,"height":300,"chartType":"bar","chartData":"[]","chartConfig":"{}","zIndex":0}"#, "image": #"{"kind":"image","id":"__id__","x":30,"y":30,"width":250,"height":50,"url":"","zIndex":0}"# ]
  public static let slideMinimumWidth = 40.0
  public static let slideMinimumHeight = 20.0
  public static let slideWidth = 1280.0
  public static let slideHeight = 720.0
  public static let stackedColumnsWidth = 567.0
  public static let calloutLabels: [String:String] = ["note": "Note", "tip": "Tip", "important": "Important", "warning": "Warning", "caution": "Caution"]
  public static let calloutColors: [String:[String]] = ["note": ["#0969da", "#4493f8"], "tip": ["#1a7f37", "#3fb950"], "important": ["#8250df", "#ab7df8"], "warning": ["#9a6700", "#d29922"], "caution": ["#cf222e", "#f85149"]]
  public static let calloutTint = [0.08, 0.14]
  public static let calloutRadius = 8.0
  public static let calloutPaddingY = 12.0
  public static let calloutPaddingX = 16.0
  public static let layouts: [(label: String, value: String)] = [("2 columns (equal width)", "1fr 1fr"), ("2 columns (25% - 75%)", "1fr 3fr"), ("3 columns (equal width)", "1fr 1fr 1fr"), ("3 columns (25% - 50% - 25%)", "1fr 2fr 1fr"), ("4 columns (equal width)", "1fr 1fr 1fr 1fr")]
  public static let stickyColors: [String:[String]] = ["pink": ["oklch(.88 .09 350)", "oklch(.78 .07 350)"], "yellow": ["oklch(.92 .13 95)", "oklch(.82 .10 95)"], "green": ["oklch(.88 .09 150)", "oklch(.78 .07 150)"], "blue": ["oklch(.86 .09 250)", "oklch(.76 .07 250)"], "red": ["oklch(.86 .10 25)", "oklch(.76 .08 25)"], "orange": ["oklch(.88 .11 65)", "oklch(.78 .09 65)"], "purple": ["oklch(.86 .09 300)", "oklch(.76 .07 300)"], "gray": ["oklch(.86 .005 285)", "oklch(.76 .005 285)"]]
  public static let insertionNodes: [String:String] = ["callout": #"{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"callout","version":1,"kind":"note","title":""}"#,
    "collapsible-container": #"{"children":[{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"collapsible-title","version":1},{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"collapsible-content","version":1}],"direction":null,"format":"","indent":0,"type":"collapsible-container","version":1,"open":false}"#,
    "layout-container": #"{"children":[{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"layout-item","version":1},{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"layout-item","version":1}],"direction":null,"format":"","indent":0,"type":"layout-container","version":1,"templateColumns":"1fr 1fr"}"#,
    "page-break": #"{"type":"page-break","version":1}"#,
    "sticky": #"{"caption":{"editorState":{"root":{"children":[],"direction":null,"format":"","indent":0,"type":"root","version":1}}},"color":"yellow","type":"sticky","version":1,"xOffset":0,"yOffset":0}"#,
    "slide-deck": #"{"type":"slide-deck","version":1,"data":{"slides":[{"id":"default-slide-1","elements":[{"kind":"box","id":"default-box-1","x":50,"y":50,"width":300,"height":50,"editorStateJSON":{"root":{"children":[{"key":"1","type":"paragraph","version":1,"direction":"ltr","format":"","indent":0,"textFormat":0,"textStyle":"","children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"","type":"text","version":1,"key":"initial-text-content-node"}]}],"direction":"ltr","format":"","indent":0,"type":"root","version":1,"key":"root"}},"zIndex":0}]}],"currentSlideId":"default-slide-1"}}"#]
}
