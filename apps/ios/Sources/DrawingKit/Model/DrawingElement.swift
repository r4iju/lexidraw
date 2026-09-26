import Foundation
import LexidrawJSON

public struct Roundness: Equatable, Sendable {
  public var type: Int
  public var value: Double?
}

public struct BoundElement: Equatable, Sendable {
  public var id: String
  public var type: String
}

/// One canonical Excalidraw element. `raw` is the element as stored, kept
/// whole so fields and types this app doesn't know survive a save; the typed
/// properties are what `restoreElements` makes of it, which is what the web
/// draws.
public struct DrawingElement: Sendable {
  public var raw: JSONObject

  public var id: String
  public var type: String
  public var x: Double
  public var y: Double
  public var width: Double
  public var height: Double
  public var angle: Double
  public var strokeColor: String
  public var backgroundColor: String
  public var fillStyle: String
  public var strokeWidth: Double
  public var strokeStyle: String
  public var roughness: Double
  public var opacity: Double
  public var seed: Double
  public var version: Double
  public var isDeleted: Bool
  public var groupIds: [String]
  public var frameId: String?
  public var roundness: Roundness?
  public var boundElements: [BoundElement]
  public var locked: Bool

  public var points: [Point2D] = []
  public var startArrowhead: String?
  public var endArrowhead: String?
  public var elbowed = false

  public var pressures: [Double] = []
  public var simulatePressure = false
  public var lastCommittedPoint: Point2D?

  public var text = ""
  public var fontSize = 20.0
  public var fontFamily = 5.0
  public var textAlign = "left"
  public var verticalAlign = "top"
  public var containerId: String?
  public var lineHeight = 1.25

  public var fileId: String?
  public var status = "pending"
  public var scale = [1.0, 1.0]
  /// The part of the file shown, in the file's pixels.
  public var crop: (x: Double, y: Double, width: Double, height: Double)?

  public var name: String?

  static let knownTypes: Set<String> = [
    "rectangle", "diamond", "ellipse", "line", "arrow", "freedraw", "text", "image", "frame",
    "magicframe", "iframe", "embeddable",
  ]

  public var isLinear: Bool { type == "line" || type == "arrow" }
  public var isFrameLike: Bool { type == "frame" || type == "magicframe" }
  public var isElbowArrow: Bool { type == "arrow" && elbowed }
  public var boundTextId: String? { boundElements.first { $0.type == "text" }?.id }

