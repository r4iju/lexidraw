import Foundation

// A port of rough.js 4.6.4, the version Excalidraw 0.18 draws with. The wobble
// is a function of the element's seed, so every call below consumes random
// numbers in the order rough.js does; reordering two lines changes the drawing.

/// rough.js's `Random`: a Park–Miller generator over 32-bit integers, as
/// `Math.imul` computes them.
public final class RoughRandom {
  private var seed: Int32

  init(seed: Double) {
    self.seed = jsToInt32(seed)
  }

  func next() -> Double {
    guard seed != 0 else { return Double.random(in: 0..<1) }
    seed = 48271 &* seed
    return Double(seed & 0x7fff_ffff) / 2_147_483_648
  }
}

/// ECMAScript's ToInt32, which `Math.imul` applies to its operands.
func jsToInt32(_ value: Double) -> Int32 {
  guard value.isFinite else { return 0 }
  let truncated = value.rounded(.towardZero)
  let modulo = truncated.truncatingRemainder(dividingBy: 4_294_967_296)
  return Int32(truncatingIfNeeded: Int64(modulo))
}

/// JavaScript's `Math.round`, which rounds halves up rather than away from zero.
func jsRound(_ value: Double) -> Double {
  let floor = value.rounded(.down)
  return value - floor >= 0.5 ? floor + 1 : floor
}

public struct RoughOptions {
  public var maxRandomnessOffset = 2.0
  public var roughness = 1.0
  public var bowing = 1.0
  public var stroke = "#000"
  public var strokeWidth = 1.0
  public var curveTightness = 0.0
  public var curveFitting = 0.95
  public var curveStepCount = 9.0
  public var fillStyle = "hachure"
  public var fillWeight = -1.0
  public var hachureAngle = -41.0
  public var hachureGap = -1.0
  public var seed = 0.0
  public var disableMultiStroke = false
  public var disableMultiStrokeFill = false
  public var preserveVertices = false
  public var fillShapeRoughnessGain = 0.8
  public var fill: String?
  public var strokeLineDash: [Double]?
  public var fillLineDash: [Double]?
  /// Shared by copies, as `Object.assign` shares it in rough.js: a fill made
  /// from a copy of the outline's options continues the outline's sequence.
  var randomizer: RoughRandom?

  public init() {}
}

public enum RoughOpKind: Sendable { case move, bcurveTo, lineTo }

public struct RoughOp: Sendable {
  public var kind: RoughOpKind
  public var data: [Double]
}

public enum RoughOpSetKind: Sendable { case path, fillPath, fillSketch }

public struct RoughOpSet: Sendable {
  public var kind: RoughOpSetKind
  public var ops: [RoughOp]
}

public struct Drawable {
  public var shape: String
  public var sets: [RoughOpSet]
  public var options: RoughOptions
}

// MARK: - Randomness

private func random(_ o: inout RoughOptions) -> Double {
  if o.randomizer == nil { o.randomizer = RoughRandom(seed: o.seed) }
  return o.randomizer!.next()
}

private func offset(
  _ min: Double, _ max: Double, _ o: inout RoughOptions, _ gain: Double = 1
) -> Double {
  o.roughness * gain * ((random(&o) * (max - min)) + min)
}

private func offsetOpt(_ x: Double, _ o: inout RoughOptions, _ gain: Double = 1) -> Double {
  offset(-x, x, &o, gain)
}

// MARK: - Renderer

func roughLine(
  _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ o: inout RoughOptions
) -> RoughOpSet {
  RoughOpSet(kind: .path, ops: doubleLine(x1, y1, x2, y2, &o))
}

func roughLinearPath(_ points: [Point2D], close: Bool, _ o: inout RoughOptions) -> RoughOpSet {
  let count = points.count
  if count > 2 {
    var ops: [RoughOp] = []
    for i in 0..<(count - 1) {
      ops += doubleLine(points[i].x, points[i].y, points[i + 1].x, points[i + 1].y, &o)
    }
    if close {
      ops += doubleLine(
        points[count - 1].x, points[count - 1].y, points[0].x, points[0].y, &o)
    }
    return RoughOpSet(kind: .path, ops: ops)
  } else if count == 2 {
    return roughLine(points[0].x, points[0].y, points[1].x, points[1].y, &o)
  }
  return RoughOpSet(kind: .path, ops: [])
}

