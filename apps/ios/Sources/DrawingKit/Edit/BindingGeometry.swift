import Foundation

// The plane geometry arrows bind with, as `@excalidraw/math` and
// `element/utils.ts` have it, with their operation order kept so a bound
// point lands where the web puts it.

private let precision = 1e-4

func pointsEqual(_ a: Point2D, _ b: Point2D) -> Bool {
  abs(a.x - b.x) < precision && abs(a.y - b.y) < precision
}

/// `vectorFromPoint(p, origin)`.
func vector(_ p: Point2D, from origin: Point2D) -> Point2D { Point2D(p.x - origin.x, p.y - origin.y) }

/// `pointFromVector(v, offset)`.
func point(_ v: Point2D, from offset: Point2D) -> Point2D { Point2D(offset.x + v.x, offset.y + v.y) }

func scaled(_ v: Point2D, _ scalar: Double) -> Point2D { Point2D(v.x * scalar, v.y * scalar) }

func cross(_ a: Point2D, _ b: Point2D) -> Double { a.x * b.y - b.x * a.y }

func normalized(_ v: Point2D) -> Point2D {
  let m = (v.x * v.x + v.y * v.y).squareRoot()
  return m == 0 ? Point2D(0, 0) : Point2D(v.x / m, v.y / m)
}

private func distanceSquared(_ a: Point2D, _ b: Point2D) -> Double {
  let dx = b.x - a.x
  let dy = b.y - a.y
  return dx * dx + dy * dy
}

private struct Segment {
  var a: Point2D
  var b: Point2D
  init(_ a: Point2D, _ b: Point2D) {
    self.a = a
    self.b = b
  }
}

/// A cubic Bézier curve's four points.
private typealias Curve = [Point2D]

/// `distanceToLineSegment`.
private func distance(_ p: Point2D, to segment: Segment) -> Double {
  let a = p.x - segment.a.x
  let b = p.y - segment.a.y
  let c = segment.b.x - segment.a.x
  let d = segment.b.y - segment.a.y
  let dot = a * c + b * d
  let lengthSquared = c * c + d * d
  let param = lengthSquared != 0 ? dot / lengthSquared : -1
  let (x, y): (Double, Double) =
    param < 0
    ? (segment.a.x, segment.a.y)
    : param > 1 ? (segment.b.x, segment.b.y) : (segment.a.x + param * c, segment.a.y + param * d)
  let dx = p.x - x
  let dy = p.y - y
  return (dx * dx + dy * dy).squareRoot()
}

private func isOn(_ p: Point2D, _ segment: Segment) -> Bool {
  let d = distance(p, to: segment)
  return d == 0 || d < precision
}

/// `linesIntersectAt`.
private func linesIntersect(_ a: Segment, _ b: Segment) -> Point2D? {
  let a1 = a.b.y - a.a.y
  let b1 = a.a.x - a.b.x
  let a2 = b.b.y - b.a.y
  let b2 = b.a.x - b.b.x
  let d = a1 * b2 - a2 * b1
  guard d != 0 else { return nil }
  let c1 = a1 * a.a.x + b1 * a.a.y
  let c2 = a2 * b.a.x + b2 * b.a.y
  return Point2D((c1 * b2 - c2 * b1) / d, (a1 * c2 - a2 * c1) / d)
}

/// `lineSegmentIntersectionPoints`.
private func intersection(_ l: Segment, _ s: Segment) -> Point2D? {
  guard let candidate = linesIntersect(l, s), isOn(candidate, s), isOn(candidate, l) else { return nil }
  return candidate
}

/// `bezierEquation`.
private func bezier(_ c: Curve, _ t: Double) -> Point2D {
  Point2D(
    pow(1 - t, 3) * c[0].x + 3 * pow(1 - t, 2) * t * c[1].x + 3 * (1 - t) * pow(t, 2) * c[2].x + pow(t, 3)
      * c[3].x,
    pow(1 - t, 3) * c[0].y + 3 * pow(1 - t, 2) * t * c[1].y + 3 * (1 - t) * pow(t, 2) * c[2].y + pow(t, 3)
      * c[3].y)
}

