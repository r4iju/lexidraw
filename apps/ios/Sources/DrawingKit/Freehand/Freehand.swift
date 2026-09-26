import Foundation

// A port of perfect-freehand 1.2.0, which draws Excalidraw's freedraw strokes.

struct StrokeOptions {
  var size = 16.0
  var thinning = 0.5
  var smoothing = 0.5
  var streamline = 0.5
  var simulatePressure = true
  var easing: (Double) -> Double = { $0 }
  var last = false
}

struct StrokePoint {
  var point: Point2D
  var pressure: Double
  var vector: Point2D
  var distance: Double
  var runningLength: Double
}

/// An input point, with the pressure it was given, if any.
struct FreehandInput {
  var x: Double
  var y: Double
  var pressure: Double?
}

private func add(_ a: Point2D, _ b: Point2D) -> Point2D { Point2D(a.x + b.x, a.y + b.y) }
private func sub(_ a: Point2D, _ b: Point2D) -> Point2D { Point2D(a.x - b.x, a.y - b.y) }
private func mul(_ a: Point2D, _ n: Double) -> Point2D { Point2D(a.x * n, a.y * n) }
private func per(_ a: Point2D) -> Point2D { Point2D(a.y, -a.x) }
private func neg(_ a: Point2D) -> Point2D { Point2D(-a.x, -a.y) }
private func dot(_ a: Point2D, _ b: Point2D) -> Double { a.x * b.x + a.y * b.y }
private func unit(_ a: Point2D) -> Point2D {
  let length = hypot(a.x, a.y)
  return Point2D(a.x / length, a.y / length)
}
private func distanceSquared(_ a: Point2D, _ b: Point2D) -> Double {
  let d = sub(a, b)
  return d.x * d.x + d.y * d.y
}
private func lerp(_ a: Point2D, _ b: Point2D, _ t: Double) -> Point2D { add(a, mul(sub(b, a), t)) }
private func project(_ a: Point2D, _ b: Point2D, _ c: Double) -> Point2D { add(a, mul(b, c)) }
private func rotateAround(_ a: Point2D, _ c: Point2D, _ r: Double) -> Point2D {
  let s = sin(r)
  let co = cos(r)
  let px = a.x - c.x
  let py = a.y - c.y
  return Point2D(px * co - py * s + c.x, px * s + py * co + c.y)
}

private func strokeRadius(
  _ size: Double, _ thinning: Double, _ pressure: Double, _ easing: (Double) -> Double
) -> Double {
  size * easing(0.5 - thinning * (0.5 - pressure))
}

func getStrokePoints(_ input: [FreehandInput], _ options: StrokeOptions) -> [StrokePoint] {
  guard !input.isEmpty else { return [] }
  let t = 0.15 + (1 - options.streamline) * 0.85
  var points = input
  if points.count == 2 {
    let last = points[1]
    points.removeLast()
    let first = Point2D(points[0].x, points[0].y)
    for i in 1..<5 {
      let p = lerp(first, Point2D(last.x, last.y), Double(i) / 4)
      points.append(FreehandInput(x: p.x, y: p.y, pressure: nil))
    }
  }
  if points.count == 1 {
    points.append(FreehandInput(x: points[0].x + 1, y: points[0].y + 1, pressure: points[0].pressure))
  }
  func pressure(_ value: Double?, _ fallback: Double) -> Double {
    if let value, value >= 0 { return value }
    return fallback
  }
  var result = [
    StrokePoint(
      point: Point2D(points[0].x, points[0].y), pressure: pressure(points[0].pressure, 0.25),
      vector: Point2D(1, 1), distance: 0, runningLength: 0)
  ]
  var hasReachedMinimumLength = false
  var runningLength = 0.0
  var previous = result[0]
  let max = points.count - 1
  for i in 1..<points.count {
    let target = Point2D(points[i].x, points[i].y)
    let point = options.last && i == max ? target : lerp(previous.point, target, t)
    if point == previous.point { continue }
    let distance = hypot(point.y - previous.point.y, point.x - previous.point.x)
    runningLength += distance
    if i < max && !hasReachedMinimumLength {
      if runningLength < options.size { continue }
      hasReachedMinimumLength = true
    }
    previous = StrokePoint(
      point: point, pressure: pressure(points[i].pressure, 0.5),
      vector: unit(sub(previous.point, point)), distance: distance, runningLength: runningLength)
    result.append(previous)
  }
  result[0].vector = result.count > 1 ? result[1].vector : Point2D(0, 0)
  return result
}

private let rateOfPressureChange = 0.275
private let fixedPi = Double.pi + 0.0001

