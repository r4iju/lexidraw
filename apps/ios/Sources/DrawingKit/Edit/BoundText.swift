import Foundation

/// `BOUND_TEXT_PADDING`: the space between a label and its container.
let boundTextPadding = 5.0

/// Labels inside shapes and on arrows, laid out as `textElement.ts` lays
/// them out.
extension DrawingEditor {
  func font(of text: RawElement) -> String {
    FontMetrics.fontString(size: text.number("fontSize"), family: text.number("fontFamily"))
  }

  /// `getBoundTextMaxWidth`.
  func labelMaxWidth(_ container: RawElement, _ text: RawElement?) -> Double {
    let width = container.number("width")
    switch container.type {
    case "arrow": return max(0.7 * width, (text?.number("fontSize") ?? 20) * 11)
    case "ellipse": return (width / 2 * 2.0.squareRoot()).rounded(.toNearestOrAwayFromZero) - boundTextPadding * 2
    case "diamond": return (width / 2).rounded(.toNearestOrAwayFromZero) - boundTextPadding * 2
    default: return width - boundTextPadding * 2
    }
  }

  /// `getBoundTextMaxHeight`.
  func labelMaxHeight(_ container: RawElement, _ text: RawElement) -> Double {
    let height = container.number("height")
    switch container.type {
    case "arrow": return height - boundTextPadding * 8 * 2 <= 0 ? text.number("height") : height
    case "ellipse": return (height / 2 * 2.0.squareRoot()).rounded(.toNearestOrAwayFromZero) - boundTextPadding * 2
    case "diamond": return (height / 2).rounded(.toNearestOrAwayFromZero) - boundTextPadding * 2
    default: return height - boundTextPadding * 2
    }
  }

  /// `computeContainerDimensionForBoundText`: how large a container must be
  /// to hold a label this large.
  func containerDimension(for size: Double, _ type: String) -> Double {
    let size = size.rounded(.up)
    let padding = boundTextPadding * 2
    switch type {
    case "ellipse": return ((size + padding) / 2.0.squareRoot() * 2).rounded(.toNearestOrAwayFromZero)
    case "arrow": return size + padding * 8
    case "diamond": return 2 * (size + padding)
    default: return size + padding
    }
  }

  /// `computeBoundTextPosition`: on an arrow's middle, or aligned within the
  /// part of a shape a label may fill.
  func labelPosition(_ container: RawElement, _ text: RawElement) -> Point2D {
    if container.type == "arrow" {
      let geometry = makeGeometry()
      guard let arrow = geometry.elements[container.id], let label = restoreElements([.object(text)]).first
      else { return Point2D(text.number("x"), text.number("y")) }
      return geometry.boundTextPosition(arrow, label)
    }
    var offsetX = boundTextPadding
    var offsetY = boundTextPadding
    if container.type == "ellipse" {
      offsetX += container.number("width") / 2 * (1 - 2.0.squareRoot() / 2)
      offsetY += container.number("height") / 2 * (1 - 2.0.squareRoot() / 2)
    } else if container.type == "diamond" {
      offsetX += container.number("width") / 4
      offsetY += container.number("height") / 4
    }
    let left = container.number("x") + offsetX
    let top = container.number("y") + offsetY
    let maxWidth = labelMaxWidth(container, text)
    let maxHeight = labelMaxHeight(container, text)
    let y: Double =
      switch text["verticalAlign"]?.stringValue {
      case "top": top
      case "bottom": top + maxHeight - text.number("height")
      default: top + maxHeight / 2 - text.number("height") / 2
      }
    let x: Double =
      switch text["textAlign"]?.stringValue {
      case "left": left
      case "right": left + maxWidth - text.number("width")
      default: left + maxWidth / 2 - text.number("width") / 2
      }
    return Point2D(x, y)
  }

  /// `handleBindTextResize`: the label of a resized container wrapped to
  /// its new width, growing the container when it no longer fits.
  func layOutLabel(of containerId: String, handle: String?, maintainAspectRatio: Bool = false) {
    guard let container = element(containerId),
      let textId = container["boundElements"]?.arrayValue?.first(where: { $0["type"] == "text" })?["id"]?
        .stringValue,
      let label = element(textId), !label.isDeleted, !(label["text"]?.stringValue ?? "").isEmpty
    else { return }
    originalContainerHeights[containerId] = nil
    var text = label["text"]?.stringValue ?? ""
    var width = label.number("width")
    var height = label.number("height")
    if maintainAspectRatio || (handle != "n" && handle != "s") {
      text = TextWrapping.wrap(
        label["originalText"]?.stringValue ?? text, font: font(of: label),
        maxWidth: labelMaxWidth(container, label), widths: characterWidths)
      let size = measure(
        text, fontSize: label.number("fontSize"), fontFamily: label.number("fontFamily"),
        lineHeight: label.number("lineHeight"))
      width = size.width
      height = size.height
    }
    if height > labelMaxHeight(container, label) {
      let containerHeight = containerDimension(for: height, container.type)
      let grown = containerHeight - container.number("height")
      let fromTop = container.type != "arrow" && ["ne", "nw", "n"].contains(handle ?? "")
      mutate(
        containerId,
        [
          "height": .number(containerHeight),
          "y": .number(fromTop ? container.number("y") - grown : container.number("y")),
        ])
    }
    mutate(textId, ["text": .string(text), "width": .number(width), "height": .number(height)])
    if container.type != "arrow", let container = element(containerId), let label = element(textId) {
      let position = labelPosition(container, label)
      mutate(textId, ["x": .number(position.x), "y": .number(position.y)])
    }
  }
}