/// `solve`: Newton's method on two unknowns, with a numerical Jacobian.
private func solve(_ f: (Double, Double) -> (Double, Double), _ t: Double, _ s: Double) -> (Double, Double)? {
  let delta = 1e-6
  func gradient(_ g: (Double, Double) -> Double, _ t: Double, _ s: Double) -> (Double, Double) {
    ((g(t + delta, s) - g(t - delta, s)) / (2 * delta), (g(t, s + delta) - g(t, s - delta)) / (2 * delta))
  }
  var t0 = t
  var s0 = s
  var error = Double.infinity
  var iteration = 0
  while error >= 1e-3 {
    if iteration >= 10 { return nil }
    let y0 = f(t0, s0)
    let j0 = gradient({ f($0, $1).0 }, t0, s0)
    let j1 = gradient({ f($0, $1).1 }, t0, s0)
    let b0 = -y0.0
    let b1 = -y0.1
    let det = j0.0 * j1.1 - j0.1 * j1.0
    if det == 0 { return nil }
    let i00 = j1.1 / det
    let i01 = -j0.1 / det
    let i10 = -j1.0 / det
    let i11 = j0.0 / det
    t0 = t0 + (i00 * b0 + i01 * b1)
    s0 = s0 + (i10 * b0 + i11 * b1)
    let (tError, sError) = f(t0, s0)
    error = max(abs(tError), abs(sError))
    iteration += 1
  }
  return (t0, s0)
}

/// `curveIntersectLineSegment`: at most one point, found from three guesses.
private func intersections(_ c: Curve, _ l: Segment) -> [Point2D] {
  let xs = c.map(\.x)
  let ys = c.map(\.y)
  let r0 = Point2D(xs.min()!, ys.min()!)
  let r1 = Point2D(xs.max()!, ys.max()!)
  let sides = [
    Segment(r0, Point2D(r1.x, r0.y)), Segment(Point2D(r1.x, r0.y), r1), Segment(r1, Point2D(r0.x, r1.y)),
    Segment(Point2D(r0.x, r1.y), r0),
  ]
  guard sides.contains(where: { intersection(l, $0) != nil }) else { return [] }
  func line(_ s: Double) -> Point2D {
    Point2D(l.a.x + s * (l.b.x - l.a.x), l.a.y + s * (l.b.y - l.a.y))
  }
  for guess in [0.5, 0.2, 0.8] {
    guard
      let (t, s) = solve(
        { t, s in
          let b = bezier(c, t)
          let p = line(s)
          return (b.x - p.x, b.y - p.y)
        }, guess, 0),
      t >= 0, t <= 1, s >= 0, s <= 1
    else { continue }
    return [bezier(c, t)]
  }
  return []
}

/// `curvePointDistance`, by `curveClosestPoint`'s search.
private func distance(_ p: Point2D, to c: Curve) -> Double {
  let tolerance = 1e-3
  func d(_ t: Double) -> Double { p.distance(to: bezier(c, t)) }
  let steps = 30
  var closest = 0
  var minimum = Double.infinity
  for step in 0..<steps {
    let value = d(Double(step) / Double(steps))
    if value < minimum {
      minimum = value
      closest = step
    }
  }
  var m = max(Double(closest - 1) / Double(steps), 0)
  var n = min(Double(closest + 1) / Double(steps), 1)
  var k: Double?
  while n - m > tolerance {
    let middle = (n + m) / 2
    k = middle
    if d(middle - tolerance) < d(middle + tolerance) { n = middle } else { m = middle }
  }
  guard let solution = k, solution != 0 else { return 0 }
  return p.distance(to: bezier(c, solution))
}