  /// Restores `raw` as `restoreElement` does, or nil where the web drops the
  /// element: a selection, an invisibly small element, or a type it doesn't know.
  public init?(restoring raw: JSONObject) {
    self.raw = raw
    func number(_ key: String) -> Double? { raw[key]?.numberValue }
    func string(_ key: String) -> String? { raw[key]?.stringValue }
    func truthyString(_ key: String) -> String? {
      guard let value = string(key), !value.isEmpty else { return nil }
      return value
    }
    func truthyNumber(_ key: String) -> Double? {
      guard let value = number(key), value != 0, !value.isNaN else { return nil }
      return value
    }
    func points(_ key: String) -> [Point2D]? {
      raw[key]?.arrayValue?.map { entry in
        let pair = entry.arrayValue ?? []
        return Point2D(pair.first?.numberValue ?? 0, pair.dropFirst().first?.numberValue ?? 0)
      }
    }

    let type = string("type") ?? ""
    guard type != "selection" else { return nil }
    let rawPoints = points("points")
    if type == "line" || type == "arrow" || type == "freedraw" || type == "draw" {
      if (rawPoints?.count ?? 0) < 2 { return nil }
    } else if number("width") == 0 && number("height") == 0 {
      return nil
    }
    let restoredType = type == "draw" ? "line" : type
    guard Self.knownTypes.contains(restoredType) else { return nil }

    self.type = restoredType
    id = truthyString("id") ?? UUID().uuidString
    version = truthyNumber("version") ?? 1
    isDeleted = raw["isDeleted"]?.boolValue ?? false
    fillStyle = truthyString("fillStyle") ?? "solid"
    strokeWidth = truthyNumber("strokeWidth") ?? 2
    strokeStyle = string("strokeStyle") ?? "solid"
    roughness = number("roughness") ?? 1
    opacity = number("opacity") ?? 100
    angle = truthyNumber("angle") ?? 0
    x = number("x") ?? 0
    y = number("y") ?? 0
    strokeColor = truthyString("strokeColor") ?? "#1e1e1e"
    backgroundColor = truthyString("backgroundColor") ?? "transparent"
    width = truthyNumber("width") ?? 0
    height = truthyNumber("height") ?? 0
    seed = number("seed") ?? 1
    groupIds = raw["groupIds"]?.arrayValue?.compactMap(\.stringValue) ?? []
    frameId = string("frameId")
    if let roundness = raw["roundness"]?.objectValue {
      self.roundness = Roundness(
        type: roundness["type"]?.intValue ?? 0, value: roundness["value"]?.numberValue)
    } else if string("strokeSharpness") == "round" {
      let adaptive = ["rectangle", "embeddable", "iframe", "image"].contains(type)
      self.roundness = Roundness(type: adaptive ? 1 : 2, value: nil)
    } else {
      self.roundness = nil
    }
    if let ids = raw["boundElementIds"]?.arrayValue {
      boundElements = ids.compactMap(\.stringValue).map { BoundElement(id: $0, type: "arrow") }
    } else {
      boundElements = (raw["boundElements"]?.arrayValue ?? []).compactMap { entry in
        guard let id = entry["id"]?.stringValue, let type = entry["type"]?.stringValue else {
          return nil
        }
        return BoundElement(id: id, type: type)
      }
    }
    locked = raw["locked"]?.boolValue ?? false
    if width < 0 {
      width = abs(width)
      x -= width
    }
    if height < 0 {
      height = abs(height)
      y -= height
    }

    switch restoredType {
    case "text":
      text = truthyString("text") ?? ""
      fontSize = number("fontSize") ?? 20
      fontFamily = number("fontFamily") ?? 5
      if let font = string("font") {
        let parts = font.split(separator: " ", maxSplits: 1).map(String.init)
        fontSize = Double(parts[0].prefix(while: { "0123456789.-".contains($0) })) ?? fontSize
        fontFamily = parts.count > 1 ? FontMetrics.familyNumber(named: parts[1]) : 5
      }
      textAlign = truthyString("textAlign") ?? "left"
      verticalAlign = truthyString("verticalAlign") ?? "top"
      containerId = string("containerId")
      if let lineHeight = truthyNumber("lineHeight") {
        self.lineHeight = lineHeight
      } else if let height = truthyNumber("height") {
        let lines = Double(splitIntoLines(text).count)
        self.lineHeight = height / lines / fontSize
      } else {
        self.lineHeight = FontMetrics.lineHeight(forFamily: number("fontFamily") ?? 5)
      }
      if text.isEmpty { isDeleted = true }
    case "freedraw":
      self.points = rawPoints ?? []
      pressures = raw["pressures"]?.arrayValue?.compactMap(\.numberValue) ?? []
      simulatePressure = raw["simulatePressure"]?.boolValue ?? false
    case "image":
      fileId = string("fileId")
      status = string("status").flatMap { $0.isEmpty ? nil : $0 } ?? "pending"
      if let crop = raw["crop"]?.objectValue {
        let value = { (key: String) in crop[key]?.numberValue ?? 0 }
        self.crop = (value("x"), value("y"), value("width"), value("height"))
      }
      if let scale = raw["scale"]?.arrayValue?.compactMap(\.numberValue), scale.count == 2 {
        self.scale = scale
      }
    case "line", "arrow":
      var restored = rawPoints ?? []
      if let first = restored.first, first.x != 0 || first.y != 0 {
        restored = restored.map { Point2D($0.x - first.x, $0.y - first.y) }
        x += first.x
        y += first.y
      }
      self.points = restored
      startArrowhead = string("startArrowhead")
      if restoredType == "arrow" {
        endArrowhead = raw.keys.contains("endArrowhead") ? string("endArrowhead") : "arrow"
        elbowed = raw["elbowed"]?.boolValue ?? false
      } else {
        endArrowhead = string("endArrowhead")
      }
      let xs = restored.map(\.x)
      let ys = restored.map(\.y)
      width = (xs.max() ?? 0) - (xs.min() ?? 0)
      height = (ys.max() ?? 0) - (ys.min() ?? 0)
    case "frame", "magicframe":
      name = string("name")
    default:
      break
    }
  }

  /// An element made here rather than read, as the export adds frame names.
  init(text: String, x: Double, y: Double, width: Double, height: Double, fontSize: Double,
    fontFamily: Double, lineHeight: Double, strokeColor: String, id: String)
  {
    raw = [:]
    self.id = id
    type = "text"
    self.x = x
    self.y = y
    self.width = width
    self.height = height
    angle = 0
    self.strokeColor = strokeColor
    backgroundColor = "transparent"
    fillStyle = "solid"
    strokeWidth = 2
    strokeStyle = "solid"
    roughness = 1
    opacity = 100
    seed = 1
    version = 1
    isDeleted = false
    groupIds = []
    frameId = nil
    roundness = nil
    boundElements = []
    locked = false
    self.text = text
    self.fontSize = fontSize
    self.fontFamily = fontFamily
    self.lineHeight = lineHeight
  }
}

/// `text.split(/\r\n|\r|\n/)` after normalising, as Excalidraw splits lines.
func splitIntoLines(_ text: String) -> [String] {
  text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    .components(separatedBy: "\n")
}

/// `restoreElements` element by element: what the web makes of stored
/// elements before drawing them.
public func restoreElements(_ elements: [JSONValue]) -> [DrawingElement] {
  elements.compactMap { $0.objectValue.flatMap(DrawingElement.init(restoring:)) }
}
