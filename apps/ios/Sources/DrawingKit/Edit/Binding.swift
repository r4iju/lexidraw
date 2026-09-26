import Foundation

extension ArrowEnd {
  /// The field that binds this end.
  var key: String { self == .start ? "startBinding" : "endBinding" }
}

private func bindingTarget(_ element: RawElement, _ end: ArrowEnd) -> String? {
  element[end.key]?["elementId"]?.stringValue
}

/// `isBindableElement`, on an element as stored.
private func isBindable(_ element: RawElement) -> Bool {
  switch element.type {
  case .rectangle, .diamond, .ellipse, .image, .iframe, .embeddable, .frame, .magicframe: true
  case .text: element["containerId"]?.stringValue == nil
  case .line, .arrow, .freedraw, nil: false
  }
}

/// `bindableElementsVisitor`: the elements `element` is bound to, and the
/// field that binds it.
private func bindings(of element: RawElement) -> [(key: String, id: String)] {
  var result: [(String, String)] = []
  if let frame = element["frameId"]?.stringValue, !frame.isEmpty { result.append(("frameId", frame)) }
  if element.type == .text, let container = element["containerId"]?.stringValue {
    result.append(("containerId", container))
  }
  if element.type == .arrow {
    for end in [ArrowEnd.start, .end] {
      if let id = bindingTarget(element, end) { result.append((end.key, id)) }
    }
  }
  return result
}

/// Arrows that bind to shapes and follow them, as `binding.ts` has it.
extension DrawingEditor {
  func restored(_ id: String) -> DrawingElement? { element(id).flatMap(DrawingElement.init(restoring:)) }

  /// The centre a line's points turn around: its generated curve's.
  private func linearCenter(_ element: DrawingElement) -> Point2D {
    let geometry = SceneGeometry(elements: [element.id: element], canvasBackgroundColor: "#ffffff")
    geometry.generateShape(element)
    let c = geometry.absoluteCoords(element)
    return Point2D(c.cx, c.cy)
  }

  /// `getPointAtIndexGlobalCoordinates`.
  private func globalPoint(_ element: DrawingElement, _ index: Int) -> Point2D {
    let p = element.points[index]
    return Point2D(element.x + p.x, element.y + p.y).rotated(around: linearCenter(element), by: element.angle)
  }

  /// `pointFromAbsoluteCoords`.
  private func localPoint(_ element: DrawingElement, _ p: Point2D) -> Point2D {
    let q = p.rotated(around: linearCenter(element), by: -element.angle)
    return Point2D(q.x - element.x, q.y - element.y)
  }

  /// `bindingBorderTest`: near enough the outline, or anywhere inside when
  /// `fullShape`.
  private func isInBindingReach(
    _ element: DrawingElement, _ p: Point2D, _ geometry: SceneGeometry, fullShape: Bool
  ) -> Bool {
    let reach = element.maxBindingGap(width: element.width, height: element.height, zoom: zoom)
    if isOnOutline(p, element, geometry, tolerance: reach) { return true }
    guard fullShape else { return false }
    let b = element.axisAlignedBounds
    return p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY
  }

  /// `getHoveredElementForBinding`: the topmost shape an arrow's end at `p`
  /// binds to. A filled shape takes the end from anywhere inside it.
  func hoveredForBinding(_ p: Point2D) -> DrawingElement? {
    let geometry = makeGeometry()
    for raw in store.reversed() where !raw.isDeleted {
      guard let element = geometry.elements[raw.id], element.isBindable, !element.locked else { continue }
      let fullShape = !element.letsBindingFallThrough && !element.isFrameLike
      if isInBindingReach(element, p, geometry, fullShape: fullShape) { return element }
    }
    return nil
  }

