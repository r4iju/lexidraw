import Foundation

/// An affine transform with the canvas's `a b c d e f` layout.
public struct Transform2D: Equatable, Sendable {
  public var a, b, c, d, e, f: Double

  public static let identity = Transform2D(a: 1, b: 0, c: 0, d: 1, e: 0, f: 0)

  public init(a: Double, b: Double, c: Double, d: Double, e: Double, f: Double) {
    (self.a, self.b, self.c, self.d, self.e, self.f) = (a, b, c, d, e, f)
  }

  public func apply(_ p: Point2D) -> Point2D {
    Point2D(a * p.x + c * p.y + e, b * p.x + d * p.y + f)
  }

  func translated(_ x: Double, _ y: Double) -> Transform2D {
    Transform2D(a: a, b: b, c: c, d: d, e: a * x + c * y + e, f: b * x + d * y + f)
  }

  func scaled(_ x: Double, _ y: Double) -> Transform2D {
    Transform2D(a: a * x, b: b * x, c: c * y, d: d * y, e: e, f: f)
  }

  func rotated(_ angle: Double) -> Transform2D {
    let cosine = cos(angle)
    let sine = sin(angle)
    return Transform2D(
      a: a * cosine + c * sine, b: b * cosine + d * sine,
      c: c * cosine - a * sine, d: d * cosine - b * sine, e: e, f: f)
  }

  public var inverted: Transform2D {
    let determinant = a * d - b * c
    guard determinant != 0 else { return .identity }
    return Transform2D(
      a: d / determinant, b: -b / determinant, c: -c / determinant, d: a / determinant,
      e: (c * f - d * e) / determinant, f: (b * e - a * f) / determinant)
  }
}

public enum FillRule: String, Sendable { case nonzero, evenodd }

/// A path as a canvas keeps it: in device space, transformed as it is built.
public enum PathElement: Sendable {
  case move(Point2D)
  case line(Point2D)
  case quad(Point2D, Point2D)
  case cubic(Point2D, Point2D, Point2D)
  case close
}

public struct Canvas2DState: Sendable {
  public var transform = Transform2D.identity
  public var globalAlpha = 1.0
  public var fillStyle = CSSColor.black
  public var strokeStyle = CSSColor.black
  public var lineWidth = 1.0
  public var lineCap = "butt"
  public var lineJoin = "miter"
  public var lineDash: [Double] = []
  public var lineDashOffset = 0.0
  public var font = "10px sans-serif"
  public var textAlign = "start"
  public var filter = "none"
}

/// The subset of `CanvasRenderingContext2D` Excalidraw draws with, with the
/// same state rules, so the renderer can be written as the web one is. What a
/// call paints is left to subclasses.
open class Canvas2D {
  public private(set) var state = Canvas2DState()
  public private(set) var path: [PathElement] = []
  private var stack: [Canvas2DState] = []
  private var subpathStart: Point2D?

  public init() {}

  open func save() { stack.append(state) }

  open func restore() {
    if let last = stack.popLast() { state = last }
  }

  open func translate(_ x: Double, _ y: Double) { state.transform = state.transform.translated(x, y) }
  open func scale(_ x: Double, _ y: Double) { state.transform = state.transform.scaled(x, y) }
  open func rotate(_ angle: Double) { state.transform = state.transform.rotated(angle) }
  open func setTransform(_ transform: Transform2D) { state.transform = transform }

  public var globalAlpha: Double {
    get { state.globalAlpha }
    set { if newValue >= 0 && newValue <= 1 { state.globalAlpha = newValue } }
  }

  public var fillStyle: String {
    get { state.fillStyle.serialized }
    set { if let color = CSSColor(newValue) { state.fillStyle = color } }
  }

  public var strokeStyle: String {
    get { state.strokeStyle.serialized }
    set { if let color = CSSColor(newValue) { state.strokeStyle = color } }
  }

  public var lineWidth: Double {
    get { state.lineWidth }
    set { if newValue.isFinite && newValue > 0 { state.lineWidth = newValue } }
  }

  public var lineCap: String {
    get { state.lineCap }
    set { if ["butt", "round", "square"].contains(newValue) { state.lineCap = newValue } }
  }

  public var lineJoin: String {
    get { state.lineJoin }
    set { if ["miter", "round", "bevel"].contains(newValue) { state.lineJoin = newValue } }
  }

  public var lineDashOffset: Double {
    get { state.lineDashOffset }
    set { if newValue.isFinite { state.lineDashOffset = newValue } }
  }

  public var font: String {
    get { state.font }
    set { state.font = newValue }
  }

  public var textAlign: String {
    get { state.textAlign }
    set {
      if ["start", "end", "left", "right", "center"].contains(newValue) { state.textAlign = newValue }
    }
  }

  public var filter: String {
    get { state.filter }
    set { state.filter = newValue }
  }