/// `ellipseDistanceFromPoint`.
private func ellipseDistance(_ p: Point2D, center: Point2D, a: Double, b: Double) -> Double {
  let translated = Point2D(p.x + -center.x, p.y + -center.y)
  let px = abs(translated.x)
  let py = abs(translated.y)
  var tx = 0.707
  var ty = 0.707
  for _ in 0..<3 {
    let x = a * tx
    let y = b * ty
    let ex = (a * a - b * b) * pow(tx, 3) / a
    let ey = (b * b - a * a) * pow(ty, 3) / b
    let r = hypot(y - ey, x - ex)
    let q = hypot(py - ey, px - ex)
    tx = min(1, max(0, ((px - ex) * r / q + ex) / a))
    ty = min(1, max(0, ((py - ey) * r / q + ey) / b))
    let t = hypot(ty, tx)
    tx /= t
    ty /= t
  }
  return translated.distance(to: Point2D(a * tx * mathSign(translated.x), b * ty * mathSign(translated.y)))
}

/// `ellipseLineIntersectionPoints`, with the line through `l` unbounded.
private func ellipseIntersections(center: Point2D, a: Double, b: Double, _ l: Segment) -> [Point2D] {
  let x1 = l.a.x - center.x
  let y1 = l.a.y - center.y
  let x2 = l.b.x - center.x
  let y2 = l.b.y - center.y
  let qa = pow(x2 - x1, 2) / pow(a, 2) + pow(y2 - y1, 2) / pow(b, 2)
  let qb = 2 * (x1 * (x2 - x1) / pow(a, 2) + y1 * (y2 - y1) / pow(b, 2))
  let qc = pow(x1, 2) / pow(a, 2) + pow(y1, 2) / pow(b, 2) - 1
  let t1 = (-qb + (pow(qb, 2) - 4 * qa * qc).squareRoot()) / (2 * qa)
  let t2 = (-qb - (pow(qb, 2) - 4 * qa * qc).squareRoot()) / (2 * qa)
  let candidates = [
    Point2D(x1 + t1 * (x2 - x1) + center.x, y1 + t1 * (y2 - y1) + center.y),
    Point2D(x1 + t2 * (x2 - x1) + center.x, y1 + t2 * (y2 - y1) + center.y),
  ].filter { !$0.x.isNaN && !$0.y.isNaN }
  if candidates.count == 2 && pointsEqual(candidates[0], candidates[1]) { return [candidates[0]] }
  return candidates
}

// MARK: Shapes arrows bind to

extension DrawingElement {
  var center: Point2D { Point2D(x + width / 2, y + height / 2) }

  /// `isBindableElement`.
  var isBindable: Bool {
    switch type {
    case .rectangle, .diamond, .ellipse, .image, .iframe, .embeddable, .frame, .magicframe: true
    case .text: containerId == nil
    case .line, .arrow, .freedraw: false
    }
  }

  /// `isBindingFallthroughEnabled`: whether an arrow can reach through the
  /// shape to what is below, as it can through one that isn't filled.
  var letsBindingFallThrough: Bool { fillStyle != .solid || isTransparentColor(backgroundColor) }

  /// `aabbForElement`.
  var axisAlignedBounds: Bounds {
    let corners = [Point2D(x, y), Point2D(x + width, y), Point2D(x + width, y + height), Point2D(x, y + height)]
      .map { $0.rotated(around: center, by: angle) }
    return Bounds(
      minX: corners.map(\.x).min()!, minY: corners.map(\.y).min()!, maxX: corners.map(\.x).max()!,
      maxY: corners.map(\.y).max()!)
  }

  /// `maxBindingGap`: how near an arrow's end must come to bind.
  func maxBindingGap(width: Double, height: Double, zoom: Double? = nil) -> Double {
    let zoomValue = zoom.map { $0 < 1 ? $0 : 1 } ?? 1
    let shapeRatio = type == .diamond ? 1 / 2.0.squareRoot() : 1
    let smaller = shapeRatio * min(width, height)
    return max(16, min(0.25 * smaller, 32), 10 / zoomValue + 4)
  }