func roughRectangle(
  _ x: Double, _ y: Double, _ width: Double, _ height: Double, _ o: inout RoughOptions
) -> RoughOpSet {
  roughLinearPath(
    [
      Point2D(x, y), Point2D(x + width, y), Point2D(x + width, y + height),
      Point2D(x, y + height),
    ], close: true, &o)
}

func roughCurve(_ points: [Point2D], _ o: inout RoughOptions) -> RoughOpSet {
  var ops = curveWithOffset(points, 1 * (1 + o.roughness * 0.2), &o)
  if !o.disableMultiStroke {
    var altered = cloneOptionsAlterSeed(o)
    ops += curveWithOffset(points, 1.5 * (1 + o.roughness * 0.22), &altered)
  }
  return RoughOpSet(kind: .path, ops: ops)
}

struct EllipseParams {
  var increment: Double
  var rx: Double
  var ry: Double
}

func generateEllipseParams(_ width: Double, _ height: Double, _ o: inout RoughOptions)
  -> EllipseParams
{
  let psq = (Double.pi * 2 * ((pow(width / 2, 2) + pow(height / 2, 2)) / 2).squareRoot())
    .squareRoot()
  let stepCount = max(o.curveStepCount, (o.curveStepCount / 200.0.squareRoot()) * psq)
    .rounded(.up)
  let increment = (Double.pi * 2) / stepCount
  var rx = abs(width / 2)
  var ry = abs(height / 2)
  let curveFitRandomness = 1 - o.curveFitting
  rx += offsetOpt(rx * curveFitRandomness, &o)
  ry += offsetOpt(ry * curveFitRandomness, &o)
  return EllipseParams(increment: increment, rx: rx, ry: ry)
}

func ellipseWithParams(
  _ x: Double, _ y: Double, _ o: inout RoughOptions, _ params: EllipseParams
) -> (estimatedPoints: [Point2D], opset: RoughOpSet) {
  let inner = offset(0.4, 1, &o)
  let overlap = params.increment * offset(0.1, inner, &o)
  let (ap1, cp1) = computeEllipsePoints(
    params.increment, x, y, params.rx, params.ry, 1, overlap, &o)
  var ops = curve(ap1, closePoint: nil, &o)
  if !o.disableMultiStroke && o.roughness != 0 {
    let (ap2, _) = computeEllipsePoints(params.increment, x, y, params.rx, params.ry, 1.5, 0, &o)
    ops += curve(ap2, closePoint: nil, &o)
  }
  return (cp1, RoughOpSet(kind: .path, ops: ops))
}

func svgPath(_ path: String, _ o: inout RoughOptions) -> RoughOpSet {
  let segments = normalizePath(absolutizePath(parsePath(path)))
  var ops: [RoughOp] = []
  var first = Point2D(0, 0)
  var current = Point2D(0, 0)
  for segment in segments {
    let data = segment.data
    switch segment.key {
    case "M":
      current = Point2D(data[0], data[1])
      first = current
    case "L":
      ops += doubleLine(current.x, current.y, data[0], data[1], &o)
      current = Point2D(data[0], data[1])
    case "C":
      ops += bezierTo(data[0], data[1], data[2], data[3], data[4], data[5], current, &o)
      current = Point2D(data[4], data[5])
    case "Z":
      ops += doubleLine(current.x, current.y, first.x, first.y, &o)
      current = first
    default: break
    }
  }
  return RoughOpSet(kind: .path, ops: ops)
}

func solidFillPolygon(_ polygons: [[Point2D]], _ o: inout RoughOptions) -> RoughOpSet {
  var ops: [RoughOp] = []
  for points in polygons where !points.isEmpty {
    let maxOffset = o.maxRandomnessOffset
    if points.count > 2 {
      let x0 = points[0].x + offsetOpt(maxOffset, &o)
      let y0 = points[0].y + offsetOpt(maxOffset, &o)
      ops.append(RoughOp(kind: .move, data: [x0, y0]))
      for point in points.dropFirst() {
        let x = point.x + offsetOpt(maxOffset, &o)
        let y = point.y + offsetOpt(maxOffset, &o)
        ops.append(RoughOp(kind: .lineTo, data: [x, y]))
      }
    }
  }
  return RoughOpSet(kind: .fillPath, ops: ops)
}

