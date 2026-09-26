import Foundation

/// `DEFAULT_COLLISION_THRESHOLD`: how near an outline a press still hits it.
private let collisionThreshold = 2 * 4 - 1e-5

/// `transformHandleSizes`: a finger gets larger handles than a pencil, and
/// a pencil larger ones than a mouse.
private func handleSize(_ pointer: PointerKind) -> Double {
  switch pointer {
  case .mouse: 8
  case .pen: 16
  case .touch: 28
  }
}

/// `normalizeRadians`.
func normalizeRadians(_ angle: Double) -> Double {
  if angle < 0 { return angle.truncatingRemainder(dividingBy: 2 * .pi) + 2 * .pi }
  if angle >= 2 * .pi { return angle.truncatingRemainder(dividingBy: 2 * .pi) }
  return angle
}

/// `rescalePoints`.
private func rescalePoints(_ dimension: KeyPath<Point2D, Double>, _ size: Double, _ points: [Point2D], normalize: Bool)
  -> [Point2D]
{
  let coordinates = points.map { $0[keyPath: dimension] }
  let span = (coordinates.max() ?? 0) - (coordinates.min() ?? 0)
  let scale = span == 0 ? 1 : size / span
  let writable = dimension == \Point2D.x ? \Point2D.x : \Point2D.y
  var nextMin = Double.infinity
  let scaled = points.map { point in
    var p = point
    p[keyPath: writable] = point[keyPath: dimension] * scale
    nextMin = min(nextMin, p[keyPath: writable])
    return p
  }
  guard normalize, scaled.count != 2 else { return scaled }
  let translation = (coordinates.min() ?? 0) - nextMin
  return scaled.map { point in
    var p = point
    p[keyPath: writable] += translation
    return p
  }
}

func rescaled(_ points: [Point2D], width: Double, height: Double, normalize: Bool) -> [Point2D] {
  rescalePoints(\.x, width, rescalePoints(\.y, height, points, normalize: normalize), normalize: normalize)
}

/// A shape a press is tested against, in scene coordinates.
private enum HitShape {
  case polygon([Point2D])
  case polyline([Point2D], closed: Bool)
  case ellipse(center: Point2D, a: Double, b: Double, angle: Double)
}

private func distance(_ p: Point2D, toSegment a: Point2D, _ b: Point2D) -> Double {
  let dx = b.x - a.x
  let dy = b.y - a.y
  let length = dx * dx + dy * dy
  let t = length == 0 ? 0 : max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

private func contains(_ polygon: [Point2D], _ p: Point2D) -> Bool {
  var inside = false
  var j = polygon.count - 1
  for i in polygon.indices {
    let a = polygon[i]
    let b = polygon[j]
    if (a.y > p.y) != (b.y > p.y), p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
      inside.toggle()
    }
    j = i
  }
  return inside
}

extension HitShape {
  /// `isPointInShape`.
  func contains(_ p: Point2D) -> Bool {
    switch self {
    case .polygon(let points), .polyline(let points, closed: true):
      return DrawingKit.contains(points, p)
    case .polyline:
      return false
    case .ellipse(let center, let a, let b, let angle):
      let q = p.rotated(around: center, by: -angle)
      let x = (q.x - center.x) / a
      let y = (q.y - center.y) / b
      return x * x + y * y <= 1
    }
  }