  /// `bindLinearElement`: the arrow's end names the shape, with where it
  /// points across it and how far off it stops, and the shape lists the
  /// arrow.
  private func bind(_ arrowId: String, to shape: DrawingElement, _ end: ArrowEnd) {
    guard let arrow = restored(arrowId), arrow.type == .arrow, !arrow.isElbowArrow else { return }
    let edge = end == .start ? 0 : arrow.points.count - 1
    let edgePoint = globalPoint(arrow, edge)
    let adjacentPoint = globalPoint(arrow, end == .start ? 1 : edge - 1)
    let focus = shape.focusDistance(adjacentPoint, edgePoint)
    var gap = max(1, shape.distanceToOutline(edgePoint))
    // `normalizePointBinding`: an end bound from inside a filled shape
    // stops where the binding highlight is drawn.
    if gap > shape.maxBindingGap(width: shape.width, height: shape.height) { gap = 10 + 4 }
    mutate(arrowId, [end.key: ["elementId": .string(shape.id), "focus": .number(focus), "gap": .number(gap)]])
    let listed = element(shape.id)?["boundElements"]?.arrayValue ?? []
    if !listed.contains(where: { $0["id"]?.stringValue == arrowId }) {
      mutate(shape.id, ["boundElements": .array(listed + [["id": .string(arrowId), "type": "arrow"]])])
    }
  }

  /// `maybeBindLinearElement`: a new arrow binds to the shape it was begun
  /// on and to the one it was let go over, unless a straight arrow would
  /// bind both ends to the same shape.
  func bindNewArrow(_ id: String, startingOn start: String?, at p: Point2D) {
    if let start, let shape = restored(start) { bind(id, to: shape, .start) }
    guard let hovered = hoveredForBinding(p), let arrow = element(id) else { return }
    if !(arrow.points.count < 3 && bindingTarget(arrow, .start) == hovered.id) { bind(id, to: hovered, .end) }
  }

  /// `bindOrUnbindLinearElements`, for lines moved, resized or turned
  /// whole: an end still near the shape it was bound to binds again, to
  /// what is under it now, and any other end lets go.
  func rebindSelectedLines() {
    for id in selectedElements.filter(\.isLinearType).map(\.id) {
      guard let raw = element(id), let arrow = restored(id), !arrow.isElbowArrow else { continue }
      let geometry = makeGeometry()
      func eligible(_ end: ArrowEnd) -> DrawingElement? {
        guard let target = bindingTarget(raw, end), let shape = geometry.elements[target], shape.isBindable else {
          return nil
        }
        let p = globalPoint(arrow, end == .start ? 0 : arrow.points.count - 1)
        return isInBindingReach(shape, p, geometry, fullShape: false) ? hoveredForBinding(p) : nil
      }
      let start = eligible(.start)
      let end = eligible(.end)
      var bound: [String] = []
      var unbound: [String] = []
      bindOrUnbind(id, start, other: end, .start, &bound, &unbound)
      bindOrUnbind(id, end, other: start, .end, &bound, &unbound)
      for shape in unbound where !bound.contains(shape) {
        guard let listed = element(shape), !listed.isDeleted, let entries = listed["boundElements"]?.arrayValue
        else { continue }
        mutate(
          shape,
          ["boundElements": .array(entries.filter { $0["type"] != "arrow" || $0["id"]?.stringValue != id })])
      }
    }
  }

  /// `bindOrUnbindLinearElementEdge`.
  private func bindOrUnbind(
    _ id: String, _ shape: DrawingElement?, other: DrawingElement?, _ end: ArrowEnd, _ bound: inout [String],
    _ unbound: inout [String]
  ) {
    guard let shape else {
      if let raw = element(id), let target = bindingTarget(raw, end) {
        mutate(id, [end.key: nil])
        if !unbound.contains(target) { unbound.append(target) }
      }
      return
    }
    let simple = (element(id)?.points.count ?? 0) < 3
    if !simple || other == nil || end == .start || other?.id != shape.id {
      bind(id, to: shape, end)
      if !bound.contains(shape.id) { bound.append(shape.id) }
    }
  }

