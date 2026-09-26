import Foundation

/// rough.js's `RoughGenerator`, for the shapes Excalidraw asks it for. Each
/// call starts from its own copy of the options, as `Object.assign` makes one.
enum RoughGenerator {
  static func line(
    _ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double, _ options: RoughOptions
  ) -> Drawable {
    var o = options
    return Drawable(shape: "line", sets: [roughLine(x1, y1, x2, y2, &o)], options: o)
  }

  static func rectangle(
    _ x: Double, _ y: Double, _ width: Double, _ height: Double, _ options: RoughOptions
  ) -> Drawable {
    var o = options
    var sets: [RoughOpSet] = []
    let outline = roughRectangle(x, y, width, height, &o)
    if o.fill != nil {
      let points = [
        Point2D(x, y), Point2D(x + width, y), Point2D(x + width, y + height),
        Point2D(x, y + height),
      ]
      sets.append(fill([points], &o))
    }
    if o.stroke != "none" { sets.append(outline) }
    return Drawable(shape: "rectangle", sets: sets, options: o)
  }

  static func ellipse(
    _ x: Double, _ y: Double, _ width: Double, _ height: Double, _ options: RoughOptions
  ) -> Drawable {
    var o = options
    var sets: [RoughOpSet] = []
    let params = generateEllipseParams(width, height, &o)
    let response = ellipseWithParams(x, y, &o, params)
    if o.fill != nil {
      if o.fillStyle == "solid" {
        var shape = ellipseWithParams(x, y, &o, params).opset
        shape.kind = .fillPath
        sets.append(shape)
      } else {
        sets.append(patternFillPolygons([response.estimatedPoints], &o))
      }
    }
    if o.stroke != "none" { sets.append(response.opset) }
    return Drawable(shape: "ellipse", sets: sets, options: o)
  }

  static func circle(_ x: Double, _ y: Double, _ diameter: Double, _ options: RoughOptions)
    -> Drawable
  {
    var drawable = ellipse(x, y, diameter, diameter, options)
    drawable.shape = "circle"
    return drawable
  }

  static func linearPath(_ points: [Point2D], _ options: RoughOptions) -> Drawable {
    var o = options
    return Drawable(
      shape: "linearPath", sets: [roughLinearPath(points, close: false, &o)], options: o)
  }

  static func curve(_ points: [Point2D], _ options: RoughOptions) -> Drawable {
    var o = options
    var sets: [RoughOpSet] = []
    let outline = roughCurve(points, &o)
    if let fill = o.fill, fill != "none", points.count >= 3 {
      if o.fillStyle == "solid" {
        var fillOptions = o
        fillOptions.disableMultiStroke = true
        fillOptions.roughness = o.roughness != 0 ? o.roughness + o.fillShapeRoughnessGain : 0
        let shape = roughCurve(points, &fillOptions)
        sets.append(RoughOpSet(kind: .fillPath, ops: mergedShape(shape.ops)))
      } else {
        let bezier = curveToBezier(points)
        let polygon = pointsOnBezierCurves(bezier, tolerance: 10, distance: (1 + o.roughness) / 2)
        sets.append(patternFillPolygons([polygon], &o))
      }
    }
    if o.stroke != "none" { sets.append(outline) }
    return Drawable(shape: "curve", sets: sets, options: o)
  }

  static func polygon(_ points: [Point2D], _ options: RoughOptions) -> Drawable {
    var o = options
    var sets: [RoughOpSet] = []
    let outline = roughLinearPath(points, close: true, &o)
    if o.fill != nil { sets.append(fill([points], &o)) }
    if o.stroke != "none" { sets.append(outline) }
    return Drawable(shape: "polygon", sets: sets, options: o)
  }

  static func path(_ d: String, _ options: RoughOptions) -> Drawable {
    var o = options
    var sets: [RoughOpSet] = []
    guard !d.isEmpty else { return Drawable(shape: "path", sets: sets, options: o) }
    let path = d.replacingOccurrences(of: "\n", with: " ")
      .replacingOccurrences(of: "- ", with: "-")
    let hasFill = o.fill != nil && o.fill != "transparent" && o.fill != "none"
    let polygons = pointsOnPath(path, tolerance: 1, distance: (1 + o.roughness) / 2)
    let shape = svgPath(path, &o)
    if hasFill {
      if o.fillStyle == "solid" {
        if polygons.count == 1 {
          var fillOptions = o
          fillOptions.disableMultiStroke = true
          fillOptions.roughness = o.roughness != 0 ? o.roughness + o.fillShapeRoughnessGain : 0
          let fillShape = svgPath(path, &fillOptions)
          sets.append(RoughOpSet(kind: .fillPath, ops: mergedShape(fillShape.ops)))
        } else {
          sets.append(solidFillPolygon(polygons, &o))
        }
      } else {
        sets.append(patternFillPolygons(polygons, &o))
      }
    }
    if o.stroke != "none" { sets.append(shape) }
    return Drawable(shape: "path", sets: sets, options: o)
  }

  private static func fill(_ polygons: [[Point2D]], _ o: inout RoughOptions) -> RoughOpSet {
    o.fillStyle == "solid" ? solidFillPolygon(polygons, &o) : patternFillPolygons(polygons, &o)
  }

  private static func mergedShape(_ ops: [RoughOp]) -> [RoughOp] {
    ops.enumerated().filter { $0.offset == 0 || $0.element.kind != .move }.map(\.element)
  }
}
