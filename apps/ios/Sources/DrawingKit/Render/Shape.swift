import Foundation

// Excalidraw's `scene/Shape.ts`: the rough.js shapes each element is drawn with.

private func dashedArray(_ strokeWidth: Double) -> [Double] { [8, 8 + strokeWidth] }
private func dottedArray(_ strokeWidth: Double) -> [Double] { [1.5, 6 + strokeWidth] }

private func canChangeRoundness(_ type: String) -> Bool {
  ["rectangle", "iframe", "embeddable", "line", "diamond", "image"].contains(type)
}

private func adjustRoughness(_ element: DrawingElement) -> Double {
  let maxSize = max(element.width, element.height)
  let minSize = min(element.width, element.height)
  if (minSize >= 20 && maxSize >= 50)
    || (minSize >= 15 && element.roundness != nil && canChangeRoundness(element.type))
    || (element.isLinear && maxSize >= 50)
  {
    return element.roughness
  }
  return min(element.roughness / (maxSize < 10 ? 3 : 2), 2.5)
}

/// `isPathALoop`: a line or stroke whose ends meet is filled.
func isPathALoop(_ points: [Point2D]) -> Bool {
  guard points.count >= 3 else { return false }
  return points[0].distance(to: points[points.count - 1]) <= 8
}

/// `getCornerRadius`.
func cornerRadius(_ x: Double, _ element: DrawingElement) -> Double {
  guard let roundness = element.roundness else { return 0 }
  if roundness.type == 1 || roundness.type == 2 { return x * 0.25 }
  if roundness.type == 3 {
    let fixed = roundness.value ?? 32
    return x <= fixed / 0.25 ? x * 0.25 : fixed
  }
  return 0
}

func generateRoughOptions(_ element: DrawingElement, continuousPath: Bool = false)
  -> RoughOptions
{
  var options = RoughOptions()
  options.seed = element.seed
  switch element.strokeStyle {
  case "dashed": options.strokeLineDash = dashedArray(element.strokeWidth)
  case "dotted": options.strokeLineDash = dottedArray(element.strokeWidth)
  default: break
  }
  let solid = element.strokeStyle == "solid"
  options.disableMultiStroke = !solid
  options.strokeWidth = solid ? element.strokeWidth : element.strokeWidth + 0.5
  options.fillWeight = element.strokeWidth / 2
  options.hachureGap = element.strokeWidth * 4
  options.roughness = adjustRoughness(element)
  options.stroke = element.strokeColor
  options.preserveVertices = continuousPath || element.roughness < 2
  switch element.type {
  case "rectangle", "iframe", "embeddable", "diamond", "ellipse":
    options.fillStyle = element.fillStyle
    options.fill = isTransparentColor(element.backgroundColor) ? nil : element.backgroundColor
    if element.type == "ellipse" { options.curveFitting = 1 }
  case "line", "freedraw":
    if isPathALoop(element.points) {
      options.fillStyle = element.fillStyle
      options.fill = element.backgroundColor == "transparent" ? nil : element.backgroundColor
    }
  default: break
  }
  return options
}

/// `modifyIframeLikeForRoughOptions`, as it is when exporting.
private func iframeLikeForRoughOptions(_ element: DrawingElement) -> DrawingElement {
  guard element.type == "iframe" || element.type == "embeddable" else { return element }
  var element = element
  if isTransparentColor(element.backgroundColor) && isTransparentColor(element.strokeColor) {
    element.roughness = 0
    element.backgroundColor = "#d3d3d3"
    element.fillStyle = "solid"
  } else if element.type == "iframe" {
    if isTransparentColor(element.strokeColor) { element.strokeColor = "#000000" }
    if isTransparentColor(element.backgroundColor) { element.backgroundColor = "#f4f4f6" }
  }
  return element
}