  /// `updateBoundElements`: the arrows bound to a shape that moved or
  /// changed follow it. Arrows in `simultaneouslyUpdated` moved with it and
  /// only take the new gaps.
  func updateBoundElements(
    of changedId: String, newSize: (width: Double, height: Double)? = nil,
    simultaneouslyUpdated: Set<String> = []
  ) {
    guard let changed = restored(changedId), changed.isBindable else { return }
    for entry in changed.boundElements {
      guard let raw = element(entry.id), !raw.isDeleted, raw.isLinearType,
        bindingTarget(raw, .start) == changedId || bindingTarget(raw, .end) == changedId
      else { continue }
      let shapes = [ArrowEnd.start, .end].map { end in
        bindingTarget(raw, end).flatMap(restored).flatMap { $0.isDeleted ? nil : $0 }
      }
      var boundsApart = false
      if let start = shapes[0], let end = shapes[1] {
        let geometry = SceneGeometry(
          elements: [start.id: start, end.id: end], canvasBackgroundColor: "#ffffff")
        let a = geometry.bounds(start)
        let b = geometry.bounds(end)
        boundsApart = !(a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY)
      }
      var rescaled: RawElement = [:]
      for end in [ArrowEnd.start, .end] {
        guard let binding = raw[end.key] else { continue }
        rescaled[end.key] = rescaledBinding(binding, of: changed, newSize)
      }
      let ownBindings = newSize == nil
      if simultaneouslyUpdated.contains(raw.id) {
        if restored(raw.id)?.isElbowArrow == true {
          mutateElbowArrow(raw.id, rescaled, ownBindings: ownBindings)
        } else {
          mutate(raw.id, rescaled)
        }
        continue
      }
      guard let arrow = restored(raw.id) else { continue }
      var targets: [(index: Int, point: Point2D)] = []
      for (position, end) in [ArrowEnd.start, .end].enumerated() {
        guard let shape = shapes[position], shape.isBindable else { continue }
        let other = end == .start ? ArrowEnd.end : .start
        guard bindingTarget(raw, end) == changedId || (bindingTarget(raw, other) == changedId && boundsApart),
          let point = boundPoint(arrow, end, rescaled[end.key], shape)
        else { continue }
        targets.append((end == .start ? 0 : arrow.points.count - 1, point))
      }
      var otherUpdates: RawElement = [:]
      for end in [ArrowEnd.start, .end] where bindingTarget(raw, end) == changedId {
        otherUpdates[end.key] = rescaled[end.key]
      }
      if arrow.isElbowArrow {
        // `_updatePoints`: an elbow arrow is given its new ends only, and
        // keeps only fixed point bindings.
        var updates = otherUpdates.mapValues { fixedPoint(of: $0) == nil ? JSONValue.null : $0 }
        let points = raw.points
        updates["points"] = .points([
          targets.first { $0.index == 0 }?.point ?? points[0],
          targets.first { $0.index == points.count - 1 }?.point ?? points[points.count - 1],
        ])
        mutateElbowArrow(raw.id, updates, ownBindings: ownBindings)
      } else {
        movePoints(raw.id, targets, otherUpdates)
      }
      if let label = arrow.boundTextId, let text = element(label), !text.isDeleted {
        layOutLabel(of: raw.id, handle: nil)
      }
    }
  }

  /// `maybeCalculateNewGapWhenScaling`.
  private func rescaledBinding(
    _ binding: JSONValue, of changed: DrawingElement, _ newSize: (width: Double, height: Double)?
  ) -> JSONValue {
    guard var object = binding.objectValue, let newSize else { return binding }
    let ratio = newSize.width < newSize.height ? newSize.width / changed.width : newSize.height / changed.height
    let gap = max(
      1,
      min(
        changed.maxBindingGap(width: newSize.width, height: newSize.height),
        (object["gap"]?.numberValue ?? 0) * ratio))
    object["gap"] = .number(gap)
    return .object(object)
  }

