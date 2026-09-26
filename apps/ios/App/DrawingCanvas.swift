import DrawingKit
import SwiftUI
import Synchronization
import UIKit

/// The drawing on a surface that pans and pinches, drawn afresh at each zoom
/// so lines stay sharp. The elements are read once; a changed drawing is a
/// new canvas.
struct DrawingCanvas: UIViewRepresentable {
  let elements: [JSONValue]
  let background: String
  let theme: DrawingTheme

  func makeUIView(context: Context) -> DrawingScrollView {
    DrawingScrollView(elements: restoreElements(elements), background: background)
  }

  func updateUIView(_ view: DrawingScrollView, context: Context) {
    view.show(theme)
  }
}

final class DrawingScrollView: UIScrollView, UIScrollViewDelegate {
  /// Room round the drawing, in the drawing's units, so nothing sits on the
  /// screen's edge.
  private static let margin = 40.0
  private let tiles = SceneTilesView()
  private let elements: [DrawingElement]
  private let background: String
  private var theme: DrawingTheme?

  init(elements: [DrawingElement], background: String) {
    self.elements = elements
    self.background = background
    super.init(frame: .zero)
    delegate = self
    maximumZoomScale = 8
    bouncesZoom = true
    showsHorizontalScrollIndicator = false
    showsVerticalScrollIndicator = false
    contentInsetAdjustmentBehavior = .never
    addSubview(tiles)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  func show(_ theme: DrawingTheme) {
    guard theme != self.theme else { return }
    let fitsAgain = self.theme == nil
    self.theme = theme
    let scene = PreparedScene(
      elements, theme: theme, canvasBackgroundColor: background, measurer: FontLibrary.shared)
    let bounds = scene.contentBounds
    let size = CGSize(
      width: bounds.maxX - bounds.minX + Self.margin * 2,
      height: bounds.maxY - bounds.minY + Self.margin * 2)
    backgroundColor = UIColor(cgColor: theme.color(background))
    tiles.show(scene, size: size, background: background, margin: Self.margin)
    if fitsAgain {
      zoomScale = 1
      tiles.frame = CGRect(origin: .zero, size: size)
      contentSize = size
      setNeedsLayout()
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard bounds.width > 0, tiles.bounds.width > 0 else { return }
    let fit = min(bounds.width / tiles.bounds.width, bounds.height / tiles.bounds.height, 1)
    if minimumZoomScale != fit {
      let wasFitted = zoomScale <= minimumZoomScale
      minimumZoomScale = fit
      if wasFitted || zoomScale < fit { zoomScale = fit }
    }
    centerContent()
  }

  func viewForZooming(in scrollView: UIScrollView) -> UIView? { tiles }

  func scrollViewDidZoom(_ scrollView: UIScrollView) { centerContent() }

  /// A drawing smaller than the screen sits in its middle.
  private func centerContent() {
    let x = max((bounds.width - contentSize.width) / 2, 0)
    let y = max((bounds.height - contentSize.height) / 2, 0)
    contentInset = UIEdgeInsets(top: y, left: x, bottom: y, right: x)
  }
}

/// Draws the scene tile by tile, at the resolution each zoom needs.
final class SceneTilesView: UIView {
  override class var layerClass: AnyClass { SceneTileLayer.self }

  func show(_ scene: PreparedScene, size: CGSize, background: String, margin: Double) {
    bounds.size = size
    (layer as! SceneTileLayer).show(.init(scene: scene, background: background, margin: margin))
  }
}

/// Tiles are drawn off the main thread, so what they draw is handed over
/// under a lock.
final class SceneTileLayer: CATiledLayer, @unchecked Sendable {
  struct Content: Sendable {
    let scene: PreparedScene
    let background: String
    let margin: Double
  }

  private let content = Mutex<Content?>(nil)

  override class func fadeDuration() -> CFTimeInterval { 0 }

  override init() {
    super.init()
    levelsOfDetail = 5
    levelsOfDetailBias = 3
    tileSize = CGSize(width: 512, height: 512)
  }

  override init(layer: Any) { super.init(layer: layer) }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  func show(_ content: Content) {
    self.content.withLock { $0 = content }
    setNeedsDisplay()
  }

  override func draw(in context: CGContext) {
    guard let content = content.withLock({ $0 }) else { return }
    let scene = content.scene
    let scrollX = -scene.contentBounds.minX + content.margin
    let scrollY = -scene.contentBounds.minY + content.margin
    let tile = context.boundingBoxOfClipPath
    scene.render(
      on: CGCanvas(context: context, fonts: FontLibrary.shared), scale: 1, scrollX: scrollX,
      scrollY: scrollY, width: bounds.width, height: bounds.height,
      background: content.background, layerScale: abs(context.userSpaceToDeviceSpaceTransform.a),
      visible: Bounds(
        minX: tile.minX - scrollX, minY: tile.minY - scrollY, maxX: tile.maxX - scrollX,
        maxY: tile.maxY - scrollY))
  }
}
