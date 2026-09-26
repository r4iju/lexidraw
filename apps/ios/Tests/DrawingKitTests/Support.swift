import CoreGraphics
import Foundation
import ImageIO
import Testing

@testable import DrawingKit

let drawingFixtures = Bundle.module.url(forResource: "Fixtures", withExtension: nil)!
  .appending(path: "Drawings")

let fixtureScenes = try! FileManager.default.contentsOfDirectory(atPath: drawingFixtures.path)
  .filter { !$0.hasPrefix(".") }.sorted()

func sceneElements(_ scene: String) throws -> [JSONValue] {
  let data = try Data(contentsOf: drawingFixtures.appending(path: "\(scene)/scene.json"))
  return try JSONDecoder().decode([JSONValue].self, from: data)
}

func prepared(_ elements: [JSONValue], _ theme: DrawingTheme) -> PreparedScene {
  PreparedScene(restoreElements(elements), theme: theme, measurer: FontLibrary.shared)
}

/// The recorder's export settings.
let exportPadding = 10.0
let exportScale = 2.0

/// Logs what a `Canvas2D` is asked to draw in the recorder's format
/// (`reference/drawings/page.ts`), so the two can be compared call by call.
final class RecordingCanvas: Canvas2D {
  private(set) var events: [JSONValue] = []

  private func point(_ x: Double, _ y: Double) -> [JSONValue] {
    let p = state.transform.apply(Point2D(x, y))
    return [.number(p.x), .number(p.y)]
  }

  private var matrix: [JSONValue] {
    let t = state.transform
    return [t.a, t.b, t.c, t.d, t.e, t.f].map { .number($0) }
  }

  private var paint: [String: JSONValue] {
    ["alpha": .number(globalAlpha), "filter": .string(filter)]
  }

