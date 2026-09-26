import Foundation

public struct Bounds: Equatable, Sendable {
  public var minX: Double
  public var minY: Double
  public var maxX: Double
  public var maxY: Double

  public init(minX: Double, minY: Double, maxX: Double, maxY: Double) {
    (self.minX, self.minY, self.maxX, self.maxY) = (minX, minY, maxX, maxY)
  }
}

struct AbsoluteCoords {
  var x1: Double
  var y1: Double
  var x2: Double
  var y2: Double
  var cx: Double
  var cy: Double
}

/// The element geometry the web renderer uses, with its two caches: which
/// shapes have been generated, and the bounds worked out so far. Linear
/// elements measure differently before and after their shape is generated,
/// and bounds are kept from the first time they are asked for, so where a
/// label or a canvas edge lands depends on the order things are asked in;
/// this keeps that order.
final class SceneGeometry {
  let elements: [String: DrawingElement]
  let canvasBackgroundColor: String
  private var generated: Set<String> = []
  private var shapes: [String: [Drawable]?] = [:]
  private var boundsCache: [String: Bounds] = [:]
  private let kept: ShapeCache?

  init(elements: [String: DrawingElement], canvasBackgroundColor: String, kept: ShapeCache? = nil) {
    self.elements = elements
    self.canvasBackgroundColor = canvasBackgroundColor
    self.kept = kept
  }

  /// `ShapeCache.generateElementShape`.
  @discardableResult
  func generateShape(_ element: DrawingElement) -> [Drawable]? {
    generated.insert(element.id)
    return shape(element)
  }

  /// `ShapeCache.get`, for a shape that has been generated.
  func cachedShape(_ element: DrawingElement) -> [Drawable]? {
    generated.contains(element.id) ? shape(element) : nil
  }

  private func shape(_ element: DrawingElement) -> [Drawable]? {
    if let shape = shapes[element.id] { return shape }
    let make = { generateElementShape(element, canvasBackgroundColor: self.canvasBackgroundColor) }
    let shape = kept.map { $0.shape(element, background: canvasBackgroundColor, make) } ?? make()
    shapes[element.id] = shape
    return shape
  }

  /// A freedraw stroke's outline, as SVG path data.
  func outline(_ element: DrawingElement) -> String {
    kept.map { $0.outline(element, background: canvasBackgroundColor) { freedrawSVGPath(element) } }
      ?? freedrawSVGPath(element)
  }

  func boundText(of element: DrawingElement) -> DrawingElement? {
    element.boundTextId.flatMap { elements[$0] }
  }

  func container(of element: DrawingElement) -> DrawingElement? {
    element.containerId.flatMap { elements[$0] }
  }

  func containingFrame(of element: DrawingElement) -> DrawingElement? {
    element.frameId.flatMap { elements[$0] }
  }

  // MARK: Coordinates

  func absoluteCoords(_ element: DrawingElement) -> AbsoluteCoords {
    if element.type == "freedraw" {
      let b = pointBounds(element.points)
      let x1 = b.minX + element.x
      let y1 = b.minY + element.y
      let x2 = b.maxX + element.x
      let y2 = b.maxY + element.y
      return AbsoluteCoords(x1: x1, y1: y1, x2: x2, y2: y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2)
    }
    if element.isLinear { return linearAbsoluteCoords(element) }
    if element.type == "text", let container = container(of: element), container.type == "arrow" {
      let p = boundTextPosition(container, element)
      return AbsoluteCoords(
        x1: p.x, y1: p.y, x2: p.x + element.width, y2: p.y + element.height,
        cx: p.x + element.width / 2, cy: p.y + element.height / 2)
    }
    return AbsoluteCoords(
      x1: element.x, y1: element.y, x2: element.x + element.width, y2: element.y + element.height,
      cx: element.x + element.width / 2, cy: element.y + element.height / 2)
  }

