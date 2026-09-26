import Foundation

/// `TEXT_TO_CENTER_SNAP_THRESHOLD`: how near a shape's centre a tap puts a
/// label there instead of free text.
private let centerSnap = 30.0

/// Writing text: free text, and labels in shapes, as the web's text tool,
/// double click and `textWysiwyg` write them.
extension DrawingEditor {
  // MARK: Starting

  /// `handleTextOnPointerDown`.
  func pressWithText(_ gesture: inout Gesture) {
    var point = gesture.origin
    var container = textContainer(at: point)
    if let hit = elementAt(point, includingBoundText: true), let element = element(hit),
      labelId(of: element) != nil
    {
      container = hit
      point = Point2D(element.number("x") + element.number("width") / 2, element.number("y") + element.number("height") / 2)
    }
    if let id = startTextEditing(at: point, in: container, editNow: false) { gesture.action = .text(id) }
  }

  /// A second tap where the first was: writes in the text or shape there,
  /// or starts new text, as the web's double click does.
  public func doubleTap(_ point: Point2D) {
    guard editing == nil, gesture == nil, tool == .selection else { return }
    if enterGroup(at: point) { return }
    var point = point
    let container = textContainer(at: point)
    if let container, let element = element(container) {
      let geometry = makeGeometry()
      if labelId(of: element) != nil || !isTransparentColor(element["backgroundColor"]?.stringValue ?? "")
        || geometry.elements[container].map({ hitsItself(point, $0, geometry, threshold: threshold) }) == true
      {
        point = containerCenter(element)
      }
    }
    _ = startTextEditing(at: point, in: container, editNow: true)
  }

  /// `getTextBindableContainerAtPosition`: the one selected shape if it can
  /// hold a label, or else the topmost element whose box holds the point.
  func textContainer(at p: Point2D) -> String? {
    func bindable(_ element: RawElement) -> Bool {
      element["locked"]?.boolValue != true
        && [.rectangle, .diamond, .ellipse, .arrow].contains(element.type)
    }
    let selected = selectedElements
    if selected.count == 1 { return bindable(selected[0]) ? selected[0].id : nil }
    let geometry = makeGeometry()
    for raw in store.reversed() where !raw.isDeleted {
      guard let element = geometry.elements[raw.id] else { continue }
      if raw.type == .arrow && hitsItself(p, element, geometry, threshold: threshold) {
        return bindable(raw) ? raw.id : nil
      }
      let c = geometry.absoluteCoords(element)
      if c.x1 < p.x && p.x < c.x2 && c.y1 < p.y && p.y < c.y2 { return bindable(raw) ? raw.id : nil }
    }
    return nil
  }

  func labelId(of element: RawElement) -> String? {
    element["boundElements"]?.arrayValue?.first(where: { $0["type"] == "text" })?["id"]?.stringValue
  }

  /// `getContainerCenter`.
  func containerCenter(_ container: RawElement) -> Point2D {
    guard container.type == .arrow else {
      return Point2D(
        container.number("x") + container.number("width") / 2,
        container.number("y") + container.number("height") / 2)
    }
    let geometry = makeGeometry()
    guard let arrow = geometry.elements[container.id] else { return Point2D(0, 0) }
    var probe = arrow
    probe.width = 0
    probe.height = 0
    return geometry.boundTextPosition(arrow, probe)
  }