func doubleLineFillOps(
  _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ o: inout RoughOptions
) -> [RoughOp] {
  doubleLine(x1, y1, x2, y2, &o, filling: true)
}

private func cloneOptionsAlterSeed(_ o: RoughOptions) -> RoughOptions {
  var result = o
  result.randomizer = nil
  if o.seed != 0 { result.seed = o.seed + 1 }
  return result
}

private func doubleLine(
  _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ o: inout RoughOptions,
  filling: Bool = false
) -> [RoughOp] {
  let singleStroke = filling ? o.disableMultiStrokeFill : o.disableMultiStroke
  let o1 = line(x1, y1, x2, y2, &o, move: true, overlay: false)
  if singleStroke { return o1 }
  return o1 + line(x1, y1, x2, y2, &o, move: true, overlay: true)
}

private func line(
  _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ o: inout RoughOptions,
  move: Bool, overlay: Bool
) -> [RoughOp] {
  let lengthSq = pow(x1 - x2, 2) + pow(y1 - y2, 2)
  let length = lengthSq.squareRoot()
  let gain: Double
  if length < 200 {
    gain = 1
  } else if length > 500 {
    gain = 0.4
  } else {
    gain = -0.0016668 * length + 1.233334
  }
  var maxOffset = o.maxRandomnessOffset
  if maxOffset * maxOffset * 100 > lengthSq { maxOffset = length / 10 }
  let halfOffset = maxOffset / 2
  let divergePoint = 0.2 + random(&o) * 0.2
  var midDispX = o.bowing * o.maxRandomnessOffset * (y2 - y1) / 200
  var midDispY = o.bowing * o.maxRandomnessOffset * (x1 - x2) / 200
  midDispX = offsetOpt(midDispX, &o, gain)
  midDispY = offsetOpt(midDispY, &o, gain)
  let jitter = overlay ? halfOffset : maxOffset
  let preserve = o.preserveVertices
  var ops: [RoughOp] = []
  if move {
    let x = x1 + (preserve ? 0 : offsetOpt(jitter, &o, gain))
    let y = y1 + (preserve ? 0 : offsetOpt(jitter, &o, gain))
    ops.append(RoughOp(kind: .move, data: [x, y]))
  }
  let c1x = midDispX + x1 + (x2 - x1) * divergePoint + offsetOpt(jitter, &o, gain)
  let c1y = midDispY + y1 + (y2 - y1) * divergePoint + offsetOpt(jitter, &o, gain)
  let c2x = midDispX + x1 + 2 * (x2 - x1) * divergePoint + offsetOpt(jitter, &o, gain)
  let c2y = midDispY + y1 + 2 * (y2 - y1) * divergePoint + offsetOpt(jitter, &o, gain)
  let ex = x2 + (preserve ? 0 : offsetOpt(jitter, &o, gain))
  let ey = y2 + (preserve ? 0 : offsetOpt(jitter, &o, gain))
  ops.append(RoughOp(kind: .bcurveTo, data: [c1x, c1y, c2x, c2y, ex, ey]))
  return ops
}

private func curveWithOffset(_ points: [Point2D], _ amount: Double, _ o: inout RoughOptions)
  -> [RoughOp]
{
  var ps: [Point2D] = []
  func jittered(_ point: Point2D, _ o: inout RoughOptions) -> Point2D {
    let x = point.x + offsetOpt(amount, &o)
    let y = point.y + offsetOpt(amount, &o)
    return Point2D(x, y)
  }
  ps.append(jittered(points[0], &o))
  ps.append(jittered(points[0], &o))
  for i in 1..<max(points.count, 1) {
    ps.append(jittered(points[i], &o))
    if i == points.count - 1 { ps.append(jittered(points[i], &o)) }
  }
  return curve(ps, closePoint: nil, &o)
}