func getStrokeOutlinePoints(_ points: [StrokePoint], _ options: StrokeOptions) -> [Point2D] {
  let size = options.size
  let thinning = options.thinning
  let easing = options.easing
  guard !points.isEmpty, size > 0 else { return [] }
  let totalLength = points[points.count - 1].runningLength
  let minDistance = pow(size * options.smoothing, 2)
  var leftPoints: [Point2D] = []
  var rightPoints: [Point2D] = []
  var previousPressure = points.prefix(10).reduce(points[0].pressure) { acc, current in
    var pressure = current.pressure
    if options.simulatePressure {
      let speed = min(1, current.distance / size)
      let rate = min(1, 1 - speed)
      pressure = min(1, acc + (rate - acc) * (speed * rateOfPressureChange))
    }
    return (acc + pressure) / 2
  }
  var radius = strokeRadius(size, thinning, points[points.count - 1].pressure, easing)
  var firstRadius: Double?
  var previousVector = points[0].vector
  var previousLeft = points[0].point
  var previousRight = previousLeft
  var turnedLeft = previousLeft
  var turnedRight = previousRight
  var isPrevPointSharpCorner = false

  for i in 0..<points.count {
    var pressure = points[i].pressure
    let point = points[i].point
    let vector = points[i].vector
    let distance = points[i].distance
    let runningLength = points[i].runningLength
    if i < points.count - 1 && totalLength - runningLength < 3 { continue }
    if thinning != 0 {
      if options.simulatePressure {
        let speed = min(1, distance / size)
        let rate = min(1, 1 - speed)
        pressure = min(1, previousPressure + (rate - previousPressure) * (speed * rateOfPressureChange))
      }
      radius = strokeRadius(size, thinning, pressure, easing)
    } else {
      radius = size / 2
    }
    if firstRadius == nil { firstRadius = radius }
    radius = Swift.max(0.01, radius)
    let nextVector = (i < points.count - 1 ? points[i + 1] : points[i]).vector
    let nextDot = i < points.count - 1 ? dot(vector, nextVector) : 1
    let prevDot = dot(vector, previousVector)
    let isPointSharpCorner = prevDot < 0 && !isPrevPointSharpCorner
    let isNextPointSharpCorner = nextDot < 0
    if isPointSharpCorner || isNextPointSharpCorner {
      let offset = mul(per(previousVector), radius)
      let step = 1.0 / 13
      var t = 0.0
      while t <= 1 {
        turnedLeft = rotateAround(sub(point, offset), point, fixedPi * t)
        leftPoints.append(turnedLeft)
        turnedRight = rotateAround(add(point, offset), point, fixedPi * -t)
        rightPoints.append(turnedRight)
        t += step
      }
      previousLeft = turnedLeft
      previousRight = turnedRight
      if isNextPointSharpCorner { isPrevPointSharpCorner = true }
      continue
    }
    isPrevPointSharpCorner = false
    if i == points.count - 1 {
      let offset = mul(per(vector), radius)
      leftPoints.append(sub(point, offset))
      rightPoints.append(add(point, offset))
      continue
    }
    let offset = mul(per(lerp(nextVector, vector, nextDot)), radius)
    let left = sub(point, offset)
    if i <= 1 || distanceSquared(previousLeft, left) > minDistance {
      leftPoints.append(left)
      previousLeft = left
    }
    let right = add(point, offset)
    if i <= 1 || distanceSquared(previousRight, right) > minDistance {
      rightPoints.append(right)
      previousRight = right
    }
    previousPressure = pressure
    previousVector = vector
  }

  let firstPoint = points[0].point
  let lastPoint =
    points.count > 1 ? points[points.count - 1].point : add(points[0].point, Point2D(1, 1))
  var startCap: [Point2D] = []
  var endCap: [Point2D] = []
  if points.count == 1 {
    let start = project(firstPoint, unit(per(sub(firstPoint, lastPoint))), -((firstRadius ?? 0) != 0 ? firstRadius! : radius))
    var dot: [Point2D] = []
    let step = 1.0 / 13
    var t = step
    while t <= 1 {
      dot.append(rotateAround(start, firstPoint, fixedPi * 2 * t))
      t += step
    }
    return dot
  }
  if let right = rightPoints.first {
    let step = 1.0 / 13
    var t = step
    while t <= 1 {
      startCap.append(rotateAround(right, firstPoint, fixedPi * t))
      t += step
    }
  }
  let direction = per(neg(points[points.count - 1].vector))
  let start = project(lastPoint, direction, radius)
  let step = 1.0 / 29
  var t = step
  while t < 1 {
    endCap.append(rotateAround(start, lastPoint, fixedPi * 3 * t))
    t += step
  }
  return leftPoints + endCap + rightPoints.reversed() + startCap
}

func getStroke(_ input: [FreehandInput], _ options: StrokeOptions) -> [Point2D] {
  getStrokeOutlinePoints(getStrokePoints(input, options), options)
}
