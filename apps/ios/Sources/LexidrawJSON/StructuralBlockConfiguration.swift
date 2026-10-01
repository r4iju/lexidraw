// Generated from structural node factories, web presets and document CSS.
// Run bun run codegen in apps/ios to update.
public enum StructuralBlockConfiguration {
  public static let columnGap = 8.0
  public static let columnBorderColors = ["rgba(237.94559999999998, 238.03179, 241.030845, 1)","rgba(42.491415, 42.58245, 49.221375, 1)"]
  public static let columnPadding = 8.0
  public static let columnBorderWidth = 1.0
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
  public static let stickyColors: [String:[String]] = ["pink": ["rgba(255, 191.56160999999997, 223.80891, 1)", "rgba(218.839215, 165.506475, 189.6333, 1)"], "yellow": ["rgba(255, 227.800935, 121.398105, 1)", "rgba(216.23031, 195.79971, 118.711935, 1)"], "green": ["rgba(173.09349, 232.804545, 184.38259499999998, 1)", "rgba(151.85709, 196.531815, 160.00153500000002, 1)"], "blue": ["rgba(164.014725, 214.08219, 255, 1)", "rgba(143.535165, 181.07091, 220.482435, 1)"], "red": ["rgba(255, 183.53472000000002, 175.94541, 1)", "rgba(223.615365, 157.57878, 151.491675, 1)"], "orange": ["rgba(255, 200.55087, 136.35411000000002, 1)", "rgba(223.72118999999998, 171.71139, 121.26856500000001, 1)"], "purple": ["rgba(217.693245, 196.12407, 255, 1)", "rgba(183.54849000000002, 167.509245, 215.60658, 1)"], "gray": ["rgba(208.35336, 208.456125, 212.11104, 1)", "rgba(176.467905, 176.56633499999998, 180.10956000000002, 1)"]]
  public static let dividerLabel = "Divider"
  public static let insertionNodes: [String:String] = ["horizontalrule": #"{"type":"horizontalrule","version":1}"#,
    "callout": #"{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"callout","version":1,"kind":"note","title":""}"#,
    "collapsible-container": #"{"children":[{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"collapsible-title","version":1},{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"collapsible-content","version":1}],"direction":null,"format":"","indent":0,"type":"collapsible-container","version":1,"open":false}"#,
    "layout-container": #"{"children":[{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"layout-item","version":1},{"children":[{"children":[],"direction":null,"format":"","indent":0,"textFormat":0,"textStyle":"","type":"paragraph","version":1}],"direction":null,"format":"","indent":0,"type":"layout-item","version":1}],"direction":null,"format":"","indent":0,"type":"layout-container","version":1,"templateColumns":"1fr 1fr"}"#,
    "page-break": #"{"type":"page-break","version":1}"#,
    "sticky": #"{"caption":{"editorState":{"root":{"children":[],"direction":null,"format":"","indent":0,"type":"root","version":1}}},"color":"yellow","type":"sticky","version":1,"xOffset":0,"yOffset":0}"#,
    "slide-deck": #"{"type":"slide-deck","version":1,"data":{"slides":[{"id":"default-slide-1","elements":[{"kind":"box","id":"default-box-1","x":50,"y":50,"width":300,"height":50,"editorStateJSON":{"root":{"children":[{"key":"1","type":"paragraph","version":1,"direction":"ltr","format":"","indent":0,"textFormat":0,"textStyle":"","children":[{"detail":0,"format":0,"mode":"normal","style":"","text":"","type":"text","version":1,"key":"initial-text-content-node"}]}],"direction":"ltr","format":"","indent":0,"type":"root","version":1,"key":"root"}},"zIndex":0}]}],"currentSlideId":"default-slide-1"}}"#]
}