  /// `startTextEditing`: the text there, or the label of the shape, or new
  /// text, centred in the shape when the tap was near its centre. Returns
  /// the text, when writing it waits for the finger to lift.
  private func startTextEditing(at tap: Point2D, in containerId: String?, editNow: Bool) -> String? {
    var point = tap
    var container = containerId.flatMap(element)
    func snapped(_ p: Point2D) -> Point2D? {
      guard let container else { return nil }
      let center = containerCenter(container)
      return hypot(p.x - center.x, p.y - center.y) < centerSnap ? center : nil
    }
    var center = snapped(point)
    let bindsToContainer = container != nil && center != nil && container.flatMap(labelId) == nil
    let selected = selectedElements
    var existing: RawElement?
    if selected.count == 1 {
      if selected[0].type == .text {
        existing = selected[0]
      } else if container != nil {
        existing = labelId(of: selected[0]).flatMap(element)
      } else {
        existing = textAt(point)
      }
    } else {
      existing = textAt(point)
    }
    let fontFamily = existing?.number("fontFamily") ?? style.fontFamily
    let lineHeight = existing?["lineHeight"]?.numberValue ?? FontMetrics.lineHeight(forFamily: fontFamily)
    let fontSize = style.fontSize
    if existing == nil, bindsToContainer, let box = container, box.type != .arrow {
      let font = FontMetrics.fontString(size: fontSize, family: fontFamily)
      let minWidth = characterWidths.widest(font: font) + boundTextPadding * 2
      let minHeight = fontSize * lineHeight + boundTextPadding * 2
      let height = max(box.number("height"), minHeight)
      let width = max(box.number("width"), minWidth)
      mutate(box.id, ["height": .number(height), "width": .number(width)])
      container = element(box.id)
      point = Point2D(box.number("x") + width / 2, box.number("y") + height / 2)
      if center != nil { center = snapped(point) }
    }
    if let existing {
      beginEditing(existing.id, existing: true)
      return nil
    }
    let size = measure("", fontSize: fontSize, fontFamily: fontFamily, lineHeight: lineHeight)
    let textAlign = center != nil ? "center" : style.textAlign
    let verticalAlign = center != nil ? "middle" : "top"
    let anchor = center ?? point
    let offsetX = textAlign == "center" ? size.width / 2 : textAlign == "right" ? size.width : 0
    let offsetY = verticalAlign == "middle" ? size.height / 2 : 0
    var text = newElement(
      .text, at: Point2D(anchor.x - offsetX, anchor.y - offsetY), roundness: nil, framedAt: point)
    text.merge(
      [
        "width": .number(size.width), "height": .number(size.height), "text": "",
        "fontSize": .number(fontSize), "fontFamily": .number(fontFamily),
        "textAlign": .string(textAlign), "verticalAlign": .string(verticalAlign),
        "containerId": bindsToContainer ? .string(container!.id) : nil, "originalText": "",
        "autoResize": true, "lineHeight": .number(lineHeight),
        "groupIds": container?["groupIds"] ?? [], "angle": container?["angle"] ?? 0,
      ], uniquingKeysWith: { $1 })
    if bindsToContainer, let box = container {
      mutate(
        box.id,
        ["boundElements": .array((box["boundElements"]?.arrayValue ?? []) + [["type": "text", "id": text["id"]!]])])
      insert(text, at: position(of: box.id).map { $0 + 1 })
    } else {
      insert(text)
    }
    if editNow || container != nil {
      beginEditing(text.id, existing: false)
      return nil
    }
    return text.id
  }

  /// `getTextElementAtPosition`.
  private func textAt(_ p: Point2D) -> RawElement? {
    elementAt(p, includingBoundText: true).flatMap(element).flatMap { $0.type == .text ? $0 : nil }
  }

  /// `handleTextWysiwyg`: nothing selected while the text is written, and
  /// the text measured as it stands.
  func beginEditing(_ id: String, existing: Bool) {
    editing = (id, !existing)
    followEditedText()
    selectedIds = []
    guard let position = position(of: id) else { return }
    refreshText(at: position, originalText: store[position]["originalText"]?.stringValue ?? "", isDeleted: false)
    followEditedText()
  }

  // MARK: Writing

  /// The text being written is now `text`, as typed so far.
  public func editText(_ text: String) {
    guard let editing, let position = position(of: editing.id) else { return }
    refreshText(at: position, originalText: text, isDeleted: false)
    followEditedText()
  }

  /// `handleTextWysiwyg`'s `updateElement`: the text, wrapped and measured
  /// again.
  private func refreshText(at position: Int, originalText: String, isDeleted: Bool) {
    let element = store[position]
    var updates: RawElement = ["originalText": .string(originalText)]
    if element.isDeleted {
      updates["isDeleted"] = .bool(isDeleted)
      environment.update(&store[position], updates)
      return
    }
    var text = originalText.replacingOccurrences(of: "\r\n", with: "\n")
      .replacingOccurrences(of: "\r", with: "\n").replacingOccurrences(of: "\t", with: "        ")
    let container = element["containerId"]?.stringValue.flatMap(self.element)
    let autoResize = element["autoResize"]?.boolValue != false
    if container != nil || !autoResize {
      text = TextWrapping.wrap(
        text, font: font(of: element),
        maxWidth: container.map { labelMaxWidth($0, element) } ?? element.number("width"), widths: characterWidths)
    }
    let size = measure(
      text, fontSize: element.number("fontSize"), fontFamily: element.number("fontFamily"),
      lineHeight: element.number("lineHeight"))
    let width = autoResize ? size.width : element.number("width")
    let align = element["textAlign"]?.stringValue ?? "left"
    var x = element.number("x")
    var y = element.number("y")
    if align == "center", element["verticalAlign"]?.stringValue == "middle", container == nil, autoResize {
      let previous = measure(
        element["text"]?.stringValue ?? "", fontSize: element.number("fontSize"),
        fontFamily: element.number("fontFamily"), lineHeight: element.number("lineHeight"))
      x -= (width - previous.width) / 2
      y -= (size.height - previous.height) / 2
    } else {
      // `adjustXYWithRotation`: the text keeps its top, and the edge its
      // alignment names, where they are on screen.
      let angle = element.number("angle")
      let (c, s) = (cos(angle), sin(angle))
      let dx = (element.number("width") - width) / 2
      let dy = (element.number("height") - size.height) / 2
      switch align {
      case "center":
        x += dx
      case "right":
        x += dx * (1 + c)
        y += dx * s
      default:
        x += dx * (1 - c)
        y += dx * -s
      }
      x += dy * s
      y += dy * (1 - c)
    }
    updates.merge(
      [
        "isDeleted": .bool(isDeleted), "text": .string(text), "width": .number(width),
        "height": .number(size.height), "x": .number(x), "y": .number(y),
      ], uniquingKeysWith: { $1 })
    environment.update(&store[position], updates)
  }