  public func setLineDash(_ segments: [Double]) {
    guard segments.allSatisfy({ $0.isFinite && $0 >= 0 }) else { return }
    state.lineDash = segments.count % 2 == 1 ? segments + segments : segments
  }

  open func beginPath() {
    path = []
    subpathStart = nil
  }

  open func closePath() {
    guard !path.isEmpty else { return }
    path.append(.close)
  }

  open func moveTo(_ x: Double, _ y: Double) {
    let point = state.transform.apply(Point2D(x, y))
    path.append(.move(point))
    subpathStart = point
  }

  open func lineTo(_ x: Double, _ y: Double) {
    let point = state.transform.apply(Point2D(x, y))
    if subpathStart == nil {
      path.append(.move(point))
      subpathStart = point
    } else {
      path.append(.line(point))
    }
  }

  open func quadraticCurveTo(_ cx: Double, _ cy: Double, _ x: Double, _ y: Double) {
    ensureSubpath(cx, cy)
    path.append(.quad(state.transform.apply(Point2D(cx, cy)), state.transform.apply(Point2D(x, y))))
  }

  open func bezierCurveTo(
    _ c1x: Double, _ c1y: Double, _ c2x: Double, _ c2y: Double, _ x: Double, _ y: Double
  ) {
    ensureSubpath(c1x, c1y)
    let t = state.transform
    path.append(.cubic(t.apply(Point2D(c1x, c1y)), t.apply(Point2D(c2x, c2y)), t.apply(Point2D(x, y))))
  }

  open func rect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {
    moveTo(x, y)
    lineTo(x + width, y)
    lineTo(x + width, y + height)
    lineTo(x, y + height)
    closePath()
    moveTo(x, y)
  }

  /// `roundRect` with one radius, drawn clockwise from the top edge.
  open func roundRect(
    _ x: Double, _ y: Double, _ width: Double, _ height: Double, _ radius: Double
  ) {
    let r = max(0, min(radius, abs(width) / 2, abs(height) / 2))
    let k = 0.5522847498 * r
    moveTo(x + r, y)
    lineTo(x + width - r, y)
    bezierCurveTo(x + width - r + k, y, x + width, y + r - k, x + width, y + r)
    lineTo(x + width, y + height - r)
    bezierCurveTo(
      x + width, y + height - r + k, x + width - r + k, y + height, x + width - r, y + height)
    lineTo(x + r, y + height)
    bezierCurveTo(x + r - k, y + height, x, y + height - r + k, x, y + height - r)
    lineTo(x, y + r)
    bezierCurveTo(x, y + r - k, x + r - k, y, x + r, y)
    closePath()
    moveTo(x, y)
  }

  private func ensureSubpath(_ x: Double, _ y: Double) {
    if subpathStart == nil { moveTo(x, y) }
  }

  open func stroke() {}
  open func fill(_ rule: FillRule = .nonzero) {}
  /// `fill(new Path2D(d))`: the SVG path in the current transform.
  open func fill(svgPath d: String, _ rule: FillRule = .nonzero) {}
  open func clip(_ rule: FillRule = .nonzero) {}
  open func fillRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {}
  open func clearRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {}
  open func fillText(_ text: String, _ x: Double, _ y: Double) {}

  /// A canvas of its own, as `document.createElement("canvas")` makes.
  open func makeLayer(width: Int, height: Int) -> Canvas2D { Canvas2D() }

  /// `drawImage(layer, x, y, width, height)`.
  open func drawLayer(
    _ layer: Canvas2D, size: (width: Int, height: Int), _ x: Double, _ y: Double, _ width: Double,
    _ height: Double
  ) {}

  /// The four corners of a user-space rectangle in device space.
  public func quad(_ x: Double, _ y: Double, _ width: Double, _ height: Double) -> [Point2D] {
    let t = state.transform
    return [
      t.apply(Point2D(x, y)), t.apply(Point2D(x + width, y)),
      t.apply(Point2D(x + width, y + height)), t.apply(Point2D(x, y + height)),
    ]
  }

  /// An SVG path's elements in device space under the current transform.
  public func devicePath(svg d: String) -> [PathElement] {
    let t = state.transform
    var elements: [PathElement] = []
    for segment in normalizePath(absolutizePath(parsePath(d))) {
      let data = segment.data
      switch segment.key {
      case "M": elements.append(.move(t.apply(Point2D(data[0], data[1]))))
      case "L": elements.append(.line(t.apply(Point2D(data[0], data[1]))))
      case "C":
        elements.append(
          .cubic(
            t.apply(Point2D(data[0], data[1])), t.apply(Point2D(data[2], data[3])),
            t.apply(Point2D(data[4], data[5]))))
      case "Z": elements.append(.close)
      default: break
      }
    }
    return elements
  }
}