  /// `isPointOnShape`: within `tolerance` of the outline.
  func isNear(_ p: Point2D, _ tolerance: Double) -> Bool {
    switch self {
    case .polygon(let points):
      return zip(points, points.dropFirst() + points.prefix(1)).contains {
        distance(p, toSegment: $0, $1) <= tolerance
      }
    case .polyline(let points, let closed):
      let ends = closed ? points.dropFirst() + points.prefix(1) : points.dropFirst()
      return zip(points, ends).contains { distance(p, toSegment: $0, $1) <= tolerance }
    case .ellipse(let center, let a, let b, let angle):
      // The nearest point on the ellipse, found as Excalidraw finds it.
      let q = p.rotated(around: center, by: -angle)
      let px = q.x - center.x
      let py = q.y - center.y
      var tx = 0.707
      var ty = 0.707
      for _ in 0..<3 {
        let x = a * tx
        let y = b * ty
        let ex = (a * a - b * b) * pow(tx, 3) / a
        let ey = (b * b - a * a) * pow(ty, 3) / b
        let r = hypot(y - ey, x - ex)
        let qx = abs(px) - ex
        let qy = abs(py) - ey
        let qd = hypot(qy, qx)
        tx = min(1, max(0, (qx * r / qd + ex) / a))
        ty = min(1, max(0, (qy * r / qd + ey) / b))
        let t = hypot(ty, tx)
        tx /= t
        ty /= t
      }
      let nearest = Point2D(a * tx * (px < 0 ? -1 : 1), b * ty * (py < 0 ? -1 : 1))
      return hypot(px - nearest.x, py - nearest.y) <= tolerance
    }
  }
}

extension DrawingEditor {
  var threshold: Double { collisionThreshold / zoom }

  /// The geometry of the elements as the web holds it while editing: every
  /// shape has been drawn, so lines measure by their curves.
  func makeGeometry() -> SceneGeometry { makeGeometry(of: store) }

  func makeGeometry(of elements: [RawElement]) -> SceneGeometry {
    let restored = restoreElements(elements.filter { !$0.isDeleted }.map(JSONValue.object))
    let geometry = SceneGeometry(
      elements: Dictionary(restored.map { ($0.id, $0) }, uniquingKeysWith: { $1 }),
      canvasBackgroundColor: "#ffffff")
    for element in restored where element.isLinear { geometry.generateShape(element) }
    return geometry
  }

  // MARK: Hitting elements

  /// `shouldTestInside`: whether a press inside, not only on the outline,
  /// hits the element.
  private func testsInside(_ element: DrawingElement) -> Bool {
    if element.type == .arrow { return false }
    let fromInside =
      !isTransparentColor(element.backgroundColor) || element.boundTextId != nil
      || [.iframe, .embeddable, .text].contains(element.type)
    if element.type == .line || element.type == .freedraw {
      return fromInside && isPathALoop(element.points)
    }
    return fromInside || element.type == .image
  }

  /// `getElementShape`.
  private func shape(_ element: DrawingElement, _ geometry: SceneGeometry) -> HitShape {
    let c = geometry.absoluteCoords(element)
    let center = Point2D(c.cx, c.cy)
    switch element.type {
    case .ellipse:
      return .ellipse(
        center: Point2D(element.x + element.width / 2, element.y + element.height / 2),
        a: element.width / 2, b: element.height / 2, angle: element.angle)
    case .line, .arrow:
      var points: [Point2D] = []
      var current = Point2D(0, 0)
      for op in curvePathOps(geometry.generateShape(element)?.first) {
        let d = op.data
        switch op.kind {
        case .move:
          current = Point2D(d[0], d[1])
          points.append(current)
        case .lineTo:
          current = Point2D(d[0], d[1])
          points.append(current)
        case .bcurveTo:
          let (p0, p1, p2, p3) = (current, Point2D(d[0], d[1]), Point2D(d[2], d[3]), Point2D(d[4], d[5]))
          for step in 1...10 {
            let t = Double(step) / 10
            let u = 1 - t
            points.append(
              Point2D(
                u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
                u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y))
          }
          current = p3
        }
      }
      let scene = points.map {
        Point2D($0.x + element.x, $0.y + element.y).rotated(around: center, by: element.angle)
      }
      return .polyline(scene, closed: testsInside(element))
    case .freedraw:
      let scene = element.points.map {
        Point2D($0.x + element.x, $0.y + element.y).rotated(around: center, by: element.angle)
      }
      return .polyline(scene, closed: testsInside(element))
    case .diamond:
      let d = diamondPoints(element)
      let corners = stride(from: 0, to: 8, by: 2).map {
        Point2D(d[$0] + element.x, d[$0 + 1] + element.y).rotated(around: center, by: element.angle)
      }
      return .polygon(corners)
    case .rectangle, .text, .image, .frame, .magicframe, .iframe, .embeddable:
      return .polygon(
        [Point2D(c.x1, c.y1), Point2D(c.x2, c.y1), Point2D(c.x2, c.y2), Point2D(c.x1, c.y2)].map {
          $0.rotated(around: center, by: element.angle)
        })
    }
  }

