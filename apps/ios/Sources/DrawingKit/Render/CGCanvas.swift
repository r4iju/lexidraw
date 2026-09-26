import CoreGraphics
import CoreText
import Foundation

/// A `Canvas2D` that paints with Core Graphics.
public final class CGCanvas: Canvas2D {
  let context: CGContext
  private let fonts: FontLibrary
  /// How many of the canvas's saves hold a graphics state, so a restore
  /// with nothing saved leaves Core Graphics alone as the web does.
  private var saved = 0

  /// Paints into `context`, whose user space is taken as the canvas's, with
  /// y pointing down.
  public init(context: CGContext, fonts: FontLibrary) {
    self.context = context
    self.fonts = fonts
    super.init()
  }

  /// Paints into a bitmap of its own, `width` × `height` pixels with the
  /// origin at the top left, as a browser canvas is.
  public convenience init(width: Int, height: Int, fonts: FontLibrary) {
    let context = CGContext(
      data: nil, width: max(width, 1), height: max(height, 1), bitsPerComponent: 8,
      bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.translateBy(x: 0, y: CGFloat(context.height))
    context.scaleBy(x: 1, y: -1)
    self.init(context: context, fonts: fonts)
  }

  public func makeImage() -> CGImage? { context.makeImage() }

  public override func save() {
    super.save()
    context.saveGState()
    saved += 1
  }

  public override func restore() {
    guard saved > 0 else { return }
    super.restore()
    context.restoreGState()
    saved -= 1
  }

  /// The filter of the canvas this one is drawn into, for a layer.
  private var outerFilter: [ColorFilter] = []

  private var colorFilters: [ColorFilter] { [ColorFilter(filter)] + outerFilter }

  private func color(_ css: String) -> CGColor {
    let c = colorFilters.reduce(CSSColor(css) ?? .black) { $1.apply($0) }
    return CGColor(srgbRed: c.red, green: c.green, blue: c.blue, alpha: c.alpha)
  }

  private func cgPath(_ elements: [PathElement], _ transform: CGAffineTransform = .identity)
    -> CGPath
  {
    let result = CGMutablePath()
    for element in elements {
      switch element {
      case .move(let p): result.move(to: CGPoint(x: p.x, y: p.y), transform: transform)
      case .line(let p): result.addLine(to: CGPoint(x: p.x, y: p.y), transform: transform)
      case .quad(let c, let p):
        result.addQuadCurve(
          to: CGPoint(x: p.x, y: p.y), control: CGPoint(x: c.x, y: c.y), transform: transform)
      case .cubic(let c1, let c2, let p):
        result.addCurve(
          to: CGPoint(x: p.x, y: p.y), control1: CGPoint(x: c1.x, y: c1.y),
          control2: CGPoint(x: c2.x, y: c2.y), transform: transform)
      case .close: result.closeSubpath()
      }
    }
    return result
  }

  private var affine: CGAffineTransform {
    let t = state.transform
    return CGAffineTransform(a: t.a, b: t.b, c: t.c, d: t.d, tx: t.e, ty: t.f)
  }

  private func paint(_ body: () -> Void) {
    context.saveGState()
    context.setAlpha(globalAlpha)
    body()
    context.restoreGState()
  }

  private func fill(_ elements: [PathElement], _ rule: FillRule) {
    paint {
      context.addPath(cgPath(elements))
      context.setFillColor(color(fillStyle))
      context.fillPath(using: rule == .evenodd ? .evenOdd : .winding)
    }
  }

  /// Strokes are drawn in user space, where the line width and dashes are
  /// given; the path, kept in device space, is taken back there first.
  public override func stroke() {
    let transform = affine
    guard transform.a * transform.d - transform.b * transform.c != 0 else { return }
    paint {
      context.concatenate(transform)
      context.addPath(cgPath(path, transform.inverted()))
      context.setLineWidth(lineWidth)
      context.setLineCap(lineCap == "round" ? .round : lineCap == "square" ? .square : .butt)
      context.setLineJoin(lineJoin == "round" ? .round : lineJoin == "bevel" ? .bevel : .miter)
      context.setLineDash(phase: lineDashOffset, lengths: state.lineDash.map { CGFloat($0) })
      context.setStrokeColor(color(strokeStyle))
      context.strokePath()
    }
  }

  public override func fill(_ rule: FillRule = .nonzero) { fill(path, rule) }

  public override func fill(svgPath d: String, _ rule: FillRule = .nonzero) {
    fill(devicePath(svg: d), rule)
  }

  public override func clip(_ rule: FillRule = .nonzero) {
    context.addPath(cgPath(path))
    context.clip(using: rule == .evenodd ? .evenOdd : .winding)
  }

  private func quadPath(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> [PathElement] {
    let q = quad(x, y, w, h)
    return [.move(q[0]), .line(q[1]), .line(q[2]), .line(q[3]), .close]
  }

  public override func fillRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {
    fill(quadPath(x, y, width, height), .nonzero)
  }

  public override func clearRect(_ x: Double, _ y: Double, _ width: Double, _ height: Double) {
    context.saveGState()
    context.setBlendMode(.clear)
    context.addPath(cgPath(quadPath(x, y, width, height)))
    context.fillPath()
    context.restoreGState()
  }

  public override func fillText(_ text: String, _ x: Double, _ y: Double) {
    let pieces = fonts.pieces(text, font: font, color: color(fillStyle))
    let width = fonts.width(of: text, font: font)
    let offset =
      switch textAlign {
      case "center": -width / 2
      case "right", "end": -width
      default: 0.0
      }
    // Upright text sits on a whole device pixel, rounded to the nearest as
    // the web rounds it; Core Graphics would otherwise snap it downwards.
    var baseline = y
    let t = affine.concatenating(context.userSpaceToDeviceSpaceTransform)
    if t.b == 0, t.c == 0, t.d != 0 {
      let device = t.d * y + t.ty
      baseline = y + ((device.rounded() + 1e-6) - device) / t.d
    }
    paint {
      context.concatenate(affine)
      context.textMatrix = CGAffineTransform(scaleX: 1, y: -1)
      for piece in pieces {
        context.textPosition = CGPoint(x: x + offset + piece.x, y: baseline)
        CTLineDraw(piece.line, context)
      }
    }
  }

  /// A layer is drawn into this canvas under this canvas's filter. The
  /// filter maps each colour on its own and compositing mixes colours
  /// linearly, so the layer paints with the filter already applied instead.
  public override func makeLayer(width: Int, height: Int) -> Canvas2D {
    let layer = CGCanvas(width: width, height: height, fonts: fonts)
    layer.outerFilter = colorFilters
    return layer
  }

  public override func drawLayer(
    _ layer: Canvas2D, size: (width: Int, height: Int), _ x: Double, _ y: Double, _ width: Double,
    _ height: Double
  ) {
    guard let layer = layer as? CGCanvas,
      let image = layer.makeImage()
    else { return }
    paint {
      context.concatenate(affine)
      context.translateBy(x: x, y: y + height)
      context.scaleBy(x: 1, y: -1)
      context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
  }
}

extension DrawingTheme {
  /// A colour as a drawing shows it in this theme.
  public func color(_ css: String) -> CGColor {
    let c = ColorFilter(self == .dark ? themeFilter : "none").apply(CSSColor(css) ?? .black)
    return CGColor(srgbRed: c.red, green: c.green, blue: c.blue, alpha: c.alpha)
  }
}

/// A CSS `filter` of `invert()` and `hue-rotate()` steps, the ones the dark
/// theme uses. Each maps a colour on its own, so a solid colour can be
/// mapped before it is drawn rather than filtering what it drew.
struct ColorFilter {
  private var steps: [(matrix: [Double], offset: Double)] = []

  init(_ css: String) {
    for match in css.matches(of: /([a-z-]+)\(\s*(-?[0-9.]+)(%|deg)?\s*\)/) {
      guard let amount = Double(match.output.2) else { continue }
      switch match.output.1 {
      case "invert":
        let a = min(1, match.output.3 == "%" ? amount / 100 : amount)
        let k = 1 - 2 * a
        steps.append(([k, 0, 0, 0, k, 0, 0, 0, k], a))
      case "hue-rotate":
        let angle = amount * Double.pi / 180
        let (c, s) = (cos(angle), sin(angle))
        steps.append(
          (
            [
              0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715,
              0.072 - c * 0.072 + s * 0.928,
              0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140,
              0.072 - c * 0.072 - s * 0.283,
              0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715,
              0.072 + c * 0.928 + s * 0.072,
            ], 0
          ))
      default:
        break
      }
    }
  }

  func apply(_ color: CSSColor) -> CSSColor {
    var (r, g, b) = (color.red, color.green, color.blue)
    for (m, offset) in steps {
      let clamp = { (v: Double) in min(1, max(0, v + offset)) }
      (r, g, b) = (
        clamp(m[0] * r + m[1] * g + m[2] * b), clamp(m[3] * r + m[4] * g + m[5] * b),
        clamp(m[6] * r + m[7] * g + m[8] * b)
      )
    }
    return CSSColor(red: r, green: g, blue: b, alpha: color.alpha)
  }
}