  /// `deconstructRectanguloidElement`: the sides, and the rounded corners.
  private func rectanguloidParts(offset: Double = 0) -> ([Segment], [Curve]) {
    let roundness = cornerRadius(min(width, height), self)
    if roundness <= 0 {
      let r0 = Point2D(x - offset, y - offset)
      let r1 = Point2D(x + width + offset, y + height + offset)
      return (
        [
          Segment(Point2D(r0.x + roundness, r0.y), Point2D(r1.x - roundness, r0.y)),
          Segment(Point2D(r1.x, r0.y + roundness), Point2D(r1.x, r1.y - roundness)),
          Segment(Point2D(r0.x + roundness, r1.y), Point2D(r1.x - roundness, r1.y)),
          Segment(Point2D(r0.x, r1.y - roundness), Point2D(r0.x, r0.y + roundness)),
        ], []
      )
    }
    let r0 = Point2D(x, y)
    let r1 = Point2D(x + width, y + height)
    let top = Segment(Point2D(r0.x + roundness, r0.y), Point2D(r1.x - roundness, r0.y))
    let right = Segment(Point2D(r1.x, r0.y + roundness), Point2D(r1.x, r1.y - roundness))
    let bottom = Segment(Point2D(r0.x + roundness, r1.y), Point2D(r1.x - roundness, r1.y))
    let left = Segment(Point2D(r0.x, r1.y - roundness), Point2D(r0.x, r0.y + roundness))
    let offsets = [
      Point2D(r0.x - offset, r0.y - offset), Point2D(r1.x + offset, r0.y - offset),
      Point2D(r1.x + offset, r1.y + offset), Point2D(r0.x - offset, r1.y + offset),
    ].map { scaled(normalized(vector($0, from: center)), offset) }
    func toward(_ p: Point2D, _ cornerX: Double, _ cornerY: Double) -> Point2D {
      Point2D(p.x + 2 / 3 * (cornerX - p.x), p.y + 2 / 3 * (cornerY - p.y))
    }
    let corners: [Curve] = [
      [left.b, toward(left.b, r0.x, r0.y), toward(top.a, r0.x, r0.y), top.a].map { point(offsets[0], from: $0) },
      [top.b, toward(top.b, r1.x, r0.y), toward(right.a, r1.x, r0.y), right.a].map { point(offsets[1], from: $0) },
      [right.b, toward(right.b, r1.x, r1.y), toward(bottom.b, r1.x, r1.y), bottom.b].map {
        point(offsets[2], from: $0)
      },
      [bottom.a, toward(bottom.a, r0.x, r1.y), toward(left.a, r0.x, r1.y), left.a].map {
        point(offsets[3], from: $0)
      },
    ]
    return (sides(of: corners), corners)
  }

