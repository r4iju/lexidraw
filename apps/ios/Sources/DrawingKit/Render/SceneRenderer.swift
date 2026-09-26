import Foundation

public enum DrawingTheme: Sendable {
  case light
  case dark
}

/// Measures text as a canvas's `measureText` does.
public protocol TextMeasuring {
  func width(of text: String, font: String) -> Double
}

let themeFilter = "invert(93%) hue-rotate(180deg)"

/// A drawing made ready to draw as Excalidraw's `exportToCanvas` draws it:
/// frame names added as text, and the content's extent worked out. It may be
/// drawn from several threads, as tiles are; one draws at a time, since
/// drawing fills the geometry's caches.
public final class PreparedScene: @unchecked Sendable {
  public let theme: DrawingTheme
  /// The content's extent in scene coordinates.
  public let contentBounds: Bounds
  let elements: [DrawingElement]
  let geometry: SceneGeometry
  let images: [String: DrawingImage]
  private let drawing = NSLock()

  public init(
    _ elements: [DrawingElement], theme: DrawingTheme, canvasBackgroundColor: String = "#ffffff",
    images: [String: DrawingImage] = [:], measurer: TextMeasuring, shapes: ShapeCache? = nil
  ) {
    self.theme = theme
    self.images = images
    var prepared: [DrawingElement] = []
    for element in elements where !element.isDeleted {
      if element.isFrameLike {
        prepared.append(frameName(element, theme: theme, measurer: measurer))
      }
      prepared.append(element)
    }
    self.elements = prepared
    let map = Dictionary(prepared.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    geometry = SceneGeometry(elements: map, canvasBackgroundColor: canvasBackgroundColor, kept: shapes)
    let frameIds = Set(prepared.filter(\.isFrameLike).map(\.id))
    let roots = prepared.filter {
      $0.isFrameLike || $0.frameId == nil || !frameIds.contains($0.frameId!)
    }
    contentBounds = geometry.commonBounds(roots)
  }

  /// The pixel size of an export: `getCanvasSize`, the content with padding
  /// round it, at `scale`.
  public func exportPixelSize(padding: Double, scale: Double) -> (width: Int, height: Int) {
    (
      Int((abs(contentBounds.minX - contentBounds.maxX) + padding * 2) * scale),
      Int((abs(contentBounds.minY - contentBounds.maxY) + padding * 2) * scale)
    )
  }

  /// Draws the scene as `exportToCanvas` does, onto a canvas of
  /// `exportPixelSize(padding:scale:)`.
  public func export(on canvas: Canvas2D, padding: Double, scale: Double, background: String?) {
    let size = exportPixelSize(padding: padding, scale: scale)
    render(
      on: canvas, scale: scale, scrollX: -contentBounds.minX + padding,
      scrollY: -contentBounds.minY + padding, width: Double(size.width) / scale,
      height: Double(size.height) / scale, background: background, layerScale: scale)
  }

  /// `renderStaticScene` as exporting runs it: the scene at `scale`, shifted
  /// by the scroll, over a `width` × `height` area in scene units.
  /// `layerScale` is the resolution arrow labels are cut out at. Given
  /// `visible`, the part of the scene on screen, only what overlaps it is
  /// drawn, as the web editor draws only what is in its viewport.
  public func render(
    on canvas: Canvas2D, scale: Double, scrollX: Double, scrollY: Double, width: Double,
    height: Double, background: String?, layerScale: Double, visible: Bounds? = nil
  ) {
    drawing.lock()
    defer { drawing.unlock() }
    canvas.setTransform(.identity)
    canvas.scale(scale, scale)
    if theme == .dark { canvas.filter = themeFilter }
    if let background {
      let hasTransparence =
        background == "transparent" || background.count == 5 || background.count == 9
        || background.contains("rgba(") || background.contains("hsla(")
      if hasTransparence { canvas.clearRect(0, 0, width, height) }
      canvas.save()
      canvas.fillStyle = background
      canvas.fillRect(0, 0, width, height)
      canvas.restore()
    } else {
      canvas.clearRect(0, 0, width, height)
    }
    let renderer = ElementRenderer(
      geometry: geometry, canvas: canvas, scrollX: scrollX, scrollY: scrollY, theme: theme,
      layerScale: layerScale, images: images)
    var checkedGroups: [String: Bool] = [:]
    let iframeLike = { (element: DrawingElement) in
      element.type == "iframe" || element.type == "embeddable"
    }
    let onScreen = { (element: DrawingElement) -> Bool in
      guard let visible else { return true }
      let b = self.geometry.bounds(element)
      return b.maxX >= visible.minX && b.minX <= visible.maxX && b.maxY >= visible.minY
        && b.minY <= visible.maxY
    }
    for element in elements where !iframeLike(element) && onScreen(element) {
      if element.type == "text", let containerId = element.containerId,
        geometry.elements[containerId] != nil
      {
        continue
      }
      canvas.save()
      if element.frameId != nil, let frame = geometry.targetFrame(element),
        geometry.shouldApplyFrameClip(element, frame, &checkedGroups)
      {
        renderer.clip(to: frame)
      }
      renderer.render(element)
      if let text = geometry.boundText(of: element) { renderer.render(text) }
      canvas.restore()
    }
    for element in elements where iframeLike(element) && onScreen(element) {
      if element.frameId != nil {
        canvas.save()
        if let frame = geometry.targetFrame(element),
          geometry.shouldApplyFrameClip(element, frame, &checkedGroups)
        {
          renderer.clip(to: frame)
        }
        renderer.render(element)
        canvas.restore()
      } else {
        renderer.render(element)
      }
    }
  }
}

/// `addFrameLabelsAsTextElements`: a frame's name drawn above it, cut short
/// with an ellipsis when wider than the frame.
private func frameName(_ frame: DrawingElement, theme: DrawingTheme, measurer: TextMeasuring)
  -> DrawingElement
{
  let title =
    (frame.name ?? (frame.type == "frame" ? "Frame" : "AI Frame"))
    .replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
    .replacingOccurrences(of: "\t", with: "        ")
  let font = FontMetrics.fontString(size: 14, family: 2)
  func measure(_ text: String) -> Double {
    splitIntoLines(text).map { measurer.width(of: $0.isEmpty ? " " : $0, font: font) }.max() ?? 0
  }
  let lines = Double(splitIntoLines(title).count)
  let height = 14 * 1.25 * lines
  var text = title
  var width = measure(title)
  if width > frame.width {
    if measurer.width(of: text, font: font) > frame.width {
      let characters = Array(text.utf16)
      var i = characters.count
      while i > 0 {
        let candidate = (String(utf16CodeUnits: characters, count: i)) + "..."
        if measurer.width(of: candidate, font: font) <= frame.width {
          text = candidate
          break
        }
        i -= 1
      }
    }
    width = frame.width
  }
  return DrawingElement(
    text: text, x: frame.x, y: frame.y - 3 - height, width: width, height: height, fontSize: 14,
    fontFamily: 2, lineHeight: 1.25, strokeColor: theme == .dark ? "#7a7a7a" : "#999999",
    id: "frame-name:\(frame.id)")
}

/// `renderElement` and `drawElementOnCanvas` for an export.
private struct ElementRenderer {
  let geometry: SceneGeometry
  let canvas: Canvas2D
  let scrollX: Double
  let scrollY: Double
  let theme: DrawingTheme
  let layerScale: Double
  let images: [String: DrawingImage]