  private func quadValue(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> JSONValue {
    .array(quad(x, y, w, h).flatMap { [JSONValue.number($0.x), .number($0.y)] })
  }

  private func log(_ op: String, _ fields: [String: JSONValue] = [:]) {
    var event = fields
    event["op"] = .string(op)
    events.append(.object(JSONObject(event.map { ($0.key, $0.value) })))
  }

  override func beginPath() {
    log("beginPath")
    super.beginPath()
  }

  override func closePath() {
    log("closePath")
    super.closePath()
  }

  override func moveTo(_ x: Double, _ y: Double) {
    log("moveTo", ["p": .array(point(x, y))])
    super.moveTo(x, y)
  }

  override func lineTo(_ x: Double, _ y: Double) {
    log("lineTo", ["p": .array(point(x, y))])
    super.lineTo(x, y)
  }

  override func bezierCurveTo(
    _ c1x: Double, _ c1y: Double, _ c2x: Double, _ c2y: Double, _ x: Double, _ y: Double
  ) {
    log("bezierCurveTo", ["p": .array(point(c1x, c1y) + point(c2x, c2y) + point(x, y))])
    super.bezierCurveTo(c1x, c1y, c2x, c2y, x, y)
  }

  override func quadraticCurveTo(_ cx: Double, _ cy: Double, _ x: Double, _ y: Double) {
    log("quadraticCurveTo", ["p": .array(point(cx, cy) + point(x, y))])
    super.quadraticCurveTo(cx, cy, x, y)
  }

  // These two are logged as one call, as the browser logs them, and not as
  // the path segments they are built from.
  override func roundRect(
    _ x: Double, _ y: Double, _ width: Double, _ height: Double, _ radius: Double
  ) {
    log("roundRect", ["rect": .array([x, y, width, height, radius].map { .number($0) }), "m": .array(matrix)])
    quietly { super.roundRect(x, y, width, height, radius) }
  }

  override func rect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {
    log("rect", ["rect": .array([x, y, width, height].map { .number($0) }), "m": .array(matrix)])
    quietly { super.rect(x, y, width, height) }
  }

  private func quietly(_ body: () -> Void) {
    let count = events.count
    body()
    events.removeSubrange(count...)
  }

  override func stroke() {
    let t = state.transform
    log(
      "stroke",
      [
        "style": .string(strokeStyle), "width": .number(lineWidth),
        "m": .array([t.a, t.b, t.c, t.d].map { .number($0) }),
        "dash": .array(state.lineDash.map { .number($0) }), "dashOffset": .number(lineDashOffset),
        "cap": .string(lineCap), "join": .string(lineJoin),
      ].merging(paint) { a, _ in a })
  }

  override func fill(_ rule: FillRule = .nonzero) {
    log("fill", ["rule": .string(rule.rawValue), "style": .string(fillStyle)].merging(paint) { a, _ in a })
  }

  override func fill(svgPath d: String, _ rule: FillRule = .nonzero) {
    log(
      "fillPath2D",
      ["d": .string(d), "rule": .string(rule.rawValue), "m": .array(matrix), "style": .string(fillStyle)]
        .merging(paint) { a, _ in a })
  }

  override func clip(_ rule: FillRule = .nonzero) {
    log("clip", ["rule": .string(rule.rawValue)])
  }

  override func fillRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {
    log("fillRect", ["quad": quadValue(x, y, width, height), "style": .string(fillStyle)].merging(paint) { a, _ in a })
  }

  override func clearRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {
    log("clearRect", ["quad": quadValue(x, y, width, height)])
  }

  override func fillText(_ text: String, _ x: Double, _ y: Double) {
    let t = state.transform
    log(
      "fillText",
      [
        "text": .string(text), "p": .array(point(x, y)),
        "m": .array([t.a, t.b, t.c, t.d].map { .number($0) }), "font": .string(font),
        "align": .string(textAlign), "baseline": "alphabetic", "style": .string(fillStyle),
      ].merging(paint) { a, _ in a })
  }

  override func makeLayer(width: Int, height: Int) -> Canvas2D { RecordingCanvas() }

  override func drawLayer(
    _ layer: Canvas2D, size: (width: Int, height: Int), _ x: Double, _ y: Double, _ width: Double,
    _ height: Double
  ) {
    log(
      "drawLayer",
      [
        "size": [.number(Double(size.width)), .number(Double(size.height))],
        "quad": quadValue(x, y, width, height),
        "events": .array((layer as! RecordingCanvas).events),
      ].merging(paint) { a, _ in a })
  }
}

/// Where two event logs first differ, or nil if they agree. Points and
/// matrices may differ by rounding (the recorder keeps three decimals),
/// colours by how they are written, and SVG path data by the last of the two
/// decimals it is cut to.
func firstDifference(_ expected: [JSONValue], _ actual: [JSONValue], path: String = "")
  -> String?
{
  for index in 0..<max(expected.count, actual.count) {
    guard index < expected.count else { return "\(path)[\(index)]: unexpected \(describe(actual[index]))" }
    guard index < actual.count else { return "\(path)[\(index)]: missing \(describe(expected[index]))" }
    if let difference = eventDifference(expected[index], actual[index], path: "\(path)[\(index)]") {
      return difference
    }
  }
  return nil
}

private func eventDifference(_ expected: JSONValue, _ actual: JSONValue, path: String) -> String? {
  guard let e = expected.objectValue, let a = actual.objectValue else { return "\(path): not an event" }
  let mismatch = "\(path): expected \(describe(expected))\n  got \(describe(actual))"
  guard Set(e.keys) == Set(a.keys) else { return mismatch }
  for (key, value) in e {
    let other = a[key]!
    switch key {
    case "events":
      if let difference = firstDifference(
        value.arrayValue ?? [], other.arrayValue ?? [], path: "\(path).events")
      {
        return difference
      }
    case "style":
      guard let x = CSSColor(value.stringValue ?? ""), let y = CSSColor(other.stringValue ?? ""),
        abs(x.red - y.red) < 0.5 / 255, abs(x.green - y.green) < 0.5 / 255,
        abs(x.blue - y.blue) < 0.5 / 255, abs(x.alpha - y.alpha) < 0.005
      else { return mismatch }
    case "d":
      guard pathDataMatches(value.stringValue ?? "", other.stringValue ?? "") else { return mismatch }
    default:
      guard valuesMatch(value, other) else { return mismatch }
    }
  }
  return nil
}

private func valuesMatch(_ a: JSONValue, _ b: JSONValue) -> Bool {
  switch (a, b) {
  case (.number(let x), .number(let y)): abs(x - y) <= 0.002
  case (.array(let x), .array(let y)): x.count == y.count && zip(x, y).allSatisfy(valuesMatch)
  default: a == b
  }
}

private func pathDataMatches(_ a: String, _ b: String) -> Bool {
  let numbers = /-?[0-9]*\.?[0-9]+(e-?[0-9]+)?/
  let letters = { (s: String) in s.replacing(numbers, with: "#") }
  let values = { (s: String) in s.matches(of: numbers).compactMap { Double($0.output.0) } }
  let x = values(a)
  let y = values(b)
  return letters(a) == letters(b) && x.count == y.count
    && zip(x, y).allSatisfy { abs($0 - $1) <= 0.011 }
}

private func describe(_ value: JSONValue) -> String {
  let encoder = JSONEncoder()
  encoder.outputFormatting = .sortedKeys
  let text = String(decoding: try! encoder.encode(value), as: UTF8.self)
  return text.count > 400 ? String(text.prefix(400)) + "..." : text
}

/// RGBA pixels, as a PNG decodes or a canvas draws them.
struct Pixels {
  var width: Int
  var height: Int
  var bytes: [UInt8]