  /// `deconstructDiamondElement`.
  private func diamondParts(offset: Double = 0) -> ([Segment], [Curve]) {
    let d = diamondPoints(self)
    let (topX, topY, rightX, rightY, bottomX, bottomY, leftX, leftY) = (d[0], d[1], d[2], d[3], d[4], d[5], d[6], d[7])
    let v = cornerRadius(abs(topX - leftX), self)
    let h = cornerRadius(abs(rightY - topY), self)
    if roundness == nil {
      let top = Point2D(x + topX, y + topY - offset)
      let right = Point2D(x + rightX + offset, y + rightY)
      let bottom = Point2D(x + bottomX, y + bottomY + offset)
      let left = Point2D(x + leftX - offset, y + leftY)
      return (
        [
          Segment(Point2D(top.x + v, top.y + h), Point2D(right.x - v, right.y - h)),
          Segment(Point2D(right.x - v, right.y + h), Point2D(bottom.x + v, bottom.y - h)),
          Segment(Point2D(bottom.x - v, bottom.y - h), Point2D(left.x + v, left.y + h)),
          Segment(Point2D(left.x + v, left.y - h), Point2D(top.x - v, top.y + h)),
        ], []
      )
    }
    let top = Point2D(x + topX, y + topY)
    let right = Point2D(x + rightX, y + rightY)
    let bottom = Point2D(x + bottomX, y + bottomY)
    let left = Point2D(x + leftX, y + leftY)
    let offsets = [right, bottom, left, top].map { scaled(normalized(vector($0, from: center)), offset) }
    let corners: [Curve] = [
      [Point2D(right.x - v, right.y - h), right, right, Point2D(right.x - v, right.y + h)].map {
        point(offsets[0], from: $0)
      },
      [Point2D(bottom.x + v, bottom.y - h), bottom, bottom, Point2D(bottom.x - v, bottom.y - h)].map {
        point(offsets[1], from: $0)
      },
      [Point2D(left.x + v, left.y + h), left, left, Point2D(left.x + v, left.y - h)].map {
        point(offsets[2], from: $0)
      },
      [Point2D(top.x - v, top.y + h), top, top, Point2D(top.x + v, top.y + h)].map { point(offsets[3], from: $0) },
    ]
    return (sides(of: corners), corners)
  }

  private func sides(of corners: [Curve]) -> [Segment] {
    [
      Segment(corners[0][3], corners[1][0]), Segment(corners[1][3], corners[2][0]),
      Segment(corners[2][3], corners[3][0]), Segment(corners[3][3], corners[0][0]),
    ]
  }

  /// `distanceToBindableElement`.
  func distanceToOutline(_ p: Point2D) -> Double {
    let q = p.rotated(around: center, by: -angle)
    if type == .ellipse { return ellipseDistance(q, center: center, a: width / 2, b: height / 2) }
    let (sides, corners) = type == .diamond ? diamondParts() : rectanguloidParts()
    return (sides.map { distance(q, to: $0) } + corners.map { distance(q, to: $0) }).min() ?? .infinity
  }

  /// `intersectElementWithLineSegment`: where `l` crosses the outline grown
  /// by `offset`.
  private func intersections(with l: Segment, offset: Double) -> [Point2D] {
    let a = l.a.rotated(around: center, by: -angle)
    let b = l.b.rotated(around: center, by: -angle)
    let rotated = Segment(a, b)
    if type == .ellipse {
      return ellipseIntersections(center: center, a: width / 2 + offset, b: height / 2 + offset, rotated)
        .map { $0.rotated(around: center, by: angle) }
    }
    let (sides, corners) = type == .diamond ? diamondParts(offset: offset) : rectanguloidParts(offset: offset)
    let found =
      sides.compactMap { intersection(rotated, $0) }.map { $0.rotated(around: center, by: angle) }
      + corners.flatMap { DrawingKit.intersections($0, rotated) }.map { $0.rotated(around: center, by: angle) }
    return found.enumerated().filter { index, p in found.firstIndex { pointsEqual(p, $0) } == index }.map(\.1)
  }

  /// `intersectElementWithLineSegment`, for the segment from `a` to `b`.
  func outlineIntersections(_ a: Point2D, _ b: Point2D, offset: Double = 0) -> [Point2D] {
    intersections(with: Segment(a, b), offset: offset)
  }