  /// `updateBoundPoint`: where the end bound to `shape` goes now, in the
  /// arrow's own coordinates.
  private func boundPoint(_ arrow: DrawingElement, _ end: ArrowEnd, _ binding: JSONValue?, _ shape: DrawingElement)
    -> Point2D?
  {
    guard let binding, let target = binding["elementId"]?.stringValue else { return nil }
    if target != shape.id && arrow.points.count > 2 { return nil }
    if arrow.isElbowArrow, let ratio = fixedPoint(of: binding) {
      let p = shape.globalFixedPoint(ratio)
      return Point2D(p.x - arrow.x, p.y - arrow.y)
    }
    let edge = end == .start ? 0 : arrow.points.count - 1
    let adjacent = end == .start ? 1 : edge - 1
    let p = shape.boundEdge(
      focus: binding["focus"]?.numberValue ?? 0, gap: binding["gap"]?.numberValue ?? 0,
      adjacent: globalPoint(arrow, adjacent), edge: globalPoint(arrow, edge))
    return localPoint(arrow, p)
  }

  /// `LinearElementEditor.movePoints`: points moved to their targets, with
  /// the first kept at the origin by moving the element instead.
  private func movePoints(_ id: String, _ targets: [(index: Int, point: Point2D)], _ otherUpdates: RawElement) {
    guard let raw = element(id), let element = restored(id) else { return }
    let points = raw.points
    let first = targets.first { $0.index == 0 }?.point ?? Point2D(0, 0)
    let offset = Point2D(first.x - points[0].x, first.y - points[0].y)
    let next = points.enumerated().map { index, p in
      let target = targets.first { $0.index == index }?.point ?? p
      return Point2D(target.x - offset.x, target.y - offset.y)
    }
    let geometry = SceneGeometry(elements: [:], canvasBackgroundColor: "#ffffff")
    let nextBounds = geometry.pointsCoords(element, next)
    let previousBounds = geometry.pointsCoords(element, points)
    let d = Point2D(
      (previousBounds.minX + previousBounds.maxX) / 2 - (nextBounds.minX + nextBounds.maxX) / 2,
      (previousBounds.minY + previousBounds.maxY) / 2 - (nextBounds.minY + nextBounds.maxY) / 2)
    let rotated = offset.rotated(around: d, by: element.angle)
    var updates = otherUpdates
    updates["points"] = .points(next)
    updates["x"] = .number(raw.number("x") + rotated.x)
    updates["y"] = .number(raw.number("y") + rotated.y)
    mutate(id, updates)
  }

  /// `fixBindingsAfterDeletion`: shapes let go of deleted arrows and
  /// labels, and arrows let go of deleted shapes.
  func unbindDeleted() {
    for id in store.filter(\.isDeleted).map(\.id) {
      guard let deleted = element(id) else { continue }
      for (_, bindableId) in bindings(of: deleted) {
        guard let bindable = element(bindableId), !bindable.isDeleted, isBindable(bindable) else { continue }
        for entry in bindable["boundElements"]?.arrayValue ?? [] where entry["id"]?.stringValue == id {
          let entries = element(bindableId)?["boundElements"]?.arrayValue ?? []
          mutate(bindableId, ["boundElements": .array(entries.filter { $0["id"]?.stringValue != id })])
        }
      }
      guard isBindable(deleted) else { continue }
      for entry in deleted["boundElements"]?.arrayValue ?? [] {
        guard let boundId = entry["id"]?.stringValue, let bound = element(boundId), !bound.isDeleted else {
          continue
        }
        for (key, bindableId) in bindings(of: bound) where bindableId == id { mutate(boundId, [key: nil]) }
      }
    }
  }
}

extension RawElement {
  var isLinearType: Bool { type?.isLinear ?? false }
}
