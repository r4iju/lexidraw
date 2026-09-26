import Foundation

/// `getFreeDrawSvgPath`: the outline of a freedraw stroke as SVG path data,
/// built and trimmed to two decimals as the web builds it.
func freedrawSVGPath(_ element: DrawingElement) -> String {
  let input: [FreehandInput]
  if element.simulatePressure {
    input = element.points.map { FreehandInput(x: $0.x, y: $0.y, pressure: nil) }
  } else if element.points.isEmpty {
    input = [FreehandInput(x: 0, y: 0, pressure: 0.5)]
  } else {
    input = element.points.enumerated().map { index, point in
      FreehandInput(
        x: point.x, y: point.y,
        pressure: index < element.pressures.count ? element.pressures[index] : nil)
    }
  }
  var options = StrokeOptions()
  options.simulatePressure = element.simulatePressure
  options.size = element.strokeWidth * 4.25
  options.thinning = 0.6
  options.smoothing = 0.5
  options.streamline = 0.5
  options.easing = { sin(($0 * Double.pi) / 2) }
  options.last = element.lastCommittedPoint != nil
  return svgPathFromStroke(getStroke(input, options))
}

private let toFixedPrecision = try! NSRegularExpression(
  pattern: "(\\s?[A-Z]?,?-?[0-9]*\\.[0-9]{0,2})(([0-9]|e|-)*)")

private func svgPathFromStroke(_ points: [Point2D]) -> String {
  guard let first = points.first else { return "" }
  func text(_ p: Point2D) -> String { "\(jsNumberString(p.x)),\(jsNumberString(p.y))" }
  var parts = ["M", text(first), "Q"]
  for (index, point) in points.enumerated() {
    if index == points.count - 1 {
      let median = Point2D((point.x + first.x) / 2, (point.y + first.y) / 2)
      parts += [text(point), text(median), "L", text(first), "Z"]
    } else {
      let next = points[index + 1]
      parts += [text(point), text(Point2D((point.x + next.x) / 2, (point.y + next.y) / 2))]
    }
  }
  let joined = parts.joined(separator: " ")
  return toFixedPrecision.stringByReplacingMatches(
    in: joined, range: NSRange(joined.startIndex..., in: joined), withTemplate: "$1")
}