  /// `hitElementItself`.
  func hitsItself(_ p: Point2D, _ element: DrawingElement, _ geometry: SceneGeometry, threshold: Double)
    -> Bool
  {
    let shape = shape(element, geometry)
    return (testsInside(element) && shape.contains(p)) || shape.isNear(p, threshold)
  }

  /// `isPointOnShape`.
  func isOnOutline(_ p: Point2D, _ element: DrawingElement, _ geometry: SceneGeometry, tolerance: Double) -> Bool {
    shape(element, geometry).isNear(p, tolerance)
  }

  func selectionBox(_ element: DrawingElement, _ geometry: SceneGeometry, padding: Double) -> [Point2D] {
    let c = geometry.absoluteCoords(element)
    let center = Point2D(c.cx, c.cy)
    return [
      Point2D(c.x1 - padding, c.y1 - padding), Point2D(c.x2 + padding, c.y1 - padding),
      Point2D(c.x2 + padding, c.y2 + padding), Point2D(c.x1 - padding, c.y2 + padding),
    ].map { $0.rotated(around: center, by: element.angle) }
  }

  /// Whether the selection box of `element` is drawn: not for a line of two
  /// points, which shows its points instead.
  func showsBoundingBox(_ element: DrawingElement) -> Bool {
    !(element.isLinear && element.points.count <= 2)
  }

  /// `App.hitElement`: the outline, or inside a selected element's box, or
  /// the text it holds.
  private func hits(_ p: Point2D, _ element: DrawingElement, _ geometry: SceneGeometry) -> Bool {
    if selectedIds.contains(element.id), showsBoundingBox(element),
      DrawingKit.contains(
        selectionBox(element, geometry, padding: element.type == .image ? 0 : threshold), p)
    {
      return true
    }
    if let text = geometry.boundText(of: element), element.type != .arrow,
      shape(text, geometry).contains(p)
    {
      return true
    }
    return hitsItself(p, element, geometry, threshold: threshold)
  }

  /// `getElementsAtPosition`, bottom to top.
  func elementsAt(_ p: Point2D, includingBoundText: Bool = false) -> [String] {
    let geometry = makeGeometry()
    let hit = store.compactMap { raw -> DrawingElement? in
      guard !raw.isDeleted, raw["locked"]?.boolValue != true,
        includingBoundText || raw.type != .text || raw["containerId"]?.stringValue == nil,
        let element = geometry.elements[raw.id], hits(p, element, geometry)
      else { return nil }
      return element
    }
    return (hit.filter { $0.type != .iframe } + hit.filter { $0.type == .iframe }).map(\.id)
  }

  /// `getElementAtPosition`: the topmost element hit, unless the press only
  /// grazes it and hits the one below.
  func elementAt(_ p: Point2D, includingBoundText: Bool = false) -> String? {
    let all = elementsAt(p, includingBoundText: includingBoundText)
    guard all.count > 1 else { return all.first }
    let geometry = makeGeometry()
    guard let top = geometry.elements[all[all.count - 1]] else { return nil }
    return hitsItself(p, top, geometry, threshold: threshold / 2) ? top.id : all[all.count - 2]
  }

  /// `isHittingCommonBoundingBoxOfSelectedElements`.
  func hitsCommonBounds(_ p: Point2D) -> Bool {
    let selected = selectedElements
    guard selected.count >= 2 else { return false }
    let geometry = makeGeometry()
    let b = geometry.commonBounds(selected.compactMap { geometry.elements[$0.id] })
    return p.x > b.minX - threshold && p.x < b.maxX + threshold && p.y > b.minY - threshold
      && p.y < b.maxY + threshold
  }