  /// `shouldResetImageFilter`: a raster file shows in its own colours in
  /// the dark theme, while a vector file and a placeholder are themed.
  private func showsOwnColors(_ element: DrawingElement) -> Bool {
    guard theme == .dark, let fileId = element.fileId, let image = images[fileId] else { return false }
    return image.mimeType != "image/svg+xml"
  }

  func clip(to frame: DrawingElement) {
    canvas.translate(frame.x + scrollX, frame.y + scrollY)
    canvas.beginPath()
    canvas.roundRect(0, 0, frame.width, frame.height, 8)
    canvas.clip()
    canvas.translate(-(frame.x + scrollX), -(frame.y + scrollY))
  }

  func render(_ element: DrawingElement) {
    let frame = geometry.containingFrame(of: element)
    canvas.globalAlpha = ((frame?.opacity ?? 100) * element.opacity) / 10000
    switch element.type {
    case "frame", "magicframe":
      canvas.save()
      canvas.translate(element.x + scrollX, element.y + scrollY)
      canvas.fillStyle = "rgba(0, 0, 200, 0.04)"
      canvas.lineWidth = 2
      canvas.strokeStyle =
        element.type == "magicframe" ? (theme == .light ? "#7affd7" : "#1d8264") : "#bbb"
      canvas.beginPath()
      canvas.roundRect(0, 0, element.width, element.height, 8)
      canvas.stroke()
      canvas.closePath()
      canvas.restore()
    case "freedraw":
      geometry.generateShape(element)
      let c = geometry.absoluteCoords(element)
      canvas.save()
      canvas.translate((c.x1 + c.x2) / 2 + scrollX, (c.y1 + c.y2) / 2 + scrollY)
      canvas.rotate(element.angle)
      canvas.translate(
        -((c.x2 - c.x1) / 2 - (element.x - c.x1)), -((c.y2 - c.y1) / 2 - (element.y - c.y1)))
      draw(element, on: canvas)
      canvas.restore()
    default:
      geometry.generateShape(element)
      let c = geometry.absoluteCoords(element)
      let cx = (c.x1 + c.x2) / 2 + scrollX
      let cy = (c.y1 + c.y2) / 2 + scrollY
      var shiftX = (c.x2 - c.x1) / 2 - (element.x - c.x1)
      var shiftY = (c.y2 - c.y1) / 2 - (element.y - c.y1)
      if element.type == "text", let container = geometry.container(of: element),
        container.type == "arrow"
      {
        let position = geometry.boundTextPosition(container, element)
        shiftX = (c.x2 - c.x1) / 2 - (position.x - c.x1)
        shiftY = (c.y2 - c.y1) / 2 - (position.y - c.y1)
      }
      canvas.save()
      canvas.translate(cx, cy)
      if element.type == "image" && showsOwnColors(element) { canvas.filter = "none" }
      if element.type == "arrow", let text = geometry.boundText(of: element) {
        drawWithLabelCutOut(element, text, c)
      } else {
        canvas.rotate(element.angle)
        if element.type == "image" { canvas.scale(element.scale[0], element.scale[1]) }
        canvas.translate(-shiftX, -shiftY)
        draw(element, on: canvas)
      }
      canvas.restore()
    }
    canvas.globalAlpha = 1
  }