private func curve(_ points: [Point2D], closePoint: Point2D?, _ o: inout RoughOptions)
  -> [RoughOp]
{
  let count = points.count
  var ops: [RoughOp] = []
  if count > 3 {
    let s = 1 - o.curveTightness
    ops.append(RoughOp(kind: .move, data: [points[1].x, points[1].y]))
    var i = 1
    while i + 2 < count {
      let current = points[i]
      let b1x = current.x + (s * points[i + 1].x - s * points[i - 1].x) / 6
      let b1y = current.y + (s * points[i + 1].y - s * points[i - 1].y) / 6
      let b2x = points[i + 1].x + (s * points[i].x - s * points[i + 2].x) / 6
      let b2y = points[i + 1].y + (s * points[i].y - s * points[i + 2].y) / 6
      ops.append(
        RoughOp(kind: .bcurveTo, data: [b1x, b1y, b2x, b2y, points[i + 1].x, points[i + 1].y]))
      i += 1
    }
    if let closePoint {
      let ro = o.maxRandomnessOffset
      let x = closePoint.x + offsetOpt(ro, &o)
      let y = closePoint.y + offsetOpt(ro, &o)
      ops.append(RoughOp(kind: .lineTo, data: [x, y]))
    }
  } else if count == 3 {
    ops.append(RoughOp(kind: .move, data: [points[1].x, points[1].y]))
    ops.append(
      RoughOp(
        kind: .bcurveTo,
        data: [points[1].x, points[1].y, points[2].x, points[2].y, points[2].x, points[2].y]))
  } else if count == 2 {
    ops += doubleLine(points[0].x, points[0].y, points[1].x, points[1].y, &o)
  }
  return ops
}

private func computeEllipsePoints(
  _ increment: Double, _ cx: Double, _ cy: Double, _ rx: Double, _ ry: Double,
  _ amount: Double, _ overlap: Double, _ o: inout RoughOptions
) -> ([Point2D], [Point2D]) {
  var corePoints: [Point2D] = []
  var allPoints: [Point2D] = []
  if o.roughness == 0 {
    let step = increment / 4
    allPoints.append(Point2D(cx + rx * cos(-step), cy + ry * sin(-step)))
    var angle = 0.0
    while angle <= Double.pi * 2 {
      let point = Point2D(cx + rx * cos(angle), cy + ry * sin(angle))
      corePoints.append(point)
      allPoints.append(point)
      angle += step
    }
    allPoints.append(Point2D(cx + rx * cos(0), cy + ry * sin(0)))
    allPoints.append(Point2D(cx + rx * cos(step), cy + ry * sin(step)))
  } else {
    let radOffset = offsetOpt(0.5, &o) - Double.pi / 2
    func point(_ scale: Double, _ angle: Double, _ o: inout RoughOptions) -> Point2D {
      let x = offsetOpt(amount, &o) + cx + scale * rx * cos(angle)
      let y = offsetOpt(amount, &o) + cy + scale * ry * sin(angle)
      return Point2D(x, y)
    }
    allPoints.append(point(0.9, radOffset - increment, &o))
    let endAngle = Double.pi * 2 + radOffset - 0.01
    var angle = radOffset
    while angle < endAngle {
      let p = point(1, angle, &o)
      corePoints.append(p)
      allPoints.append(p)
      angle += increment
    }
    allPoints.append(point(1, radOffset + Double.pi * 2 + overlap * 0.5, &o))
    allPoints.append(point(0.98, radOffset + overlap, &o))
    allPoints.append(point(0.9, radOffset + overlap * 0.5, &o))
  }
  return (allPoints, corePoints)
}

