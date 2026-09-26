import Foundation

extension DrawingEditor {
  /// Takes back what the gesture under way has done, as when a second
  /// finger makes it a pinch.
  public func cancelGesture() {
    guard let gesture else { return }
    self.gesture = nil
    store = gesture.before.store
    selectedIds = gesture.before.selectedIds
    editingGroupId = gesture.before.editingGroupId
    tool = gesture.before.tool
    originalContainerHeights = gesture.before.heights
    editing = nil
  }

  /// The elements with the stroke being drawn carried on through where the
  /// pencil is predicted to go, for the screen only.
  public func elements(predicting points: [(Point2D, Double)]) -> [JSONValue] {
    guard let gesture, case .freedraw(let id) = gesture.action, let position = position(of: id) else {
      return elements
    }
    var stroke = store[position]
    let x = stroke.number("x")
    let y = stroke.number("y")
    stroke["points"] = .points(stroke.points + points.map { Point2D($0.0.x - x, $0.0.y - y) })
    if stroke["simulatePressure"]?.boolValue != true {
      stroke["pressures"] = .array((stroke["pressures"]?.arrayValue ?? []) + points.map { .number($0.1) })
    }
    var shown = elements
    shown[position] = .object(stroke)
    return shown
  }
}

/// What is drawn over the drawing while it is edited, in scene units.
public struct EditorOverlay: Sendable {
  public struct Handle: Sendable {
    public var name: String
    public var bounds: Bounds
    public var angle: Double
  }

  /// The outline round each selected element, turned as it is turned.
  public var outlines: [[Point2D]] = []
  /// Round everything selected, when that is more than one element.
  public var commonBox: Bounds?
  public var handles: [Handle] = []
  /// The rectangle being dragged out to select what it covers.
  public var selecting: Bounds?
}

/// The text being written, where and how the web lays out its text box.
public struct TextBox: Sendable {
  public var id: String
  public var text: String
  public var x, y, width, height, angle: Double
  public var font: String
  public var fontSize: Double
  public var lineHeight: Double
  public var color: String
  public var textAlign: String
  public var opacity: Double
  /// Whether lines break at the box's width, as they do in a shape or
  /// once the text has been given a width.
  public var wraps: Bool
}

extension DrawingEditor {
  public func overlay(pointer: PointerKind) -> EditorOverlay {
    var overlay = EditorOverlay()
    if let gesture, case .box = gesture.action {
      overlay.selecting = Bounds(
        minX: min(gesture.origin.x, gesture.last.x), minY: min(gesture.origin.y, gesture.last.y),
        maxX: max(gesture.origin.x, gesture.last.x), maxY: max(gesture.origin.y, gesture.last.y))
    }
    guard editing == nil else { return overlay }
    let geometry = makeGeometry()
    let selected = selectedElements.compactMap { geometry.elements[$0.id] }
      .filter { $0.type != "text" || $0.containerId == nil }
    // `DEFAULT_TRANSFORM_HANDLE_SPACING * 2`, the web's gap between an
    // element and its outline.
    let padding = 4 / zoom
    overlay.outlines = selected.filter(showsBoundingBox).map { selectionBox($0, geometry, padding: padding) }
    if selected.count > 1 {
      let b = geometry.commonBounds(selected)
      overlay.commonBox = Bounds(
        minX: b.minX - padding, minY: b.minY - padding, maxX: b.maxX + padding, maxY: b.maxY + padding)
    }
    if selectedElements.count > 1 {
      overlay.handles = selectionHandles(pointer: pointer).map {
        EditorOverlay.Handle(name: $0.key, bounds: $0.value, angle: 0)
      }
    } else if let element = selected.first, showsBoundingBox(element) {
      overlay.handles = transformHandles(of: element.id, pointer: pointer).map {
        EditorOverlay.Handle(name: $0.key, bounds: $0.value, angle: element.angle)
      }
    }
    return overlay
  }

  public var textBox: TextBox? {
    guard let editing, let text = element(editing.id) else { return nil }
    return TextBox(
      id: editing.id, text: text["originalText"]?.stringValue ?? "", x: text.number("x"),
      y: text.number("y"), width: text.number("width"), height: text.number("height"),
      angle: text.number("angle"), font: font(of: text), fontSize: text.number("fontSize"),
      lineHeight: text.number("lineHeight"), color: text["strokeColor"]?.stringValue ?? "#1e1e1e",
      textAlign: text["textAlign"]?.stringValue ?? "left", opacity: text["opacity"]?.numberValue ?? 100,
      wraps: text["containerId"]?.stringValue != nil || text["autoResize"]?.boolValue == false)
  }

  /// Puts the text down as the web does when its text box loses focus.
  public func stopEditingText() {
    finishEditingText(viaKeyboard: false)
  }
}