  /// `hitElementBoundingBoxOnly`: inside the element's box but not on it.
  func hitsBoundingBoxOnly(_ id: String, _ p: Point2D) -> Bool {
    let geometry = makeGeometry()
    guard let element = geometry.elements[id] else { return false }
    if hitsItself(p, element, geometry, threshold: threshold) { return false }
    if let text = geometry.boundText(of: element), shape(text, geometry).contains(p) { return false }
    let b = geometry.bounds(element)
    return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY
  }

  // MARK: Handles

  /// `getTransformHandles`, as the web lays them out on an iPad: every side
  /// has a handle, and there is no resizing from the edges between them.
  public func transformHandles(of id: String, pointer: PointerKind) -> [String: Bounds] {
    let geometry = makeGeometry()
    guard let element = geometry.elements[id], !element.locked, !element.isElbowArrow else { return [:] }
    var omit: Set<String> = []
    if element.type == .freedraw || element.isLinear, element.points.count == 2 {
      let p1 = element.points[1]
      omit = ["e", "s", "n", "w"]
      if (p1.x > 0 && p1.y < 0) || (p1.x < 0 && p1.y > 0) { omit.formUnion(["nw", "se"]) }
    } else if element.isFrameLike {
      omit.insert("rotation")
    }
    let margin = element.isLinear ? 2.0 + 8 : element.type == .image ? 0 : 2
    let spacing = element.type == .image ? 0.0 : 2
    var handles = handlesAround(
      geometry.absoluteCoords(element), angle: element.angle, margin: margin, spacing: spacing, pointer: pointer)
    for key in omit { handles[key] = nil }
    return handles
  }

  /// `getTransformHandlesFromCoords`.
  private func handlesAround(
    _ c: AbsoluteCoords, angle: Double, margin: Double, spacing: Double, pointer: PointerKind
  ) -> [String: Bounds] {
    let size = handleSize(pointer)
    let handle = size / zoom
    let dashedLineMargin = margin / zoom
    let centering = (size - spacing * 2) / (2 * zoom)
    let center = Point2D(c.cx, c.cy)
    func place(_ x: Double, _ y: Double) -> Bounds {
      let middle = Point2D(x + handle / 2, y + handle / 2).rotated(around: center, by: angle)
      return Bounds(
        minX: middle.x - handle / 2, minY: middle.y - handle / 2, maxX: middle.x + handle / 2,
        maxY: middle.y + handle / 2)
    }
    let width = c.x2 - c.x1
    let height = c.y2 - c.y1
    let left = c.x1 - dashedLineMargin - handle + centering
    let right = c.x2 + dashedLineMargin - centering
    let top = c.y1 - dashedLineMargin - handle + centering
    let bottom = c.y2 + dashedLineMargin - centering
    var handles: [String: Bounds] = [
      "nw": place(left, top), "ne": place(right, top), "sw": place(left, bottom),
      "se": place(right, bottom),
      "rotation": place(c.x1 + width / 2 - handle / 2, top - 16 / zoom),
    ]
    let eight = 5 * 8 / zoom
    if abs(width) > eight {
      handles["n"] = place(c.x1 + width / 2 - handle / 2, top)
      handles["s"] = place(c.x1 + width / 2 - handle / 2, bottom)
    }
    if abs(height) > eight {
      handles["w"] = place(left, c.y1 + height / 2 - handle / 2)
      handles["e"] = place(right, c.y1 + height / 2 - handle / 2)
    }
    return handles
  }

  /// The common box of what is selected, when that is more than one
  /// element.
  func selectionBounds() -> Bounds? {
    let selected = selectedElements
    guard selected.count > 1 else { return nil }
    let geometry = makeGeometry()
    return geometry.commonBounds(selected.compactMap { geometry.elements[$0.id] })
  }

  /// The handles round a selection of several elements, which never turn.
  public func selectionHandles(pointer: PointerKind) -> [String: Bounds] {
    guard let b = selectionBounds() else { return [:] }
    let c = AbsoluteCoords(
      x1: b.minX, y1: b.minY, x2: b.maxX, y2: b.maxY, cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2)
    return handlesAround(c, angle: 0, margin: 4, spacing: 2, pointer: pointer)
  }