private func bezierTo(
  _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ x: Double, _ y: Double,
  _ current: Point2D, _ o: inout RoughOptions
) -> [RoughOp] {
  var ops: [RoughOp] = []
  let base = o.maxRandomnessOffset != 0 ? o.maxRandomnessOffset : 1
  let ros = [base, base + 0.3]
  let iterations = o.disableMultiStroke ? 1 : 2
  let preserve = o.preserveVertices
  for i in 0..<iterations {
    if i == 0 {
      ops.append(RoughOp(kind: .move, data: [current.x, current.y]))
    } else {
      let mx = current.x + (preserve ? 0 : offsetOpt(ros[0], &o))
      let my = current.y + (preserve ? 0 : offsetOpt(ros[0], &o))
      ops.append(RoughOp(kind: .move, data: [mx, my]))
    }
    var fx = x
    var fy = y
    if !preserve {
      fx = x + offsetOpt(ros[i], &o)
      fy = y + offsetOpt(ros[i], &o)
    }
    let c1x = x1 + offsetOpt(ros[i], &o)
    let c1y = y1 + offsetOpt(ros[i], &o)
    let c2x = x2 + offsetOpt(ros[i], &o)
    let c2y = y2 + offsetOpt(ros[i], &o)
    ops.append(RoughOp(kind: .bcurveTo, data: [c1x, c1y, c2x, c2y, fx, fy]))
  }
  return ops
}

// MARK: - Fills

func patternFillPolygons(_ polygons: [[Point2D]], _ o: inout RoughOptions) -> RoughOpSet {
  var polygons = polygons
  switch o.fillStyle {
  case "zigzag": return zigzagFill(&polygons, &o)
  case "cross-hatch":
    var set = hachureFill(&polygons, &o)
    var rotated = o
    rotated.hachureAngle = o.hachureAngle + 90
    set.ops += hachureFill(&polygons, &rotated).ops
    return set
  default: return hachureFill(&polygons, &o)
  }
}

private func hachureFill(_ polygons: inout [[Point2D]], _ o: inout RoughOptions) -> RoughOpSet {
  let lines = polygonHachureLines(&polygons, o)
  return RoughOpSet(kind: .fillSketch, ops: renderLines(lines, &o))
}

private func renderLines(_ lines: [(Point2D, Point2D)], _ o: inout RoughOptions)
  -> [RoughOp]
{
  var ops: [RoughOp] = []
  for (start, end) in lines {
    ops += doubleLineFillOps(start.x, start.y, end.x, end.y, &o)
  }
  return ops
}

private func zigzagFill(_ polygons: inout [[Point2D]], _ o: inout RoughOptions)
  -> RoughOpSet
{
  var gap = o.hachureGap
  if gap < 0 { gap = o.strokeWidth * 4 }
  gap = max(gap, 0.1)
  var gapped = o
  gapped.hachureGap = gap
  let lines = polygonHachureLines(&polygons, gapped)
  let angle = (Double.pi / 180) * o.hachureAngle
  var zigzag: [(Point2D, Point2D)] = []
  let dgx = gap * 0.5 * cos(angle)
  let dgy = gap * 0.5 * sin(angle)
  for (p1, p2) in lines where hypot(p1.x - p2.x, p1.y - p2.y) != 0 {
    zigzag.append((Point2D(p1.x - dgx, p1.y + dgy), p2))
    zigzag.append((Point2D(p1.x + dgx, p1.y - dgy), p2))
  }
  return RoughOpSet(kind: .fillSketch, ops: renderLines(zigzag, &o))
}

private func polygonHachureLines(_ polygons: inout [[Point2D]], _ o: RoughOptions)
  -> [(Point2D, Point2D)]
{
  let angle = o.hachureAngle + 90
  var gap = o.hachureGap
  if gap < 0 { gap = o.strokeWidth * 4 }
  gap = max(gap, 0.1)
  var skipOffset = 1.0
  if o.roughness >= 1 {
    let next = o.randomizer?.next() ?? 0
    if (next != 0 ? next : Double.random(in: 0..<1)) > 0.7 { skipOffset = gap }
  }
  return hachureLines(&polygons, gap, angle, skipOffset != 0 ? skipOffset : 1)
}