/// `getDiamondPoints`.
func diamondPoints(_ element: DrawingElement) -> [Double] {
  let topX = (element.width / 2).rounded(.down) + 1
  let rightY = (element.height / 2).rounded(.down) + 1
  return [topX, 0, element.width, rightY, topX, element.height, 0, rightY]
}

private func n(_ value: Double) -> String { jsNumberString(value) }

/// The shape rough.js draws an element with; nil for types it doesn't draw.
func generateElementShape(_ element: DrawingElement, canvasBackgroundColor: String) -> [Drawable]? {
  switch element.type {
  case "rectangle", "iframe", "embeddable":
    let styled = iframeLikeForRoughOptions(element)
    if element.roundness != nil {
      let w = element.width
      let h = element.height
      let r = cornerRadius(min(w, h), element)
      let d =
        "M \(n(r)) 0 L \(n(w - r)) 0 Q \(n(w)) 0, \(n(w)) \(n(r)) L \(n(w)) \(n(h - r)) "
        + "Q \(n(w)) \(n(h)), \(n(w - r)) \(n(h)) L \(n(r)) \(n(h)) Q 0 \(n(h)), 0 \(n(h - r)) "
        + "L 0 \(n(r)) Q 0 0, \(n(r)) 0"
      return [RoughGenerator.path(d, generateRoughOptions(styled, continuousPath: true))]
    }
    return [
      RoughGenerator.rectangle(0, 0, element.width, element.height, generateRoughOptions(styled))
    ]
  case "diamond":
    let p = diamondPoints(element)
    let (topX, topY, rightX, rightY, bottomX, bottomY, leftX, leftY) =
      (p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7])
    if element.roundness != nil {
      let v = cornerRadius(abs(topX - leftX), element)
      let h = cornerRadius(abs(rightY - topY), element)
      let d =
        "M \(n(topX + v)) \(n(topY + h)) L \(n(rightX - v)) \(n(rightY - h)) "
        + "C \(n(rightX)) \(n(rightY)), \(n(rightX)) \(n(rightY)), \(n(rightX - v)) \(n(rightY + h)) "
        + "L \(n(bottomX + v)) \(n(bottomY - h)) "
        + "C \(n(bottomX)) \(n(bottomY)), \(n(bottomX)) \(n(bottomY)), \(n(bottomX - v)) \(n(bottomY - h)) "
        + "L \(n(leftX + v)) \(n(leftY + h)) "
        + "C \(n(leftX)) \(n(leftY)), \(n(leftX)) \(n(leftY)), \(n(leftX + v)) \(n(leftY - h)) "
        + "L \(n(topX - v)) \(n(topY + h)) "
        + "C \(n(topX)) \(n(topY)), \(n(topX)) \(n(topY)), \(n(topX + v)) \(n(topY + h))"
      return [RoughGenerator.path(d, generateRoughOptions(element, continuousPath: true))]
    }
    return [
      RoughGenerator.polygon(
        [
          Point2D(topX, topY), Point2D(rightX, rightY), Point2D(bottomX, bottomY),
          Point2D(leftX, leftY),
        ], generateRoughOptions(element))
    ]
  case "ellipse":
    return [
      RoughGenerator.ellipse(
        element.width / 2, element.height / 2, element.width, element.height,
        generateRoughOptions(element))
    ]
  case "line", "arrow":
    var options = generateRoughOptions(element)
    let points = element.points.isEmpty ? [Point2D(0, 0)] : element.points
    var shape: [Drawable]
    if element.isElbowArrow {
      if points.contains(where: { abs($0.x) > 1e6 || abs($0.y) > 1e6 }) {
        shape = []
      } else {
        shape = [
          RoughGenerator.path(
            elbowArrowPath(points, radius: 16), generateRoughOptions(element, continuousPath: true))
        ]
      }
    } else if element.roundness == nil {
      shape = [
        options.fill != nil
          ? RoughGenerator.polygon(points, options) : RoughGenerator.linearPath(points, options)
      ]
    } else {
      shape = [RoughGenerator.curve(points, options)]
    }
    if element.type == "arrow" {
      if let head = element.startArrowhead {
        shape += arrowheadShapes(
          element, shape, .start, head, &options, canvasBackgroundColor: canvasBackgroundColor)
      }
      if let head = element.endArrowhead {
        shape += arrowheadShapes(
          element, shape, .end, head, &options, canvasBackgroundColor: canvasBackgroundColor)
      }
    }
    return shape
  case "freedraw":
    guard isPathALoop(element.points) else { return nil }
    var options = generateRoughOptions(element)
    options.stroke = "none"
    return [RoughGenerator.curve(simplifyPoints(element.points, 0.75), options)]
  default:
    return nil
  }
}