  /// `getTransformHandleTypeFromCoords`: the handle of a selection of
  /// several elements under a press.
  func selectionHandle(at p: Point2D, pointer: PointerKind) -> String? {
    let handles = selectionHandles(pointer: pointer)
    return ["nw", "ne", "sw", "se", "rotation", "n", "s", "w", "e"].first { key in
      handles[key].map { p.x >= $0.minX && p.x <= $0.maxX && p.y >= $0.minY && p.y <= $0.maxY } ?? false
    }
  }

  /// `resizeTest`: the handle of the selected element under a press.
  func transformHandle(at p: Point2D, of element: RawElement, pointer: PointerKind) -> String? {
    let handles = transformHandles(of: element.id, pointer: pointer)
    func inside(_ b: Bounds) -> Bool { p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY }
    if let rotation = handles["rotation"], inside(rotation) { return "rotation" }
    return ["nw", "ne", "sw", "se", "n", "s", "w", "e"].first { handles[$0].map(inside) ?? false }
  }

  /// `getResizeOffsetXY`: how far the press is from the corner or side it
  /// drags, so the element doesn't jump to the finger.
  func resizeOffset(_ handle: String, _ raw: RawElement, _ p: Point2D) -> Point2D {
    let geometry = makeGeometry()
    guard let element = geometry.elements[raw.id] else { return Point2D(0, 0) }
    let c = geometry.absoluteCoords(element)
    let angle = element.angle
    let q = p.rotated(around: Point2D((c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2), by: -angle)
    let origin = Point2D(0, 0)
    let midX = (c.x1 + c.x2) / 2
    let midY = (c.y1 + c.y2) / 2
    let offset: Point2D =
      switch handle {
      case "n": Point2D(q.x - midX, q.y - c.y1)
      case "s": Point2D(q.x - midX, q.y - c.y2)
      case "w": Point2D(q.x - c.x1, q.y - midY)
      case "e": Point2D(q.x - c.x2, q.y - midY)
      case "nw": Point2D(q.x - c.x1, q.y - c.y1)
      case "ne": Point2D(q.x - c.x2, q.y - c.y1)
      case "sw": Point2D(q.x - c.x1, q.y - c.y2)
      case "se": Point2D(q.x - c.x2, q.y - c.y2)
      default: origin
      }
    return offset.rotated(around: origin, by: angle)
  }

  // MARK: Transforming

  /// `rotateSingleElement`: the element turns to face the finger, and the
  /// text it holds turns with it.
  func rotate(_ gesture: Gesture, to p: Point2D) {
    if selectedElements.count > 1 { return rotateSelection(gesture, to: p) }
    guard let raw = selectedElements.first, selectedElements.count == 1 else { return }
    let geometry = makeGeometry()
    guard let element = geometry.elements[raw.id] else { return }
    let c = geometry.absoluteCoords(element)
    let cx = (c.x1 + c.x2) / 2
    let cy = (c.y1 + c.y2) / 2
    let angle = element.isFrameLike ? 0 : normalizeRadians(5 * .pi / 2 + atan2(p.y - cy, p.x - cx))
    mutate(raw.id, ["angle": .number(angle)])
    if let text = element.boundTextId, element.type != .arrow { mutate(text, ["angle": .number(angle)]) }
    updateBoundElements(of: raw.id)
  }

  /// `getResizedElementAbsoluteCoords`.
  private func resizedCoords(_ element: DrawingElement, width: Double, height: Double, normalize: Bool)
    -> (x1: Double, y1: Double, x2: Double, y2: Double)
  {
    guard element.isLinear || element.type == .freedraw else {
      return (element.x, element.y, element.x + width, element.y + height)
    }
    var copy = element
    copy.points = rescaled(element.points, width: width, height: height, normalize: normalize)
    let geometry = SceneGeometry(elements: [copy.id: copy], canvasBackgroundColor: "#ffffff")
    if copy.isLinear { geometry.generateShape(copy) }
    let c = geometry.absoluteCoords(copy)
    return (c.x1, c.y1, c.x2, c.y2)
  }

  func resize(_ gesture: Gesture, handle: String, to p: Point2D) {
    if selectedElements.count > 1 { return resizeSelection(gesture, handle: handle, to: p) }
    guard selectedElements.count == 1, let raw = selectedElements.first,
      let original = gesture.originals[raw.id]
    else { return }
    let geometry = makeGeometry()
    let originalGeometry = makeGeometry(of: Array(gesture.originals.values))
    guard let latest = geometry.elements[raw.id], let start = originalGeometry.elements[original.id]
    else { return }
    if latest.type == .text {
      if handle == "e" || handle == "w" {
        rewrapText(latest, from: start, handle: handle, to: p)
      } else {
        resizeText(latest, geometry, handle: handle, to: p)
      }
      updateBoundElements(of: raw.id)
      return
    }
    // `getNextSingleWidthAndHeightFromPointer`.
    let s = resizedCoords(start, width: start.width, height: start.height, normalize: true)
    let startCenter = Point2D((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2)
    let rotated = p.rotated(around: startCenter, by: -start.angle)
    let e = resizedCoords(latest, width: latest.width, height: latest.height, normalize: true)
    let currentWidth = e.x2 - e.x1
    let currentHeight = e.y2 - e.y1
    var scaleX = (s.x2 - s.x1) / currentWidth
    var scaleY = (s.y2 - s.y1) / currentHeight
    if handle.contains("e") { scaleX = (rotated.x - s.x1) / currentWidth }
    if handle.contains("s") { scaleY = (rotated.y - s.y1) / currentHeight }
    if handle.contains("w") { scaleX = (s.x2 - rotated.x) / currentWidth }
    if handle.contains("n") { scaleY = (s.y2 - rotated.y) / currentHeight }
    var nextWidth = latest.width * scaleX
    var nextHeight = latest.height * scaleY
    let keepsAspectRatio = latest.type == .image
    if keepsAspectRatio {
      let widthRatio = abs(nextWidth) / start.width
      let heightRatio = abs(nextHeight) / start.height
      if handle.count == 1 {
        nextHeight *= widthRatio
        nextWidth *= heightRatio
      } else {
        let ratio = max(widthRatio, heightRatio)
        nextWidth = start.width * ratio * mathSign(nextWidth)
        nextHeight = start.height * ratio * mathSign(nextHeight)
      }
    }

    // `resizeSingleElement`.
    let label = geometry.boundText(of: latest)
    if let label {
      let font = FontMetrics.fontString(size: label.fontSize, family: label.fontFamily)
      nextWidth = max(nextWidth, characterWidths.widest(font: font) + boundTextPadding * 2)
      nextHeight = max(nextHeight, label.fontSize * label.lineHeight + boundTextPadding * 2)
    }
    let points =
      latest.isLinear || latest.type == .freedraw
      ? rescaled(start.points, width: nextWidth, height: nextHeight, normalize: true) : nil
    var previousOrigin = Point2D(start.x, start.y)
    if start.isLinear {
      let b = originalGeometry.bounds(start)
      previousOrigin = Point2D(b.minX, b.minY)
    }
    var origin = resizedOrigin(
      previousOrigin, start.width, start.height, nextWidth, nextHeight, start.angle,
      anchor: resizeAnchor(handle, keepsAspectRatio: keepsAspectRatio))
    var nextPoints = points
    if start.isLinear, let scaled = points {
      origin.x += start.x - previousOrigin.x + scaled[0].x
      origin.y += start.y - previousOrigin.y + scaled[0].y
      nextPoints = scaled.map { Point2D($0.x - scaled[0].x, $0.y - scaled[0].y) }
    }
    if nextWidth < 0 { origin.x += nextWidth }
    if nextHeight < 0 { origin.y += nextHeight }
    if raw["scale"] != nil, let scale = original["scale"]?.arrayValue?.compactMap(\.numberValue),
      scale.count == 2
    {
      let sx = nextWidth > 0 ? 1.0 : nextWidth < 0 ? -1 : 0
      let sy = nextHeight > 0 ? 1.0 : nextHeight < 0 ? -1 : 0
      mutate(
        raw.id,
        ["scale": [.number((sx == 0 ? scale[0] : sx) * scale[0]), .number((sy == 0 ? scale[1] : sy) * scale[1])]])
    }
    guard nextWidth != 0, nextHeight != 0, origin.x.isFinite, origin.y.isFinite else { return }
    var updates: RawElement = [
      "x": .number(origin.x), "y": .number(origin.y), "width": .number(abs(nextWidth)),
      "height": .number(abs(nextHeight)),
    ]
    if let nextPoints { updates["points"] = .points(nextPoints) }
    mutate(raw.id, updates)
    updateBoundElements(of: raw.id, newSize: (nextWidth, nextHeight))
    if let label, let fontSize = gesture.originals[label.id]?["fontSize"] {
      mutate(label.id, ["fontSize": fontSize])
    }
    layOutLabel(of: raw.id, handle: handle)
  }

  /// `getResizeAnchor`: what stays put as a handle is dragged, which is
  /// the middle of the opposite side when a side handle keeps the aspect
  /// ratio.
  private func resizeAnchor(_ handle: String, keepsAspectRatio: Bool) -> String {
    if keepsAspectRatio, let side = ["n": "south-side", "e": "west-side", "s": "north-side", "w": "east-side"][handle] {
      return side
    }
    switch handle {
    case "e", "se", "s": return "top-left"
    case "n", "nw", "w": return "bottom-right"
    case "ne": return "bottom-left"
    default: return "top-right"
    }
  }

  /// `getResizedOrigin`, for a resize that doesn't keep the centre.
  private func resizedOrigin(
    _ origin: Point2D, _ prevWidth: Double, _ prevHeight: Double, _ newWidth: Double,
    _ newHeight: Double, _ angle: Double, anchor: String
  ) -> Point2D {
    let (x, y) = (origin.x, origin.y)
    let (c, s) = (cos(angle), sin(angle))
    switch anchor {
    case "top-left":
      return Point2D(
        x + (prevWidth - newWidth) / 2 + (newWidth - prevWidth) / 2 * c + (prevHeight - newHeight) / 2 * s,
        y + (prevHeight - newHeight) / 2 + (newWidth - prevWidth) / 2 * s + (newHeight - prevHeight) / 2 * c)
    case "bottom-right":
      return Point2D(
        x + (prevWidth - newWidth) / 2 * (c + 1) + (newHeight - prevHeight) / 2 * s,
        y + (prevHeight - newHeight) / 2 * (c + 1) + (prevWidth - newWidth) / 2 * s)
    case "bottom-left":
      return Point2D(
        x + (prevWidth - newWidth) / 2 * (1 - c) + (newHeight - prevHeight) / 2 * s,
        y + (prevHeight - newHeight) / 2 * (c + 1) + (newWidth - prevWidth) / 2 * s)
    case "east-side":
      return Point2D(
        x + (prevWidth - newWidth) / 2 * (c + 1),
        y + (prevWidth - newWidth) / 2 * s + (prevHeight - newHeight) / 2)
    case "west-side":
      return Point2D(
        x + (prevWidth - newWidth) / 2 * (1 - c),
        y + (newWidth - prevWidth) / 2 * s + (prevHeight - newHeight) / 2)
    case "north-side":
      return Point2D(
        x + (prevWidth - newWidth) / 2 + (prevHeight - newHeight) / 2 * s,
        y + (newHeight - prevHeight) / 2 * (c - 1))
    case "south-side":
      return Point2D(
        x + (prevWidth - newWidth) / 2 + (newHeight - prevHeight) / 2 * s,
        y + (prevHeight - newHeight) / 2 * (c + 1))
    default:
      return Point2D(
        x + (prevWidth - newWidth) / 2 * (c + 1) + (prevHeight - newHeight) / 2 * s,
        y + (prevHeight - newHeight) / 2 + (prevWidth - newWidth) / 2 * s + (newHeight - prevHeight) / 2 * c)
    }
  }

  /// `resizeSingleTextElement`, from a corner: the text scales, font and all.
  private func resizeText(_ element: DrawingElement, _ geometry: SceneGeometry, handle: String, to p: Point2D) {
    let c = geometry.absoluteCoords(element)
    let center = Point2D(c.cx, c.cy)
    let rotated = p.rotated(around: center, by: -element.angle)
    var scaleX = 0.0
    var scaleY = 0.0
    if handle.contains("e") { scaleX = (rotated.x - c.x1) / (c.x2 - c.x1) }
    if handle.contains("w") { scaleX = (c.x2 - rotated.x) / (c.x2 - c.x1) }
    if handle.contains("n") { scaleY = (c.y2 - rotated.y) / (c.y2 - c.y1) }
    if handle.contains("s") { scaleY = (rotated.y - c.y1) / (c.y2 - c.y1) }
    let scale = max(scaleX, scaleY)
    guard scale > 0 else { return }
    let nextWidth = element.width * scale
    let nextHeight = element.height * scale
    let fontSize = element.fontSize * (nextWidth / element.width)
    guard fontSize >= 1 else { return }
    var topLeft = Point2D(c.x1, c.y1)
    switch handle {
    case "nw": topLeft = Point2D(c.x2 - abs(nextWidth), c.y2 - abs(nextHeight))
    case "ne": topLeft = Point2D(c.x1, c.y2 - abs(nextHeight))
    case "sw": topLeft = Point2D(c.x2 - abs(nextWidth), c.y1)
    default: break
    }
    let rotatedTopLeft = topLeft.rotated(around: center, by: element.angle)
    let newCenter = Point2D(topLeft.x + abs(nextWidth) / 2, topLeft.y + abs(nextHeight) / 2)
      .rotated(around: center, by: element.angle)
    topLeft = rotatedTopLeft.rotated(around: newCenter, by: -element.angle)
    mutate(
      element.id,
      [
        "fontSize": .number(fontSize), "width": .number(nextWidth), "height": .number(nextHeight),
        "x": .number(topLeft.x), "y": .number(topLeft.y),
      ])
  }

  /// `resizeSingleTextElement` from a side: the text keeps its size and
  /// wraps to the new width, and stops growing with what is typed.
  private func rewrapText(_ element: DrawingElement, from start: DrawingElement, handle: String, to p: Point2D) {
    guard let raw = self.element(element.id) else { return }
    let s = resizedCoords(start, width: start.width, height: start.height, normalize: true)
    let startCenter = Point2D((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2)
    let rotated = p.rotated(around: startCenter, by: -start.angle)
    let currentWidth = element.width
    var scaleX = (s.x2 - s.x1) / currentWidth
    if handle.contains("e") { scaleX = (rotated.x - s.x1) / currentWidth }
    if handle.contains("w") { scaleX = (s.x2 - rotated.x) / currentWidth }
    let font = font(of: raw)
    let minWidth =
      measure("", fontSize: element.fontSize, fontFamily: element.fontFamily, lineHeight: element.lineHeight)
      .width + boundTextPadding * 2
    let width = max(element.width * scaleX, minWidth)
    let text = TextWrapping.wrap(
      raw["originalText"]?.stringValue ?? element.text, font: font, maxWidth: abs(width), widths: characterWidths)
    let height = measure(
      text, fontSize: element.fontSize, fontFamily: element.fontFamily, lineHeight: element.lineHeight
    ).height
    var topLeft = Point2D(s.x1, s.y1)
    if handle == "w" { topLeft.x = s.x2 - abs(width) }
    let rotatedTopLeft = topLeft.rotated(around: startCenter, by: start.angle)
    let newCenter = Point2D(topLeft.x + abs(width) / 2, topLeft.y + abs(height) / 2)
      .rotated(around: startCenter, by: start.angle)
    topLeft = rotatedTopLeft.rotated(around: newCenter, by: -start.angle)
    mutate(
      element.id,
      [
        "width": .number(abs(width)), "height": .number(abs(height)), "x": .number(topLeft.x),
        "y": .number(topLeft.y), "text": .string(text), "autoResize": false,
      ])
  }
}