/// hachure-fill 0.5.2. It rotates the polygons in place and back, and the
/// round trip leaves them a few ulps off, which the second pass of a
/// cross-hatch then starts from; hence `inout`.
private func hachureLines(
  _ polygons: inout [[Point2D]], _ hachureGap: Double, _ angle: Double, _ stepOffset: Double
) -> [(Point2D, Point2D)] {
  let gap = max(hachureGap, 0.1)
  if angle != 0 {
    for index in polygons.indices { rotate(&polygons[index], degrees: angle) }
  }
  var lines = straightHachureLines(polygons, gap, stepOffset)
  if angle != 0 {
    for index in polygons.indices { rotate(&polygons[index], degrees: -angle) }
    var points = lines.flatMap { [$0.0, $0.1] }
    rotate(&points, degrees: -angle)
    lines = stride(from: 0, to: points.count, by: 2).map { (points[$0], points[$0 + 1]) }
  }
  return lines
}

private func rotate(_ points: inout [Point2D], degrees: Double) {
  let angle = (Double.pi / 180) * degrees
  let c = cos(angle)
  let s = sin(angle)
  for index in points.indices {
    let x = points[index].x
    let y = points[index].y
    points[index] = Point2D((x * c) - (y * s), (x * s) + (y * c))
  }
}

private final class HachureEdge {
  let ymin: Double
  let ymax: Double
  var x: Double
  let islope: Double

  init(ymin: Double, ymax: Double, x: Double, islope: Double) {
    self.ymin = ymin
    self.ymax = ymax
    self.x = x
    self.islope = islope
  }
}

/// `Array.prototype.sort` is stable; so is this, whatever the comparator.
func stableSorted<T>(_ items: [T], by compare: (T, T) -> Double) -> [T] {
  items.enumerated().sorted { a, b in
    let order = compare(a.element, b.element)
    if order < 0 { return true }
    if order > 0 { return false }
    return a.offset < b.offset
  }.map(\.element)
}

private func straightHachureLines(
  _ polygons: [[Point2D]], _ hachureGap: Double, _ stepOffset: Double
) -> [(Point2D, Point2D)] {
  var vertexArray: [[Point2D]] = []
  for polygon in polygons {
    guard let first = polygon.first, let last = polygon.last else { continue }
    var vertices = polygon
    if first != last { vertices.append(first) }
    if vertices.count > 2 { vertexArray.append(vertices) }
  }
  var lines: [(Point2D, Point2D)] = []
  let gap = max(hachureGap, 0.1)
  var edges: [HachureEdge] = []
  for vertices in vertexArray {
    for i in 0..<(vertices.count - 1) {
      let p1 = vertices[i]
      let p2 = vertices[i + 1]
      if p1.y != p2.y {
        let ymin = min(p1.y, p2.y)
        edges.append(
          HachureEdge(
            ymin: ymin, ymax: max(p1.y, p2.y), x: ymin == p1.y ? p1.x : p2.x,
            islope: (p2.x - p1.x) / (p2.y - p1.y)))
      }
    }
  }
  edges = stableSorted(edges) { e1, e2 in
    if e1.ymin < e2.ymin { return -1 }
    if e1.ymin > e2.ymin { return 1 }
    if e1.x < e2.x { return -1 }
    if e1.x > e2.x { return 1 }
    if e1.ymax == e2.ymax { return 0 }
    return (e1.ymax - e2.ymax) / abs(e1.ymax - e2.ymax)
  }
  guard let firstEdge = edges.first else { return lines }
  var active: [HachureEdge] = []
  var y = firstEdge.ymin
  var iteration = 0
  while !active.isEmpty || !edges.isEmpty {
    if !edges.isEmpty {
      var ix = -1
      for i in edges.indices {
        if edges[i].ymin > y { break }
        ix = i
      }
      active += edges.prefix(ix + 1)
      edges.removeFirst(ix + 1)
    }
    active = active.filter { $0.ymax > y }
    active = stableSorted(active) { a, b in
      if a.x == b.x { return 0 }
      return (a.x - b.x) / abs(a.x - b.x)
    }
    if stepOffset != 1 || Double(iteration).truncatingRemainder(dividingBy: gap) == 0 {
      if active.count > 1 {
        var i = 0
        while i + 1 < active.count {
          lines.append(
            (Point2D(jsRound(active[i].x), y), Point2D(jsRound(active[i + 1].x), y)))
          i += 2
        }
      }
    }
    y += stepOffset
    for edge in active { edge.x = edge.x + (stepOffset * edge.islope) }
    iteration += 1
  }
  return lines
}
