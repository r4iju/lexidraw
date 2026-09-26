import Foundation

public struct Point2D: Equatable, Hashable, Sendable {
  public var x: Double
  public var y: Double

  public init(_ x: Double, _ y: Double) {
    self.x = x
    self.y = y
  }

  /// `pointRotateRads` from `@excalidraw/math`, with its operation order.
  func rotated(around center: Point2D, by angle: Double) -> Point2D {
    Point2D(
      (x - center.x) * cos(angle) - (y - center.y) * sin(angle) + center.x,
      (x - center.x) * sin(angle) + (y - center.y) * cos(angle) + center.y)
  }

  func distance(to other: Point2D) -> Double {
    hypot(x - other.x, y - other.y)
  }
}
