import Foundation

// points-on-curve 0.2.0: flattening Béziers and Ramer–Douglas–Peucker.

private func distanceSquared(_ a: Point2D, _ b: Point2D) -> Double {
  pow(a.x - b.x, 2) + pow(a.y - b.y, 2)
}

private func lerp(_ a: Point2D, _ b: Point2D, _ t: Double) -> Point2D {
  Point2D(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}

private func distanceToSegmentSquared(_ p: Point2D, _ v: Point2D, _ w: Point2D) -> Double
{
  let l2 = distanceSquared(v, w)
  if l2 == 0 { return distanceSquared(p, v) }
  var t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2
  t = max(0, min(1, t))
  return distanceSquared(p, lerp(v, w, t))
}

private func flatness(_ points: [Point2D], _ offset: Int) -> Double {
  let p1 = points[offset]
  let p2 = points[offset + 1]
  let p3 = points[offset + 2]
  let p4 = points[offset + 3]
  var ux = 3 * p2.x - 2 * p1.x - p4.x
  ux *= ux
  var uy = 3 * p2.y - 2 * p1.y - p4.y
  uy *= uy
  var vx = 3 * p3.x - 2 * p4.x - p1.x
  vx *= vx
  var vy = 3 * p3.y - 2 * p4.y - p1.y
  vy *= vy
  if ux < vx { ux = vx }
  if uy < vy { uy = vy }
  return ux + uy
}

private func pointsOnBezierCurveWithSplitting(
  _ points: [Point2D], _ offset: Int, _ tolerance: Double, _ out: inout [Point2D]
) {
  if flatness(points, offset) < tolerance {
    let p0 = points[offset]
    if let last = out.last {
      if distanceSquared(last, p0).squareRoot() > 1 { out.append(p0) }
    } else {
      out.append(p0)
    }
    out.append(points[offset + 3])
  } else {
    let p1 = points[offset]
    let p2 = points[offset + 1]
    let p3 = points[offset + 2]
    let p4 = points[offset + 3]
    let q1 = lerp(p1, p2, 0.5)
    let q2 = lerp(p2, p3, 0.5)
    let q3 = lerp(p3, p4, 0.5)
    let r1 = lerp(q1, q2, 0.5)
    let r2 = lerp(q2, q3, 0.5)
    let red = lerp(r1, r2, 0.5)
    pointsOnBezierCurveWithSplitting([p1, q1, r1, red], 0, tolerance, &out)
    pointsOnBezierCurveWithSplitting([red, r2, q3, p4], 0, tolerance, &out)
  }
}

func simplifyPoints(_ points: [Point2D], _ epsilon: Double) -> [Point2D] {
  var out: [Point2D] = []
  simplifyPoints(points, 0, points.count, epsilon, &out)
  return out
}

private func simplifyPoints(
  _ points: [Point2D], _ start: Int, _ end: Int, _ epsilon: Double, _ out: inout [Point2D]
) {
  guard end > start else { return }
  let s = points[start]
  let e = points[end - 1]
  var maxDistanceSquared = 0.0
  var maxIndex = 1
  var i = start + 1
  while i < end - 1 {
    let d = distanceToSegmentSquared(points[i], s, e)
    if d > maxDistanceSquared {
      maxDistanceSquared = d
      maxIndex = i
    }
    i += 1
  }
  if maxDistanceSquared.squareRoot() > epsilon {
    simplifyPoints(points, start, maxIndex + 1, epsilon, &out)
    simplifyPoints(points, maxIndex, end, epsilon, &out)
  } else {
    if out.isEmpty { out.append(s) }
    out.append(e)
  }
}

func pointsOnBezierCurves(_ points: [Point2D], tolerance: Double = 0.15, distance: Double)
  -> [Point2D]
{
  var newPoints: [Point2D] = []
  let segments = (points.count - 1) / 3
  for i in 0..<max(segments, 0) {
    pointsOnBezierCurveWithSplitting(points, i * 3, tolerance, &newPoints)
  }
  if distance > 0 { return simplifyPoints(newPoints, distance) }
  return newPoints
}

func curveToBezier(_ pointsIn: [Point2D], curveTightness: Double = 0) -> [Point2D] {
  let count = pointsIn.count
  precondition(count >= 3, "A curve must have at least three points.")
  if count == 3 { return [pointsIn[0], pointsIn[1], pointsIn[2], pointsIn[2]] }
  var points: [Point2D] = [pointsIn[0], pointsIn[0]]
  for i in 1..<count {
    points.append(pointsIn[i])
    if i == count - 1 { points.append(pointsIn[i]) }
  }
  let s = 1 - curveTightness
  var out: [Point2D] = [points[0]]
  var i = 1
  while i + 2 < points.count {
    let current = points[i]
    out.append(
      Point2D(
        current.x + (s * points[i + 1].x - s * points[i - 1].x) / 6,
        current.y + (s * points[i + 1].y - s * points[i - 1].y) / 6))
    out.append(
      Point2D(
        points[i + 1].x + (s * points[i].x - s * points[i + 2].x) / 6,
        points[i + 1].y + (s * points[i].y - s * points[i + 2].y) / 6))
    out.append(points[i + 1])
    i += 1
  }
  return out
}