  /// `determineFocusDistance`: where, across the shape, the line from `a`
  /// through `b` passes its centre, as a signed fraction of the half
  /// diagonal.
  func focusDistance(_ a: Point2D, _ b: Point2D) -> Double {
    if pointsEqual(a, b) { return 0 }
    let rotatedA = a.rotated(around: center, by: -angle)
    let rotatedB = b.rotated(around: center, by: -angle)
    let crossed = cross(vector(rotatedB, from: a), vector(rotatedB, from: center))
    let sign = (crossed > 0 ? 1.0 : crossed < 0 ? -1 : 0) * -1
    let interceptor = Segment(
      rotatedB,
      point(scaled(normalized(vector(rotatedB, from: rotatedA)), max(width * 2, height * 2)), from: rotatedB))
    let axes: [Segment]
    let interceptees: [Segment]
    if type == .diamond {
      axes = [
        Segment(Point2D(x + width / 2, y), Point2D(x + width / 2, y + height)),
        Segment(Point2D(x, y + height / 2), Point2D(x + width, y + height / 2)),
      ]
      interceptees = [
        Segment(Point2D(x + width / 2, y - height), Point2D(x + width / 2, y + height * 2)),
        Segment(Point2D(x - width, y + height / 2), Point2D(x + width * 2, y + height / 2)),
      ]
    } else {
      axes = [
        Segment(Point2D(x, y), Point2D(x + width, y + height)),
        Segment(Point2D(x + width, y), Point2D(x, y + height)),
      ]
      interceptees = [
        Segment(Point2D(x - width, y - height), Point2D(x + width * 2, y + height * 2)),
        Segment(Point2D(x + width * 2, y - height), Point2D(x - width, y + height * 2)),
      ]
    }
    let halfDiagonal = (width * width + height * height).squareRoot() / 2
    let ordered = interceptees.compactMap { intersection(interceptor, $0) }
      .sorted { distanceSquared($0, b) < distanceSquared($1, b) }
      .enumerated()
      .map { index, p in
        sign * center.distance(to: p)
          / (type == .diamond ? axes[index].a.distance(to: axes[index].b) / 2 : halfDiagonal)
      }
      .sorted { abs($0) < abs($1) }
    return ordered.first ?? 0
  }

  /// `determineFocusPoint`: the point on the shape's axes a binding's focus
  /// names, on the side facing `adjacent`.
  func focusPoint(_ focus: Double, facing adjacent: Point2D) -> Point2D {
    if focus == 0 { return center }
    let corners =
      type == .diamond
      ? [
        Point2D(x, y + height / 2), Point2D(x + width / 2, y), Point2D(x + width, y + height / 2),
        Point2D(x + width / 2, y + height),
      ]
      : [Point2D(x, y), Point2D(x + width, y), Point2D(x + width, y + height), Point2D(x, y + height)]
    let c = corners.map { point(scaled(vector($0, from: center), abs(focus)), from: center) }
      .map { $0.rotated(around: center, by: angle) }
    func turn(_ i: Int, _ j: Int) -> Double { cross(vector(adjacent, from: c[i]), vector(c[j], from: c[i])) }
    let top = turn(0, 1) > 0 && (focus > 0 ? turn(1, 2) < 0 : turn(3, 0) < 0)
    let right = turn(1, 2) > 0 && (focus > 0 ? turn(2, 3) < 0 : turn(0, 1) < 0)
    let bottom = turn(2, 3) > 0 && (focus > 0 ? turn(3, 0) < 0 : turn(1, 2) < 0)
    if top { return focus > 0 ? c[1] : c[0] }
    if right { return focus > 0 ? c[2] : c[1] }
    if bottom { return focus > 0 ? c[3] : c[2] }
    return focus > 0 ? c[0] : c[3]
  }

  /// `updateBoundPoint`'s new edge: where an arrow coming from `adjacent`
  /// meets the outline grown by the binding's gap, on its way to the focus.
  func boundEdge(focus: Double, gap: Double, adjacent: Point2D, edge: Point2D) -> Point2D {
    let target = focusPoint(focus, facing: adjacent)
    if gap == 0 { return target }
    let length = adjacent.distance(to: edge) + adjacent.distance(to: center) + max(width, height) * 2
    let found = intersections(
      with: Segment(adjacent, point(scaled(normalized(vector(target, from: adjacent)), length), from: adjacent)),
      offset: gap
    ).sorted { distanceSquared($0, adjacent) < distanceSquared($1, adjacent) }
    if found.count > 1 { return found[0] }
    return found.count == 1 ? target : edge
  }
}