private func elbowArrowPath(_ points: [Point2D], radius: Double) -> String {
  func isHorizontal(_ p: Point2D, _ o: Point2D) -> Bool {
    let x = p.x - o.x
    let y = p.y - o.y
    return x > abs(y) || x <= -abs(y)
  }
  var subpoints: [Point2D] = []
  if points.count > 2 {
    for i in 1..<(points.count - 1) {
      let prev = points[i - 1]
      let next = points[i + 1]
      let point = points[i]
      let corner = min(radius, point.distance(to: next) / 2, point.distance(to: prev) / 2)
      if isHorizontal(point, prev) {
        subpoints.append(Point2D(prev.x < point.x ? point.x - corner : point.x + corner, point.y))
      } else {
        subpoints.append(Point2D(point.x, prev.y < point.y ? point.y - corner : point.y + corner))
      }
      subpoints.append(point)
      if isHorizontal(next, point) {
        subpoints.append(Point2D(next.x < point.x ? point.x - corner : point.x + corner, point.y))
      } else {
        subpoints.append(Point2D(point.x, next.y < point.y ? point.y - corner : point.y + corner))
      }
    }
  }
  var d = ["M \(n(points[0].x)) \(n(points[0].y))"]
  var i = 0
  while i < subpoints.count {
    d.append("L \(n(subpoints[i].x)) \(n(subpoints[i].y))")
    d.append(
      "Q \(n(subpoints[i + 1].x)) \(n(subpoints[i + 1].y)), \(n(subpoints[i + 2].x)) \(n(subpoints[i + 2].y))"
    )
    i += 3
  }
  let last = points[points.count - 1]
  d.append("L \(n(last.x)) \(n(last.y))")
  return d.joined(separator: " ")
}

enum ArrowEnd { case start, end }

/// `getCurvePathOps`: the ops of the stroke, not of the fill.
func curvePathOps(_ drawable: Drawable?) -> [RoughOp] {
  guard let drawable else { return [] }
  if let set = drawable.sets.first(where: { $0.kind == .path }) { return set.ops }
  return drawable.sets.first?.ops ?? []
}

private func arrowheadSize(_ head: String) -> Double {
  switch head {
  case "arrow": 25
  case "diamond", "diamond_outline": 12
  case "crowfoot_many", "crowfoot_one", "crowfoot_one_or_many": 20
  default: 15
  }
}

private func arrowheadAngle(_ head: String) -> Double {
  switch head {
  case "bar": 90
  case "arrow": 20
  default: 25
  }
}

