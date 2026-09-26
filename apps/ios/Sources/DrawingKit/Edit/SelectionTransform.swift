import Foundation

/// Resizing and turning a selection of several elements, as
/// `resizeMultipleElements` and `rotateMultipleElements` do.
extension DrawingEditor {
  /// `getResizeOffsetXY` for a selection's box, which doesn't turn.
  func selectionResizeOffset(_ handle: String, _ b: Bounds, _ p: Point2D) -> Point2D {
    let midX = (b.minX + b.maxX) / 2
    let midY = (b.minY + b.maxY) / 2
    switch handle {
    case "n": return Point2D(p.x - midX, p.y - b.minY)
    case "s": return Point2D(p.x - midX, p.y - b.maxY)
    case "w": return Point2D(p.x - b.minX, p.y - midY)
    case "e": return Point2D(p.x - b.maxX, p.y - midY)
    case "nw": return Point2D(p.x - b.minX, p.y - b.minY)
    case "ne": return Point2D(p.x - b.maxX, p.y - b.minY)
    case "sw": return Point2D(p.x - b.minX, p.y - b.maxY)
    case "se": return Point2D(p.x - b.maxX, p.y - b.maxY)
    default: return Point2D(0, 0)
    }
  }

  /// `getNextMultipleWidthAndHeightFromPointer` and
  /// `resizeMultipleElements`: every element scales about the corner or
  /// side opposite the handle, and keeps its proportions when any of them
  /// is turned, is text or is grouped.
  func resizeSelection(_ gesture: Gesture, handle: String, to p: Point2D) {
    let selected = selectedElements
    let targets = selected.compactMap { latest in gesture.originals[latest.id].map { (orig: $0, latest: latest) } }
    var measured = targets.map(\.orig)
    for orig in measured where orig.isLinearType {
      if let label = labelId(of: orig), let text = gesture.originals[label], text["containerId"]?.stringValue != nil {
        measured.append(text)
      }
    }
    let originals = makeGeometry(of: measured)
    let box = originals.commonBounds(measured.compactMap { originals.elements[$0.id] })
    let width = box.maxX - box.minX
    let height = box.maxY - box.minY
    let anchors: [String: Point2D] = [
      "ne": Point2D(box.minX, box.maxY), "se": Point2D(box.minX, box.minY), "sw": Point2D(box.maxX, box.minY),
      "nw": Point2D(box.maxX, box.maxY), "e": Point2D(box.minX, box.minY + height / 2),
      "w": Point2D(box.maxX, box.minY + height / 2), "n": Point2D(box.minX + width / 2, box.maxY),
      "s": Point2D(box.minX + width / 2, box.minY),
    ]
    guard let anchor = anchors[handle] else { return }
    func orZero(_ value: Double) -> Double { value.isNaN ? 0 : value }
    let horizontal = handle.contains("e") || handle.contains("w")
    let vertical = handle.contains("n") || handle.contains("s")
    // Images keep their proportions unless Shift is held, which a finger
    // can't hold.
    let maintainAspectRatio = selected.contains { $0.type == "image" }
    let pointerScale = max(orZero(abs(p.x - anchor.x) / width), orZero(abs(p.y - anchor.y) / height))
    var nextWidth = horizontal ? abs(p.x - anchor.x) : width
    var nextHeight = vertical ? abs(p.y - anchor.y) : height
    if maintainAspectRatio {
      nextWidth = width * pointerScale * mathSign(p.x - anchor.x)
      nextHeight = height * pointerScale * mathSign(p.y - anchor.y)
    }
    let flips: [String: (Bool, Bool)] = [
      "ne": (p.x < anchor.x, p.y > anchor.y), "se": (p.x < anchor.x, p.y < anchor.y),
      "sw": (p.x > anchor.x, p.y < anchor.y), "nw": (p.x > anchor.x, p.y > anchor.y),
      "e": (p.x < anchor.x, false), "w": (p.x > anchor.x, false), "n": (false, p.y > anchor.y),
      "s": (false, p.y < anchor.y),
    ]
    let (flipByX, flipByY) = flips[handle] ?? (false, false)

    guard nextWidth != 0, nextHeight != 0 else { return }
    if maintainAspectRatio, abs(nextWidth / nextHeight - width / height) > 1e-3 {
      nextWidth = nextHeight * (width / height)
    }
    guard nextWidth != 0, !nextWidth.isNaN, nextHeight != 0, !nextHeight.isNaN else { return }
    var scaleX = horizontal ? abs(nextWidth) / width : 1
    var scaleY = vertical ? abs(nextHeight) / height : 1
    let scale =
      handle.count == 1
      ? (horizontal ? scaleX : scaleY) : max(orZero(abs(nextWidth) / width), orZero(abs(nextHeight) / height))
    let keepAspectRatio =
      maintainAspectRatio
      || targets.contains { $0.latest.number("angle") != 0 || $0.latest.type == "text" || !groupIds($0.latest).isEmpty }
    if keepAspectRatio {
      scaleX = scale
      scaleY = scale
    }
    let flipX = flipByX ? -1.0 : 1
    let flipY = flipByY ? -1.0 : 1
    var changes: [(id: String, update: RawElement, labelFontSize: Double?)] = []
    for (orig, latest) in targets {
      if orig.type == "text", orig["containerId"]?.stringValue != nil { continue }
      let width = orig.number("width") * scaleX
      let height = orig.number("height") * scaleY
      let isLinearOrFreedraw = orig.isLinearType || orig.type == "freedraw"
      let shiftX = flipByX && !isLinearOrFreedraw ? width : 0
      let shiftY = flipByY && !isLinearOrFreedraw ? height : 0
      var update: RawElement = [
        "x": .number(anchor.x + flipX * ((orig.number("x") - anchor.x) * scaleX + shiftX)),
        "y": .number(anchor.y + flipY * ((orig.number("y") - anchor.y) * scaleY + shiftY)),
        "width": .number(width), "height": .number(height),
        "angle": .number(normalizeRadians(orig.number("angle") * flipX * flipY)),
      ]
      if isLinearOrFreedraw {
        update["points"] = .points(rescaled(orig.points, width: width * flipX, height: height * flipY, normalize: false))
      }
      if orig.type == "image", let s = orig["scale"]?.arrayValue?.compactMap(\.numberValue), s.count == 2 {
        update["scale"] = [.number(s[0] * flipX), .number(s[1] * flipY)]
      }
      if orig.type == "text" {
        // `measureFontSizeFromWidth`.
        let fontSize = orig.number("fontSize") * (width / orig.number("width"))
        guard fontSize >= 1 else { return }
        update["fontSize"] = .number(fontSize)
      }
      var labelFontSize: Double?
      if let label = labelId(of: orig).flatMap({ gesture.originals[$0] }) {
        labelFontSize = label.number("fontSize") * (keepAspectRatio ? scale : 1)
        guard labelFontSize! >= 1 else { return }
      }
      changes.append((latest.id, update, labelFontSize))
    }
    let moved = Set(changes.map(\.id))
    for change in changes {
      mutate(change.id, change.update)
      updateBoundElements(
        of: change.id, newSize: (change.update["width"]!.numberValue!, change.update["height"]!.numberValue!),
        simultaneouslyUpdated: moved)
      guard let latest = element(change.id), let label = labelId(of: latest), let text = element(label),
        !text.isDeleted, let fontSize = change.labelFontSize, fontSize != 0
      else { continue }
      var labelUpdate: RawElement = ["fontSize": .number(fontSize)]
      if !latest.isLinearType { labelUpdate["angle"] = change.update["angle"] }
      mutate(label, labelUpdate)
      layOutLabel(of: change.id, handle: handle, maintainAspectRatio: true)
    }
  }