  /// `updateWysiwygStyle`, which the web runs whenever the scene changes
  /// while text is written, its own changes included: a shape grows to hold
  /// its label, shrinks back no further than it was as the label is cut,
  /// and keeps the label aligned in it.
  private func followEditedText() {
    guard let editing, let text = element(editing.id),
      let containerId = text["containerId"]?.stringValue, let container = element(containerId)
    else { return }
    var position = Point2D(text.number("x"), text.number("y"))
    if container.type == .arrow { position = labelPosition(container, text) }
    let original = originalContainerHeights[containerId] ?? container.number("height")
    originalContainerHeights[containerId] = original
    let height = text.number("height")
    let maxHeight = labelMaxHeight(container, text)
    if container.type != .arrow && height > maxHeight {
      if mutate(containerId, ["height": .number(containerDimension(for: height, container.type))]) {
        followEditedText()
      }
      return
    } else if container.type != .arrow && container.number("height") > original && height < maxHeight {
      if mutate(containerId, ["height": .number(containerDimension(for: height, container.type))]) {
        followEditedText()
      }
    } else {
      position.y = labelPosition(container, text).y
    }
    if mutate(editing.id, ["x": .number(position.x), "y": .number(position.y)]) { followEditedText() }
  }

  // MARK: Finishing

  /// Escape, or a press elsewhere: the text is put down, and removed if it
  /// is empty.
  func finishEditingText(viaKeyboard: Bool) {
    guard let editing else { return }
    self.editing = nil
    guard let position = position(of: editing.id) else { return }
    let element = store[position]
    let text = element["originalText"]?.stringValue ?? ""
    let isDeleted = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    let containerId = element["containerId"]?.stringValue
    if let containerId, let container = self.element(containerId), !container.isDeleted {
      let bound = container["boundElements"]?.arrayValue ?? []
      if !isDeleted {
        if labelId(of: container) != editing.id {
          mutate(containerId, ["boundElements": .array(bound + [["type": "text", "id": .string(editing.id)]])])
        } else if container.type == .arrow, let at = self.position(of: containerId) {
          environment.bump(&store[at])
        }
      } else {
        mutate(containerId, ["boundElements": .array(bound.filter { $0["type"] != "text" })])
      }
      redrawText(editing.id, in: containerId)
    }
    guard let position = self.position(of: editing.id) else { return }
    refreshText(at: position, originalText: text, isDeleted: isDeleted)
    if !isDeleted && viaKeyboard { selectedIds.insert(containerId ?? editing.id) }
    if isDeleted { selectedIds.remove(editing.id) }
    if !isDeleted || !editing.isNew { capture() }
  }

  /// `redrawTextBoundingBox`: a label wrapped to its shape, the shape grown
  /// to hold it, and the label placed in it.
  func redrawText(_ textId: String, in containerId: String?) {
    guard let text = element(textId) else { return }
    let container = containerId.flatMap(element)
    var updates: RawElement = [
      "x": text["x"] ?? 0, "y": text["y"] ?? 0, "text": text["text"] ?? "",
      "width": text["width"] ?? 0, "height": text["height"] ?? 0,
      "angle": container?["angle"] ?? text["angle"] ?? 0,
    ]
    let autoResize = text["autoResize"]?.boolValue != false
    var wrapped = text["text"]?.stringValue ?? ""
    if container != nil || !autoResize {
      wrapped = TextWrapping.wrap(
        text["originalText"]?.stringValue ?? "", font: font(of: text),
        maxWidth: container.map { labelMaxWidth($0, text) } ?? text.number("width"), widths: characterWidths)
      updates["text"] = .string(wrapped)
    }
    let size = measure(
      wrapped, fontSize: text.number("fontSize"), fontFamily: text.number("fontFamily"),
      lineHeight: text.number("lineHeight"))
    if autoResize { updates["width"] = .number(size.width) }
    updates["height"] = .number(size.height)
    if let container {
      if container.type != .arrow, size.height > labelMaxHeight(container, text) {
        let height = containerDimension(for: size.height, container.type)
        mutate(container.id, ["height": .number(height)])
        originalContainerHeights[container.id] = height
      }
      if size.width > labelMaxWidth(container, text) {
        mutate(container.id, ["width": .number(containerDimension(for: size.width, container.type))])
      }
      if let latest = element(container.id) {
        var laidOut = text
        laidOut.merge(updates) { $1 }
        let position = labelPosition(latest, laidOut)
        updates["x"] = .number(position.x)
        updates["y"] = .number(position.y)
      }
    }
    mutate(textId, updates)
  }
}