/// `getArrowheadPoints`.
func arrowheadPoints(
  _ element: DrawingElement, _ shape: [Drawable], _ position: ArrowEnd, _ head: String
) -> [Double]? {
  guard let first = shape.first else { return nil }
  let ops = curvePathOps(first)
  guard !ops.isEmpty else { return nil }
  let index = position == .start ? 1 : ops.count - 1
  let data = ops[index].data
  guard data.count == 6 else { return nil }
  let p3 = Point2D(data[4], data[5])
  let p2 = Point2D(data[2], data[3])
  let p1 = Point2D(data[0], data[1])
  let prevOp = ops[index - 1]
  var p0 = Point2D(0, 0)
  if prevOp.kind == .move {
    p0 = Point2D(prevOp.data[0], prevOp.data[1])
  } else if prevOp.kind == .bcurveTo {
    p0 = Point2D(prevOp.data[4], prevOp.data[5])
  }
  func equation(_ t: Double, _ x: KeyPath<Point2D, Double>) -> Double {
    pow(1 - t, 3) * p3[keyPath: x] + 3 * t * pow(1 - t, 2) * p2[keyPath: x]
      + 3 * pow(t, 2) * (1 - t) * p1[keyPath: x] + p0[keyPath: x] * pow(t, 3)
  }
  let end = position == .start ? p0 : p3
  let (x2, y2) = (end.x, end.y)
  let x1 = equation(0.3, \.x)
  let y1 = equation(0.3, \.y)
  let distance = hypot(x2 - x1, y2 - y1)
  let nx = (x2 - x1) / distance
  let ny = (y2 - y1) / distance
  let size = arrowheadSize(head)
  let points = element.points
  let tip = position == .end ? points[points.count - 1] : points[0]
  let before =
    points.count > 1 ? (position == .end ? points[points.count - 2] : points[1]) : Point2D(0, 0)
  let length = hypot(tip.x - before.x, tip.y - before.y)
  let lengthMultiplier = head == "diamond" || head == "diamond_outline" ? 0.25 : 0.5
  let minSize = min(size, length * lengthMultiplier)
  let xs = x2 - nx * minSize
  let ys = y2 - ny * minSize
  if head == "dot" || head == "circle" || head == "circle_outline" {
    return [x2, y2, hypot(ys - y2, xs - x2) + element.strokeWidth - 2]
  }
  let angle = arrowheadAngle(head)
  if head == "crowfoot_many" || head == "crowfoot_one_or_many" {
    let p3 = Point2D(x2, y2).rotated(around: Point2D(xs, ys), by: -angle * Double.pi / 180)
    let p4 = Point2D(x2, y2).rotated(around: Point2D(xs, ys), by: angle * Double.pi / 180)
    return [xs, ys, p3.x, p3.y, p4.x, p4.y]
  }
  let p3r = Point2D(xs, ys).rotated(around: Point2D(x2, y2), by: (-angle * Double.pi) / 180)
  let p4r = Point2D(xs, ys).rotated(around: Point2D(x2, y2), by: angle * Double.pi / 180)
  if head == "diamond" || head == "diamond_outline" {
    let o: Point2D
    if position == .start {
      let p = points.count > 1 ? points[1] : Point2D(0, 0)
      o = Point2D(x2 + minSize * 2, y2).rotated(
        around: Point2D(x2, y2), by: atan2(p.y - y2, p.x - x2))
    } else {
      let p = points.count > 1 ? points[points.count - 2] : Point2D(0, 0)
      o = Point2D(x2 - minSize * 2, y2).rotated(
        around: Point2D(x2, y2), by: atan2(y2 - p.y, x2 - p.x))
    }
    return [x2, y2, p3r.x, p3r.y, o.x, o.y, p4r.x, p4r.y]
  }
  return [x2, y2, p3r.x, p3r.y, p4r.x, p4r.y]
}

