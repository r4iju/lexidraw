// Generated from structural node factories, web presets and document CSS.
// Run bun run codegen in apps/ios to update.
public enum StructuralBlockConfiguration {
  public static let slidePreviewInitialIndex = 0
  public static let slideBoxVersionIncrement = 1.0
  public static let slideContentMinimumChildCount = 0
  public static let columnGap = 8.0
  public static let columnBorderColors = ["rgba(237.94559999999998, 238.03179, 241.030845, 1)","rgba(42.491415, 42.58245, 49.221375, 1)"]
  public static let columnPadding = 8.0
  public static let columnBorderWidth = 1.0
  public static let columnFramesShowAtRest = false
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
  public static let calloutColors: [String:[String]] = ["note": ["#0966d3", "#4493f8"], "tip": ["#197a35", "#3fb950"], "important": ["#7d4dd6", "#ab7df8"], "warning": ["#916100", "#d29922"], "caution": ["#cf222e", "#f85149"]]
  public static let calloutTint = [0.08, 0.14]
  public static let calloutRadius = 8.0
  public static let calloutPaddingY = 12.0
  public static let calloutPaddingX = 16.0
  public static let calloutHeaderGap = 8.0
  public static let calloutHeaderAfter = 4.0
  public static let calloutHeaderWeight = 600.0
  public static let calloutHeaderLineHeight = 1.5
  public static let calloutIconSize = 18.0
  /// Lucide icon names by kind.
  public static let calloutIcons: [String:String] = ["note": "info", "tip": "lightbulb", "important": "message-square-warning", "warning": "triangle-alert", "caution": "octagon-alert"]
  /// A toggle's chevron column, in ems of the document's text.
  public static let sectionGutter = 1.625
  /// The chevron's box: ems of its line's text plus ems of the document's, inset by the latter.
  public static let sectionChevronEm = 0.5
  public static let sectionChevronRem = 0.5
  public static let sectionChevronInset = 0.125
  public static let sectionContentGap = 0.25
  /// A title's text size and leading by its block, in ems of the document's text.
  public static let sectionLevels: [String: (fontSize: Double, lineHeight: Double)] = ["paragraph": (1, 1.6), "h1": (1.875, 1.25), "h2": (1.5, 1.3), "h3": (1.25, 1.4), "h4": (1.0625, 1.5), "h5": (1, 1.5), "h6": (0.875, 1.5)]
  public static let sectionChevronColors = ["rgba(95.406975, 95.5638, 103.153875, 1)","rgba(163.60238999999999, 163.776045, 170.75539500000002, 1)"]
  public static let sectionChevronViewBox = 24.0
  public static let sectionChevronStrokeWidth = 2.0
  public static let sectionChevronPoints: [(x: Double, y: Double)] = [(9.0, 18.0), (15.0, 12.0), (9.0, 6.0)]
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