  /// `rotateMultipleElements`: every element turns about the selection's
  /// middle, and the text each holds with it.
  func rotateSelection(_ gesture: Gesture, to p: Point2D) {
    let center = gesture.center
    let centerAngle = 5 * .pi / 2 + atan2(p.y - center.y, p.x - center.x)
    let selected = selectedElements.map(\.id)
    let ids = Set(selected)
    for id in selected {
      guard let raw = element(id), raw.type != "frame", raw.type != "magicframe" else { continue }
      let geometry = makeGeometry()
      guard let current = geometry.elements[id] else { continue }
      let c = geometry.absoluteCoords(current)
      let middle = Point2D((c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2)
      let angle = raw.number("angle")
      let originalAngle = gesture.originals[id]?.number("angle") ?? angle
      let turned = middle.rotated(around: center, by: centerAngle + originalAngle - angle)
      let nextAngle = JSONValue.number(normalizeRadians(centerAngle + originalAngle))
      if !current.isElbowArrow {
        mutate(
          id,
          [
            "x": .number(raw.number("x") + (turned.x - middle.x)),
            "y": .number(raw.number("y") + (turned.y - middle.y)), "angle": nextAngle,
          ])
      }
      updateBoundElements(of: id, simultaneouslyUpdated: ids)
      if raw.type != "arrow", let label = labelId(of: raw), let text = element(label), !text.isDeleted {
        mutate(
          label,
          [
            "x": .number(text.number("x") + (turned.x - middle.x)),
            "y": .number(text.number("y") + (turned.y - middle.y)), "angle": nextAngle,
          ])
      }
    }
  }
}