/// `getArrowheadShapes`, which changes `options` for the heads after it as the
/// web's does.
private func arrowheadShapes(
  _ element: DrawingElement, _ shape: [Drawable], _ position: ArrowEnd, _ head: String,
  _ options: inout RoughOptions, canvasBackgroundColor: String
) -> [Drawable] {
  guard let p = arrowheadPoints(element, shape, position, head) else { return [] }
  func crowfootOne(_ p: [Double]?, _ options: RoughOptions) -> [Drawable] {
    guard let p else { return [] }
    return [RoughGenerator.line(p[2], p[3], p[4], p[5], options)]
  }
  switch head {
  case "dot", "circle", "circle_outline":
    options.strokeLineDash = nil
    var circle = options
    circle.fill = head == "circle_outline" ? canvasBackgroundColor : element.strokeColor
    circle.fillStyle = "solid"
    circle.stroke = element.strokeColor
    circle.roughness = min(0.5, options.roughness)
    return [RoughGenerator.circle(p[0], p[1], p[2], circle)]
  case "triangle", "triangle_outline":
    options.strokeLineDash = nil
    var triangle = options
    triangle.fill = head == "triangle_outline" ? canvasBackgroundColor : element.strokeColor
    triangle.fillStyle = "solid"
    triangle.roughness = min(1, options.roughness)
    return [
      RoughGenerator.polygon(
        [Point2D(p[0], p[1]), Point2D(p[2], p[3]), Point2D(p[4], p[5]), Point2D(p[0], p[1])],
        triangle)
    ]
  case "diamond", "diamond_outline":
    options.strokeLineDash = nil
    var diamond = options
    diamond.fill = head == "diamond_outline" ? canvasBackgroundColor : element.strokeColor
    diamond.fillStyle = "solid"
    diamond.roughness = min(1, options.roughness)
    return [
      RoughGenerator.polygon(
        [
          Point2D(p[0], p[1]), Point2D(p[2], p[3]), Point2D(p[4], p[5]), Point2D(p[6], p[7]),
          Point2D(p[0], p[1]),
        ], diamond)
    ]
  case "crowfoot_one":
    return crowfootOne(p, options)
  default:
    if element.strokeStyle == "dotted" {
      let dash = dottedArray(element.strokeWidth - 1)
      options.strokeLineDash = [dash[0], dash[1] - 1]
    } else {
      options.strokeLineDash = nil
    }
    options.roughness = min(1, options.roughness)
    var result = [
      RoughGenerator.line(p[2], p[3], p[0], p[1], options),
      RoughGenerator.line(p[4], p[5], p[0], p[1], options),
    ]
    if head == "crowfoot_one_or_many" {
      result += crowfootOne(arrowheadPoints(element, shape, position, "crowfoot_one"), options)
    }
    return result
  }
}

/// `RoughCanvas.draw`.
func drawRough(_ drawable: Drawable, on canvas: Canvas2D) {
  let o = drawable.options
  for set in drawable.sets {
    switch set.kind {
    case .path:
      canvas.save()
      canvas.strokeStyle = o.stroke == "none" ? "transparent" : o.stroke
      canvas.lineWidth = o.strokeWidth
      if let dash = o.strokeLineDash { canvas.setLineDash(dash) }
      drawOps(set, on: canvas, rule: .nonzero)
      canvas.restore()
    case .fillPath:
      canvas.save()
      canvas.fillStyle = o.fill ?? ""
      let evenOdd = ["curve", "polygon", "path"].contains(drawable.shape)
      drawOps(set, on: canvas, rule: evenOdd ? .evenodd : .nonzero)
      canvas.restore()
    case .fillSketch:
      canvas.save()
      if let dash = o.fillLineDash { canvas.setLineDash(dash) }
      canvas.strokeStyle = o.fill ?? ""
      canvas.lineWidth = o.fillWeight < 0 ? o.strokeWidth / 2 : o.fillWeight
      drawOps(set, on: canvas, rule: .nonzero)
      canvas.restore()
    }
  }
}

private func drawOps(_ set: RoughOpSet, on canvas: Canvas2D, rule: FillRule) {
  canvas.beginPath()
  for op in set.ops {
    let d = op.data
    switch op.kind {
    case .move: canvas.moveTo(d[0], d[1])
    case .bcurveTo: canvas.bezierCurveTo(d[0], d[1], d[2], d[3], d[4], d[5])
    case .lineTo: canvas.lineTo(d[0], d[1])
    }
  }
  if set.kind == .fillPath {
    canvas.fill(rule)
  } else {
    canvas.stroke()
  }
}