  /// An arrow with a label is drawn on a canvas of its own and the label's
  /// box cleared out of it, so the line stops short of the text.
  private func drawWithLabelCutOut(
    _ element: DrawingElement, _ text: DrawingElement, _ c: AbsoluteCoords
  ) {
    let maxDim = max(abs(c.x1 - c.x2), abs(c.y1 - c.y2))
    let side = Int(maxDim * layerScale + 20 * 10 * layerScale)
    let layer = canvas.makeLayer(width: side, height: side)
    let half = Double(side) / 2
    layer.translate(half, half)
    layer.scale(layerScale, layerScale)
    let shiftX = element.width / 2 - (element.x - c.x1)
    let shiftY = element.height / 2 - (element.y - c.y1)
    layer.rotate(element.angle)
    layer.translate(-shiftX, -shiftY)
    draw(element, on: layer)
    layer.translate(shiftX, shiftY)
    layer.rotate(-element.angle)
    let t = geometry.absoluteCoords(text)
    layer.translate(-((c.x1 + c.x2) / 2 - t.cx), -((c.y1 + c.y2) / 2 - t.cy))
    layer.clearRect(-text.width / 2, -text.height / 2, text.width, text.height)
    canvas.scale(1 / layerScale, 1 / layerScale)
    canvas.drawLayer(layer, size: (side, side), -half, -half, Double(side), Double(side))
  }

  private func draw(_ element: DrawingElement, on canvas: Canvas2D) {
    switch element.type {
    case "rectangle", "iframe", "embeddable", "diamond", "ellipse", "arrow", "line":
      canvas.lineJoin = "round"
      canvas.lineCap = "round"
      for drawable in geometry.generateShape(element) ?? [] { drawRough(drawable, on: canvas) }
    case "freedraw":
      canvas.save()
      canvas.fillStyle = element.strokeColor
      if let fill = geometry.cachedShape(element)?.first { drawRough(fill, on: canvas) }
      canvas.fillStyle = element.strokeColor
      canvas.fill(svgPath: geometry.outline(element))
      canvas.restore()
    case "image":
      guard let fileId = element.fileId, let image = images[fileId], image.bitmap != nil else {
        canvas.fillStyle = "#E7E7E7"
        canvas.fillRect(0, 0, element.width, element.height)
        let shorter = min(element.width, element.height)
        let size = min(shorter, min(shorter * 0.4, 100))
        canvas.drawImage(
          element.status == "error" ? .errorPlaceholder : .placeholder,
          element.width / 2 - size / 2, element.height / 2 - size / 2, size, size)
        return
      }
      if element.roundness != nil {
        canvas.beginPath()
        canvas.roundRect(
          0, 0, element.width, element.height,
          cornerRadius(min(element.width, element.height), element))
        canvas.clip()
      }
      let source = element.crop ?? (0, 0, image.naturalSize.width, image.naturalSize.height)
      canvas.drawImage(
        .bitmap(image), source.x, source.y, source.width, source.height, 0, 0, element.width,
        element.height)
    case "text":
      canvas.save()
      canvas.font = FontMetrics.fontString(size: element.fontSize, family: element.fontFamily)
      canvas.fillStyle = element.strokeColor
      canvas.textAlign = element.textAlign
      let horizontalOffset =
        element.textAlign == "center"
        ? element.width / 2 : element.textAlign == "right" ? element.width : 0
      let lineHeightPx = element.fontSize * element.lineHeight
      let verticalOffset = FontMetrics.verticalOffset(
        family: element.fontFamily, fontSize: element.fontSize, lineHeightPx: lineHeightPx)
      for (index, line) in splitIntoLines(element.text).enumerated() {
        canvas.fillText(line, horizontalOffset, Double(index) * lineHeightPx + verticalOffset)
      }
      canvas.restore()
    default:
      break
    }
  }
}