  init(_ image: CGImage) {
    width = image.width
    height = image.height
    bytes = [UInt8](repeating: 0, count: width * height * 4)
    bytes.withUnsafeMutableBytes { buffer in
      let context = CGContext(
        data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
  }

  init(png url: URL) throws {
    let source = try #require(CGImageSourceCreateWithURL(url as CFURL, nil))
    self.init(try #require(CGImageSourceCreateImageAtIndex(source, 0, nil)))
  }

  func pixel(_ x: Int, _ y: Int) -> (Int, Int, Int, Int) {
    let i = (y * width + x) * 4
    return (Int(bytes[i]), Int(bytes[i + 1]), Int(bytes[i + 2]), Int(bytes[i + 3]))
  }
}

/// The share of pixels in `a` with no pixel of nearly the same colour within
/// `radius` in `b`, or the other way round: the shapes may be anti-aliased
/// differently and glyphs rasterised differently, but nothing may be missing,
/// added or moved further than that.
func mismatchShare(_ a: Pixels, _ b: Pixels, radius: Int = 1, tolerance: Int = 64) -> Double {
  guard a.width == b.width, a.height == b.height else { return 1 }
  func unmatched(_ p: Pixels, _ q: Pixels) -> Int {
    var count = 0
    for y in 0..<p.height {
      for x in 0..<p.width {
        let c = p.pixel(x, y)
        var found = false
        search: for dy in -radius...radius {
          for dx in -radius...radius {
            let nx = x + dx
            let ny = y + dy
            guard nx >= 0, ny >= 0, nx < q.width, ny < q.height else { continue }
            let d = q.pixel(nx, ny)
            if abs(c.0 - d.0) <= tolerance, abs(c.1 - d.1) <= tolerance,
              abs(c.2 - d.2) <= tolerance, abs(c.3 - d.3) <= tolerance
            {
              found = true
              break search
            }
          }
        }
        if !found { count += 1 }
      }
    }
    return count
  }
  let total = Double(a.width * a.height)
  return Double(max(unmatched(a, b), unmatched(b, a))) / total
}

func renderImage(_ elements: [JSONValue], _ theme: DrawingTheme) -> CGImage {
  let scene = prepared(elements, theme)
  let size = scene.exportPixelSize(padding: exportPadding, scale: exportScale)
  let canvas = CGCanvas(width: size.width, height: size.height, fonts: FontLibrary.shared)
  scene.export(on: canvas, padding: exportPadding, scale: exportScale, background: "#ffffff")
  return canvas.makeImage()!
}