  private func linearAbsoluteCoords(_ element: DrawingElement) -> AbsoluteCoords {
    let b: Bounds
    if element.points.count < 2 || !generated.contains(element.id) {
      b = pointBounds(element.points)
    } else {
      b = curveBounds(curvePathOps(generateShape(element)?.first), transform: nil)
    }
    let x1 = b.minX + element.x
    let y1 = b.minY + element.y
    let x2 = b.maxX + element.x
    let y2 = b.maxY + element.y
    return AbsoluteCoords(x1: x1, y1: y1, x2: x2, y2: y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2)
  }

  private func pointBounds(_ points: [Point2D]) -> Bounds {
    var b = Bounds(minX: .infinity, minY: .infinity, maxX: -.infinity, maxY: -.infinity)
    for p in points {
      b.minX = min(b.minX, p.x)
      b.minY = min(b.minY, p.y)
      b.maxX = max(b.maxX, p.x)
      b.maxY = max(b.maxY, p.y)
    }
    return b
  }

  /// `getMinMaxXYFromCurvePathOps`.
  private func curveBounds(_ ops: [RoughOp], transform: ((Point2D) -> Point2D)?) -> Bounds {
    var current = Point2D(0, 0)
    var b = Bounds(minX: .infinity, minY: .infinity, maxX: -.infinity, maxY: -.infinity)
    for op in ops {
      let d = op.data
      if op.kind == .move {
        current = Point2D(d[0], d[1])
      } else if op.kind == .bcurveTo {
        let raw3 = Point2D(d[4], d[5])
        let p1 = transform?(Point2D(d[0], d[1])) ?? Point2D(d[0], d[1])
        let p2 = transform?(Point2D(d[2], d[3])) ?? Point2D(d[2], d[3])
        let p3 = transform?(raw3) ?? raw3
        let p0 = transform?(current) ?? current
        current = raw3
        let curve = cubicBounds(p0, p1, p2, p3)
        b.minX = min(b.minX, curve.minX)
        b.minY = min(b.minY, curve.minY)
        b.maxX = max(b.maxX, curve.maxX)
        b.maxY = max(b.maxY, curve.maxY)
      }
    }
    return b
  }

  private func cubicBounds(_ p0: Point2D, _ p1: Point2D, _ p2: Point2D, _ p3: Point2D) -> Bounds {
    func value(_ t: Double, _ a: Double, _ b: Double, _ c: Double, _ d: Double) -> Double {
      let u = 1 - t
      return pow(u, 3) * a + 3 * pow(u, 2) * t * b + 3 * u * pow(t, 2) * c + pow(t, 3) * d
    }
    func solve(_ a0: Double, _ a1: Double, _ a2: Double, _ a3: Double) -> [Double]? {
      let i = a1 - a0
      let j = a2 - a1
      let k = a3 - a2
      let a = 3 * i - 6 * j + 3 * k
      let b = 6 * j - 6 * i
      let c = 3 * i
      let sqrtPart = b * b - 4 * a * c
      guard sqrtPart >= 0 else { return nil }
      let t1: Double
      let t2: Double
      if a == 0 {
        t1 = -c / b
        t2 = t1
      } else {
        t1 = (-b + sqrtPart.squareRoot()) / (2 * a)
        t2 = (-b - sqrtPart.squareRoot()) / (2 * a)
      }
      var solutions: [Double] = []
      if t1 >= 0 && t1 <= 1 { solutions.append(value(t1, a0, a1, a2, a3)) }
      if t2 >= 0 && t2 <= 1 { solutions.append(value(t2, a0, a1, a2, a3)) }
      return solutions
    }
    var minX = min(p0.x, p3.x)
    var maxX = max(p0.x, p3.x)
    if let xs = solve(p0.x, p1.x, p2.x, p3.x) {
      minX = ([minX] + xs).min()!
      maxX = ([maxX] + xs).max()!
    }
    var minY = min(p0.y, p3.y)
    var maxY = max(p0.y, p3.y)
    if let ys = solve(p0.y, p1.y, p2.y, p3.y) {
      minY = ([minY] + ys).min()!
      maxY = ([maxY] + ys).max()!
    }
    return Bounds(minX: minX, minY: minY, maxX: maxX, maxY: maxY)
  }

  // MARK: Linear elements

  private func globalPoint(_ element: DrawingElement, _ p: Point2D) -> Point2D {
    let c = absoluteCoords(element)
    return Point2D(element.x + p.x, element.y + p.y).rotated(
      around: Point2D((c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2), by: element.angle)
  }

  /// `LinearElementEditor.getBoundTextElementPosition`: the top left of a label.
  func boundTextPosition(_ element: DrawingElement, _ text: DrawingElement) -> Point2D {
    let c = absoluteCoords(element)
    let center = Point2D((c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2)
    let points = element.points.map {
      Point2D(element.x + $0.x, element.y + $0.y).rotated(around: center, by: element.angle)
    }
    let mid: Point2D
    if element.points.count % 2 == 1 {
      mid = globalPoint(element, element.points[element.points.count / 2])
    } else {
      let index = element.points.count / 2 - 1
      mid = segmentMidPoint(element, points[index], points[index + 1], index + 1)
    }
    return Point2D(mid.x - text.width / 2, mid.y - text.height / 2)
  }

  private func segmentMidPoint(
    _ element: DrawingElement, _ start: Point2D, _ end: Point2D, _ endIndex: Int
  ) -> Point2D {
    var mid = Point2D((start.x + end.x) / 2, (start.y + end.y) / 2)
    if element.points.count > 2 && element.roundness != nil,
      let control = bezierControlPoints(element, element.points[endIndex])
    {
      let t = bezierT(element, element.points[endIndex], control, interval: 0.5)
      mid = globalPoint(element, bezierPoint(control, t))
    }
    return mid
  }

  private func bezierControlPoints(_ element: DrawingElement, _ endPoint: Point2D) -> [Point2D]? {
    guard let shape = generateShape(element) else { return nil }
    var current = Point2D(0, 0)
    var minDistance = Double.infinity
    var control: [Point2D]?
    for op in curvePathOps(shape.first) {
      let d = op.data
      if op.kind == .move { current = Point2D(d[0], d[1]) }
      if op.kind == .bcurveTo {
        let p3 = Point2D(d[4], d[5])
        let distance = p3.distance(to: endPoint)
        if distance < minDistance {
          minDistance = distance
          control = [current, Point2D(d[0], d[1]), Point2D(d[2], d[3]), p3]
        }
        current = p3
      }
    }
    return control
  }

  private func bezierPoint(_ c: [Point2D], _ t: Double) -> Point2D {
    func equation(_ a: Double, _ b: Double, _ cc: Double, _ d: Double) -> Double {
      pow(1 - t, 3) * d + 3 * t * pow(1 - t, 2) * cc + 3 * pow(t, 2) * (1 - t) * b + a * pow(t, 3)
    }
    return Point2D(
      equation(c[0].x, c[1].x, c[2].x, c[3].x), equation(c[0].y, c[1].y, c[2].y, c[3].y))
  }

  /// `mapIntervalToBezierT`, sampling the curve as the web does.
  private func bezierT(
    _ element: DrawingElement, _ endPoint: Point2D, _ control: [Point2D], interval: Double
  ) -> Double {
    var samples: [Point2D] = []
    var t = 1.0
    while t > 0 {
      samples.append(bezierPoint(control, t))
      t -= 0.05
    }
    if let last = samples.last, abs(last.x - endPoint.x) < 10e-5, abs(last.y - endPoint.y) < 10e-5 {
      samples.append(endPoint)
    }
    var arcLengths = [0.0]
    var total = 0.0
    for i in 0..<max(samples.count - 1, 0) {
      total += samples[i].distance(to: samples[i + 1])
      arcLengths.append(total)
    }
    let count = arcLengths.count - 1
    let target = interval * total
    var low = 0
    var high = count
    var index = 0
    while low < high {
      index = low + (high - low) / 2
      if arcLengths[index] < target {
        low = index + 1
      } else {
        high = index
      }
    }
    if arcLengths[index] > target { index -= 1 }
    guard index >= 0 else { return .nan }
    if arcLengths[index] == target { return Double(index) / Double(count) }
    return 1
      - (Double(index) + (target - arcLengths[index]) / (arcLengths[index + 1] - arcLengths[index]))
      / Double(count)
  }

  // MARK: Bounds

  /// `getElementBounds`, kept from the first time it is asked for.
  func bounds(_ element: DrawingElement) -> Bounds {
    let boundToContainer = element.type == "text" && element.containerId != nil
    if !boundToContainer, let cached = boundsCache[element.id] { return cached }
    let bounds = calculateBounds(element)
    boundsCache[element.id] = bounds
    return bounds
  }

  private func calculateBounds(_ element: DrawingElement) -> Bounds {
    let c = absoluteCoords(element)
    let center = Point2D(c.cx, c.cy)
    let angle = element.angle
    if element.type == "freedraw" {
      let rotated = element.points.map {
        $0.rotated(around: Point2D(c.cx - element.x, c.cy - element.y), by: angle)
      }
      let b = pointBounds(rotated)
      return Bounds(
        minX: b.minX + element.x, minY: b.minY + element.y, maxX: b.maxX + element.x,
        maxY: b.maxY + element.y)
    }
    if element.isLinear { return linearRotatedBounds(element, c) }
    if element.type == "ellipse" {
      let w = (c.x2 - c.x1) / 2
      let h = (c.y2 - c.y1) / 2
      let ww = hypot(w * cos(angle), h * sin(angle))
      let hh = hypot(h * cos(angle), w * sin(angle))
      return Bounds(minX: c.cx - ww, minY: c.cy - hh, maxX: c.cx + ww, maxY: c.cy + hh)
    }
    let corners: [Point2D] =
      element.type == "diamond"
      ? [
        Point2D(c.cx, c.y1), Point2D(c.cx, c.y2), Point2D(c.x1, c.cy), Point2D(c.x2, c.cy),
      ]
      : [
        Point2D(c.x1, c.y1), Point2D(c.x1, c.y2), Point2D(c.x2, c.y2), Point2D(c.x2, c.y1),
      ]
    let rotated = corners.map { $0.rotated(around: center, by: angle) }
    return Bounds(
      minX: rotated.map(\.x).min()!, minY: rotated.map(\.y).min()!,
      maxX: rotated.map(\.x).max()!, maxY: rotated.map(\.y).max()!)
  }

  private func linearRotatedBounds(_ element: DrawingElement, _ c: AbsoluteCoords) -> Bounds {
    let center = Point2D(c.cx, c.cy)
    var bounds: Bounds
    if element.points.count < 2 {
      let p = Point2D(element.x + element.points[0].x, element.y + element.points[0].y)
        .rotated(around: center, by: element.angle)
      bounds = Bounds(minX: p.x, minY: p.y, maxX: p.x, maxY: p.y)
    } else {
      let shape = cachedShape(element)?.first ?? plainLinearShape(element)
      bounds = curveBounds(curvePathOps(shape)) {
        Point2D(element.x + $0.x, element.y + $0.y).rotated(around: center, by: element.angle)
      }
    }
    if let text = boundText(of: element) {
      bounds = boundsWithBoundText(element, bounds, text)
    }
    return bounds
  }

  /// `generateLinearElementShape`: what bounds are measured on before the
  /// element's own shape exists.
  private func plainLinearShape(_ element: DrawingElement) -> Drawable {
    let options = generateRoughOptions(element)
    if element.roundness != nil { return RoughGenerator.curve(element.points, options) }
    if options.fill != nil { return RoughGenerator.polygon(element.points, options) }
    return RoughGenerator.linearPath(element.points, options)
  }

  /// `LinearElementEditor.getMinMaxXYWithBoundText`.
  private func boundsWithBoundText(_ element: DrawingElement, _ b: Bounds, _ text: DrawingElement)
    -> Bounds
  {
    var (x1, y1, x2, y2) = (b.minX, b.minY, b.maxX, b.maxY)
    let center = Point2D((x1 + x2) / 2, (y1 + y2) / 2)
    let p = boundTextPosition(element, text)
    let tx2 = p.x + text.width
    let ty2 = p.y + text.height
    let angle = element.angle
    let topLeft = Point2D(x1, y1).rotated(around: center, by: angle)
    let topRight = Point2D(x2, y1).rotated(around: center, by: angle)
    let textTopLeft = Point2D(p.x, p.y).rotated(around: center, by: -angle)
    let textTopRight = Point2D(tx2, p.y).rotated(around: center, by: -angle)
    let textBottomLeft = Point2D(p.x, ty2).rotated(around: center, by: -angle)
    let textBottomRight = Point2D(tx2, ty2).rotated(around: center, by: -angle)
    if topLeft.x < topRight.x && topLeft.y >= topRight.y {
      x1 = min(x1, textBottomLeft.x)
      x2 = max(x2, max(textTopRight.x, textBottomRight.x))
      y1 = min(y1, textTopLeft.y)
      y2 = max(y2, textBottomRight.y)
    } else if topLeft.x >= topRight.x && topLeft.y > topRight.y {
      x1 = min(x1, textBottomRight.x)
      x2 = max(x2, max(textTopLeft.x, textTopRight.x))
      y1 = min(y1, textBottomLeft.y)
      y2 = max(y2, textTopRight.y)
    } else if topLeft.x >= topRight.x {
      x1 = min(x1, textTopRight.x)
      x2 = max(x2, textBottomLeft.x)
      y1 = min(y1, textBottomRight.y)
      y2 = max(y2, textTopLeft.y)
    } else if topLeft.y <= topRight.y {
      x1 = min(x1, min(textTopRight.x, textTopLeft.x))
      x2 = max(x2, textBottomRight.x)
      y1 = min(y1, textTopRight.y)
      y2 = max(y2, textBottomLeft.y)
    }
    return Bounds(minX: x1, minY: y1, maxX: x2, maxY: y2)
  }

  func commonBounds(_ elements: [DrawingElement]) -> Bounds {
    guard !elements.isEmpty else { return Bounds(minX: 0, minY: 0, maxX: 0, maxY: 0) }
    var b = Bounds(minX: .infinity, minY: .infinity, maxX: -.infinity, maxY: -.infinity)
    for element in elements {
      let e = bounds(element)
      b.minX = min(b.minX, e.minX)
      b.minY = min(b.minY, e.minY)
      b.maxX = max(b.maxX, e.maxX)
      b.maxY = max(b.maxY, e.maxY)
    }
    return b
  }

  // MARK: Frames

  private func lineSegments(_ element: DrawingElement) -> [(Point2D, Point2D)] {
    let c = absoluteCoords(element)
    let center = Point2D(c.cx, c.cy)
    if element.isLinear || element.type == "freedraw" {
      var segments: [(Point2D, Point2D)] = []
      var i = 0
      while i < element.points.count - 1 {
        let a = Point2D(element.points[i].x + element.x, element.points[i].y + element.y)
        let b = Point2D(element.points[i + 1].x + element.x, element.points[i + 1].y + element.y)
        segments.append(
          (a.rotated(around: center, by: element.angle), b.rotated(around: center, by: element.angle)))
        i += 1
      }
      return segments
    }
    let points = [
      Point2D(c.x1, c.y1), Point2D(c.x2, c.y1), Point2D(c.x1, c.y2), Point2D(c.x2, c.y2),
      Point2D(c.cx, c.y1), Point2D(c.cx, c.y2), Point2D(c.x1, c.cy), Point2D(c.x2, c.cy),
    ].map { $0.rotated(around: center, by: element.angle) }
    let (nw, ne, sw, se, north, south, west, east) =
      (points[0], points[1], points[2], points[3], points[4], points[5], points[6], points[7])
    if element.type == "diamond" || element.type == "ellipse" {
      return [(north, west), (north, east), (south, west), (south, east)]
    }
    return [(nw, ne), (sw, se), (nw, sw), (ne, se), (nw, east), (sw, east), (ne, west), (se, west)]
  }

  private func segmentsIntersect(_ a: (Point2D, Point2D), _ b: (Point2D, Point2D)) -> Bool {
    func box(_ l: (Point2D, Point2D)) -> [Double] {
      [min(l.0.x, l.1.x), min(l.0.y, l.1.y), max(l.0.x, l.1.x), max(l.0.y, l.1.y)]
    }
    func cross(_ l: (Point2D, Point2D), _ p: Point2D) -> Double {
      let v1 = Point2D(l.1.x - l.0.x, l.1.y - l.0.y)
      let v2 = Point2D(p.x - l.0.x, p.y - l.0.y)
      return v1.x * v2.y - v2.x * v1.y
    }
    func onLine(_ l: (Point2D, Point2D), _ p: Point2D) -> Bool { abs(cross(l, p)) < 1e-6 }
    func rightOf(_ l: (Point2D, Point2D), _ p: Point2D) -> Bool { cross(l, p) < 0 }
    func touchesOrCrosses(_ a: (Point2D, Point2D), _ b: (Point2D, Point2D)) -> Bool {
      onLine(a, b.0) || onLine(a, b.1)
        || (rightOf(a, b.0) ? !rightOf(a, b.1) : rightOf(a, b.1))
    }
    let ba = box(a)
    let bb = box(b)
    let boxes = ba[0] <= bb[2] && ba[2] >= bb[0] && ba[1] <= bb[3] && ba[3] >= bb[1]
    return boxes && touchesOrCrosses(a, b) && touchesOrCrosses(b, a)
  }

  private func isIntersectingFrame(_ element: DrawingElement, _ frame: DrawingElement) -> Bool {
    let frameSegments = lineSegments(frame)
    let elementSegments = lineSegments(element)
    return frameSegments.contains { f in elementSegments.contains { segmentsIntersect(f, $0) } }
  }

  private func isContainingFrame(_ element: DrawingElement, _ frame: DrawingElement) -> Bool {
    let selection = absoluteCoords(element)
    let b = bounds(frame)
    return !frame.locked && selection.x1 <= b.minX && selection.y1 <= b.minY
      && selection.x2 >= b.maxX && selection.y2 >= b.maxY
  }

  private func isInFrameBounds(_ element: DrawingElement, _ frame: DrawingElement) -> Bool {
    let f = absoluteCoords(frame)
    let e = commonBounds([element])
    return f.x1 <= e.minX && f.y1 <= e.minY && f.x2 >= e.maxX && f.y2 >= e.maxY
  }

  /// `shouldApplyFrameClip`, for a scene nothing is being dragged in.
  func shouldApplyFrameClip(
    _ element: DrawingElement, _ frame: DrawingElement, _ checkedGroups: inout [String: Bool]
  ) -> Bool {
    if isIntersectingFrame(element, frame) || isContainingFrame(element, frame) {
      for group in element.groupIds { checkedGroups[group] = true }
      return true
    }
    if !element.groupIds.isEmpty && !isInFrameBounds(element, frame) {
      let shouldClip = element.frameId == frame.id
      for group in element.groupIds { checkedGroups[group] = shouldClip }
      return shouldClip
    }
    return false
  }

  /// `getTargetFrame`: a label is clipped by its container's frame.
  func targetFrame(_ element: DrawingElement) -> DrawingElement? {
    let subject = element.type == "text" ? (container(of: element) ?? element) : element
    return containingFrame(of: subject)
  }
}
