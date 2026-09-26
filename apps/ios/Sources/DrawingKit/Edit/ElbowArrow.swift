import Foundation

// Elbow arrows routed as `elbowArrow.ts` routes them: out of each bound
// shape along a heading, then around the shapes by A* on a grid of their
// padded edges, with each bend priced high so the path turns as little as
// it can.

private let dedupThreshold = 1.0
private let basePadding = 40.0
private let fixedBindingDistance = 5.0
private let maxPosition = 1e6

/// The web's `Bounds` tuple: `[minX, minY, maxX, maxY]`.
private typealias Box = [Double]

private func clamp(_ value: Double, _ lower: Double, _ upper: Double) -> Double {
  min(max(value, lower), upper)
}

private func clamp(_ p: Point2D) -> Point2D {
  Point2D(clamp(p.x, -maxPosition, maxPosition), clamp(p.y, -maxPosition, maxPosition))
}

/// `pointInsideBounds`, which leaves the edges out.
private func isInside(_ p: Point2D, _ box: Box) -> Bool {
  p.x > box[0] && p.x < box[2] && p.y > box[1] && p.y < box[3]
}

private func middle(of box: Box) -> Point2D {
  Point2D(box[0] + (box[2] - box[0]) / 2, box[1] + (box[3] - box[1]) / 2)
}

private func commonBox(_ boxes: [Box]) -> Box {
  [
    boxes.map { $0[0] }.min()!, boxes.map { $0[1] }.min()!, boxes.map { $0[2] }.max()!,
    boxes.map { $0[3] }.max()!,
  ]
}

/// `pointScaleFromOrigin`.
private func scaled(_ p: Point2D, from origin: Point2D, _ factor: Double) -> Point2D {
  point(scaled(vector(p, from: origin), factor), from: origin)
}

private func manhattan(_ a: Point2D, _ b: Point2D) -> Double { abs(a.x - b.x) + abs(a.y - b.y) }

private func triangleIncludes(_ t: [Point2D], _ p: Point2D) -> Bool {
  func sign(_ p1: Point2D, _ p2: Point2D, _ p3: Point2D) -> Double {
    (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
  }
  let d1 = sign(p, t[0], t[1])
  let d2 = sign(p, t[1], t[2])
  let d3 = sign(p, t[2], t[0])
  let negative = d1 < 0 || d2 < 0 || d3 < 0
  let positive = d1 > 0 || d2 > 0 || d3 > 0
  return !(negative && positive)
}

/// `heading.ts`: a direction along one axis.
private enum Heading {
  case up, right, down, left

  /// `vectorToHeading`.
  init(_ v: Point2D) {
    let absX = abs(v.x)
    let absY = abs(v.y)
    if v.x > absY {
      self = .right
    } else if v.x <= -absY {
      self = .left
    } else if v.y > absX {
      self = .down
    } else {
      self = .up
    }
  }

  /// `headingForPoint`: the way from `o` to `p`.
  init(_ p: Point2D, from o: Point2D) { self.init(vector(p, from: o)) }

  var flipped: Heading {
    switch self {
    case .up: .down
    case .right: .left
    case .down: .up
    case .left: .right
    }
  }

  var isHorizontal: Bool { self == .left || self == .right }
  /// Right or down, the way coordinates grow.
  var isPositive: Bool { self == .right || self == .down }

  /// `offsetFromHeading`: `head` on the heading's side and `side` on the
  /// others, as the top, right, bottom and left offsets `aabbForElement`
  /// takes.
  func offsets(head: Double, side: Double) -> [Double] {
    switch self {
    case .up: [head, side, side, side]
    case .right: [side, head, side, side]
    case .down: [side, side, head, side]
    case .left: [side, side, side, head]
    }
  }
}

/// `headingForDiamond`.
private func diamondHeading(_ a: Point2D, _ b: Point2D) -> Heading {
  let angle = atan2(b.y - a.y, b.x - a.x) * 180 / .pi
  if angle >= 315 || angle < 45 { return .up }
  if angle >= 45 && angle < 135 { return .right }
  if angle >= 135 && angle < 225 { return .down }
  return .left
}

/// `normalizeFixedPoint`: a ratio at the middle is moved off it a little,
/// as the web stores it.
func normalizedFixedPoint(_ ratio: [Double]) -> [Double] {
  guard ratio.contains(where: { abs($0 - 0.5) < 1e-4 }) else { return ratio }
  return ratio.map { abs($0 - 0.5) < 1e-4 ? 0.5001 : $0 }
}

/// The `fixedPoint` of a binding that has one, as `isFixedPointBinding`
/// tells.
func fixedPoint(of binding: JSONValue?) -> [Double]? {
  guard let values = binding?["fixedPoint"]?.arrayValue?.compactMap(\.numberValue), values.count == 2 else {
    return nil
  }
  return values
}

extension DrawingElement {
  /// `getGlobalFixedPointForBindableElement`: where on the shape a fixed
  /// point binding's ratio lands.
  func globalFixedPoint(_ ratio: [Double]) -> Point2D {
    let r = normalizedFixedPoint(ratio)
    return Point2D(x + width * r[0], y + height * r[1]).rotated(around: center, by: angle)
  }

  /// `aabbForElement`, grown by top, right, bottom and left offsets.
  fileprivate func box(_ offsets: [Double]? = nil) -> Box {
    let b = axisAlignedBounds
    guard let o = offsets else { return [b.minX, b.minY, b.maxX, b.maxY] }
    return [b.minX - o[3], b.minY - o[0], b.maxX + o[1], b.maxY + o[2]]
  }

  /// `headingForPointFromElement`: which side of the shape `p` is off,
  /// by cones out of the middle of `box`.
  fileprivate func heading(of p: Point2D, _ box: Box) -> Heading {
    let mid = middle(of: box)
    func spread(_ q: Point2D) -> Point2D { scaled(q, from: mid, 2) }
    if type == .diamond {
      if p.x < x { return .left }
      if p.y < y { return .up }
      if p.x > x + width { return .right }
      if p.y > y + height { return .down }
      let top = spread(Point2D(x + width / 2, y)).rotated(around: mid, by: angle)
      let right = spread(Point2D(x + width, y + height / 2)).rotated(around: mid, by: angle)
      let bottom = spread(Point2D(x + width / 2, y + height)).rotated(around: mid, by: angle)
      let left = spread(Point2D(x, y + height / 2)).rotated(around: mid, by: angle)
      if triangleIncludes([top, right, mid], p) { return diamondHeading(top, right) }
      if triangleIncludes([right, bottom, mid], p) { return diamondHeading(right, bottom) }
      if triangleIncludes([bottom, left, mid], p) { return diamondHeading(bottom, left) }
      return diamondHeading(left, top)
    }
    let topLeft = spread(Point2D(box[0], box[1]))
    let topRight = spread(Point2D(box[2], box[1]))
    let bottomLeft = spread(Point2D(box[0], box[3]))
    let bottomRight = spread(Point2D(box[2], box[3]))
    if triangleIncludes([topLeft, topRight, mid], p) { return .up }
    if triangleIncludes([topRight, bottomRight, mid], p) { return .right }
    if triangleIncludes([bottomRight, bottomLeft, mid], p) { return .down }
    return .left
  }

  /// `avoidRectangularCorner`: a point off a corner moves to the nearer
  /// side next to it.
  fileprivate func avoidingCorner(_ p: Point2D) -> Point2D {
    let d = fixedBindingDistance
    let q = p.rotated(around: center, by: -angle)
    func turned(_ x: Double, _ y: Double) -> Point2D { Point2D(x, y).rotated(around: center, by: angle) }
    if q.x < x && q.y < y {
      return q.y - y > -d ? turned(x - d, y) : turned(x, y - d)
    }
    if q.x < x && q.y > y + height {
      return q.x - x > -d ? turned(x, y + height + d) : turned(x - d, y + height)
    }
    if q.x > x + width && q.y > y + height {
      return q.x - x < width + d ? turned(x + width, y + height + d) : turned(x + width + d, y + height)
    }
    if q.x > x + width && q.y < y {
      return q.x - x < width + d ? turned(x + width, y - d) : turned(x + width + d, y)
    }
    return p
  }

  /// `headingToMidBindPoint`: the middle of the side `p` is towards.
  fileprivate func midBindPoint(towards p: Point2D, _ box: Box) -> Point2D {
    let mid = middle(of: box)
    let q: Point2D =
      switch Heading(p, from: mid) {
      case .up: Point2D((box[0] + box[2]) / 2 + 0.1, box[1])
      case .right: Point2D(box[2], (box[1] + box[3]) / 2 + 0.1)
      case .down: Point2D((box[0] + box[2]) / 2 - 0.1, box[3])
      case .left: Point2D(box[0], (box[1] + box[3]) / 2 - 0.1)
      }
    return q.rotated(around: mid, by: angle)
  }

  /// `bindPointToSnapToElementOutline`: `p` moved to just off the outline,
  /// or to the middle of a side when it is well inside.
  fileprivate func snappedToOutline(_ p: Point2D) -> Point2D {
    let box = box()
    let p = type == .ellipse ? p : avoidingCorner(p)
    let mid = middle(of: box)
    let intersection = outlineIntersections(
      mid, point(scaled(normalized(vector(p, from: mid)), max(width, height)), from: mid)
    ).first
    let current = p.distance(to: mid)
    let full = max((intersection ?? p).distance(to: mid), 1e-4)
    let ratio = ((current / full + .ulpOfOne) * 1e6).rounded(.toNearestOrAwayFromZero) / 1e6
    guard ratio > 0.9 else { return midBindPoint(towards: p, box) }
    guard let intersection, current - full <= fixedBindingDistance,
      pow(intersection.x - p.x, 2) + pow(intersection.y - p.y, 2) >= 1e-4
    else { return p }
    return point(
      scaled(normalized(vector(p, from: intersection)), ratio > 1 ? fixedBindingDistance : -fixedBindingDistance),
      from: intersection)
  }
}

/// A segment of an elbow arrow the user has placed, which routing keeps.
private struct FixedSegment {
  var index: Int
  var start: Point2D
  var end: Point2D

  init(index: Int, start: Point2D, end: Point2D) {
    (self.index, self.start, self.end) = (index, start, end)
  }

  init?(_ json: JSONValue) {
    guard let index = json["index"]?.intValue, let start = json["start"]?.arrayValue?.compactMap(\.numberValue),
      let end = json["end"]?.arrayValue?.compactMap(\.numberValue), start.count == 2, end.count == 2
    else { return nil }
    self.init(index: index, start: Point2D(start[0], start[1]), end: Point2D(end[0], end[1]))
  }

  var json: JSONValue { ["index": .number(Double(index)), "start": .point(start), "end": .point(end)] }
}

/// An elbow arrow as stored, with what routing reads of it.
private struct StoredElbowArrow {
  var x: Double
  var y: Double
  var points: [Point2D]
  var startBinding: JSONValue?
  var endBinding: JSONValue?
  var startArrowhead: Bool
  var endArrowhead: Bool
  var fixedSegments: JSONValue?
  var startIsSpecial: JSONValue?
  var endIsSpecial: JSONValue?

  init(_ raw: RawElement) {
    x = raw.number("x")
    y = raw.number("y")
    points = raw.points
    startBinding = raw["startBinding"]
    endBinding = raw["endBinding"]
    startArrowhead = !(raw["startArrowhead"]?.stringValue ?? "").isEmpty
    endArrowhead = !(raw["endArrowhead"]?.stringValue ?? "").isEmpty
    fixedSegments = raw["fixedSegments"]
    startIsSpecial = raw["startIsSpecial"]
    endIsSpecial = raw["endIsSpecial"]
  }

  var isStartBound: Bool { startBinding.map { $0 != .null } ?? false }
  func global(_ p: Point2D) -> Point2D { Point2D(x + p.x, y + p.y) }
}

// MARK: The grid

private final class GridNode {
  var f = 0.0
  var g = 0.0
  var h = 0.0
  var closed = false
  var visited = false
  var parent: GridNode?
  let col: Int
  let row: Int
  let pos: Point2D

  init(col: Int, row: Int, pos: Point2D) {
    (self.col, self.row, self.pos) = (col, row, pos)
  }
}

private struct Grid {
  let rows: Int
  let cols: Int
  let data: [GridNode]

  /// `calculateGrid`: a node wherever the lines along the boxes' edges,
  /// the common box's, and each end's heading cross.
  init(_ boxes: [Box], start: Point2D, _ startHeading: Heading, end: Point2D, _ endHeading: Heading, _ common: Box) {
    var horizontal = Set<Double>()
    var vertical = Set<Double>()
    if startHeading.isHorizontal { vertical.insert(start.y) } else { horizontal.insert(start.x) }
    if endHeading.isHorizontal { vertical.insert(end.y) } else { horizontal.insert(end.x) }
    for box in boxes {
      horizontal.insert(box[0])
      horizontal.insert(box[2])
      vertical.insert(box[1])
      vertical.insert(box[3])
    }
    horizontal.insert(common[0])
    horizontal.insert(common[2])
    vertical.insert(common[1])
    vertical.insert(common[3])
    let ys = vertical.sorted()
    let xs = horizontal.sorted()
    rows = ys.count
    cols = xs.count
    data = ys.enumerated().flatMap { row, y in
      xs.enumerated().map { col, x in GridNode(col: col, row: row, pos: Point2D(x, y)) }
    }
  }

  func node(_ col: Int, _ row: Int) -> GridNode? {
    col < 0 || col >= cols || row < 0 || row >= rows ? nil : data[row * cols + col]
  }

  /// `pointToGridNode`.
  func node(at p: Point2D) -> GridNode? {
    for col in 0..<cols {
      for row in 0..<rows {
        if let candidate = node(col, row), p.x == candidate.pos.x, p.y == candidate.pos.y { return candidate }
      }
    }
    return nil
  }

  /// `getNeighbors`: up, right, down and left.
  func neighbors(_ node: GridNode) -> [GridNode?] {
    [self.node(node.col, node.row - 1), self.node(node.col + 1, node.row), self.node(node.col, node.row + 1),
     self.node(node.col - 1, node.row)]
  }
}

/// `binaryheap.ts`: the open nodes, cheapest first.
private struct BinaryHeap {
  var content: [GridNode] = []

  mutating func sinkDown(_ start: Int) {
    var index = start
    let node = content[index]
    while index > 0 {
      let parentIndex = ((index + 1) >> 1) - 1
      let parent = content[parentIndex]
      guard node.f < parent.f else { break }
      content[parentIndex] = node
      content[index] = parent
      index = parentIndex
    }
  }

  mutating func bubbleUp(_ start: Int) {
    var index = start
    let length = content.count
    let node = content[index]
    let score = node.f
    while true {
      let child2 = (index + 1) << 1
      let child1 = child2 - 1
      var swap: Int?
      var child1Score = 0.0
      if child1 < length {
        child1Score = content[child1].f
        if child1Score < score { swap = child1 }
      }
      if child2 < length, content[child2].f < (swap == nil ? score : child1Score) { swap = child2 }
      guard let swap else { break }
      content[index] = content[swap]
      content[swap] = node
      index = swap
    }
  }

  mutating func push(_ node: GridNode) {
    content.append(node)
    sinkDown(content.count - 1)
  }

  mutating func pop() -> GridNode? {
    guard !content.isEmpty else { return nil }
    let result = content[0]
    let end = content.removeLast()
    if !content.isEmpty {
      content[0] = end
      bubbleUp(0)
    }
    return result
  }

  mutating func rescore(_ node: GridNode) {
    if let index = content.firstIndex(where: { $0 === node }) { sinkDown(index) }
  }
}

/// `estimateSegmentCount`: how many segments are still to come from
/// `start` heading one way to `end` arrived at heading another.
private func estimatedSegments(_ start: GridNode, _ end: GridNode, _ startHeading: Heading, _ endHeading: Heading)
  -> Double
{
  let (s, e) = (start.pos, end.pos)
  switch (endHeading, startHeading) {
  case (.right, .right): return s.x >= e.x ? 4 : s.y == e.y ? 0 : 2
  case (.right, .up): return s.y > e.y && s.x < e.x ? 1 : 3
  case (.right, .down): return s.y < e.y && s.x < e.x ? 1 : 3
  case (.right, .left): return s.y == e.y ? 4 : 2
  case (.left, .right): return s.y == e.y ? 4 : 2
  case (.left, .up): return s.y > e.y && s.x > e.x ? 1 : 3
  case (.left, .down): return s.y < e.y && s.x > e.x ? 1 : 3
  case (.left, .left): return s.x <= e.x ? 4 : s.y == e.y ? 0 : 2
  case (.up, .right): return s.y > e.y && s.x < e.x ? 1 : 3
  case (.up, .up): return s.y >= e.y ? 4 : s.x == e.x ? 0 : 2
  case (.up, .down): return s.x == e.x ? 4 : 2
  case (.up, .left): return s.y > e.y && s.x > e.x ? 1 : 3
  case (.down, .right): return s.y < e.y && s.x < e.x ? 1 : 3
  case (.down, .up): return s.x == e.x ? 4 : 2
  case (.down, .down): return s.y <= e.y ? 4 : s.x == e.x ? 0 : 2
  case (.down, .left): return s.y < e.y && s.x > e.x ? 1 : 3
  }
}

/// `astar`: the cheapest path on the grid, never going back on itself nor
/// through the middle of a box.
private func astar(
  _ start: GridNode, _ end: GridNode, _ grid: Grid, _ startHeading: Heading, _ endHeading: Heading, _ boxes: [Box]
) -> [GridNode]? {
  let bendMultiplier = manhattan(start.pos, end.pos)
  var open = BinaryHeap()
  open.push(start)
  while let current = open.pop() {
    if current.closed { continue }
    if current === end {
      var path: [GridNode] = []
      var node = current
      while let parent = node.parent {
        path.insert(node, at: 0)
        node = parent
      }
      return [start] + path
    }
    current.closed = true
    let neighbors = grid.neighbors(current)
    for (index, heading) in [Heading.up, .right, .down, .left].enumerated() {
      guard let neighbor = neighbors[index], !neighbor.closed else { continue }
      let halfway = scaled(neighbor.pos, from: current.pos, 0.5)
      if boxes.contains(where: { isInside(halfway, $0) }) { continue }
      let previous = current.parent.map { Heading(current.pos, from: $0.pos) } ?? startHeading
      if previous.flipped == heading || (start.col == neighbor.col && start.row == neighbor.row && heading == startHeading)
        || (end.col == neighbor.col && end.row == neighbor.row && heading == endHeading)
      {
        continue
      }
      let g = current.g + manhattan(neighbor.pos, current.pos) + (previous != heading ? pow(bendMultiplier, 3) : 0)
      let visited = neighbor.visited
      if !visited || g < neighbor.g {
        let bends = estimatedSegments(neighbor, end, heading, endHeading)
        neighbor.visited = true
        neighbor.parent = current
        neighbor.h = manhattan(end.pos, neighbor.pos) + bends * pow(bendMultiplier, 2)
        neighbor.g = g
        neighbor.f = neighbor.g + neighbor.h
        if visited { open.rescore(neighbor) } else { open.push(neighbor) }
      }
    }
  }
  return nil
}

// MARK: Routing

/// What `getElbowArrowData` works out before routing: where the ends are,
/// which way each leaves, and the boxes the path keeps out of.
private struct ElbowArrowData {
  var dynamicBoxes: [Box]
  var startDongle: Point2D
  var startGlobalPoint: Point2D
  var startHeading: Heading
  var endDongle: Point2D
  var endGlobalPoint: Point2D
  var endHeading: Heading
  var commonBounds: Box
  var hoveredStartElement: DrawingElement?
  var hoveredEndElement: DrawingElement?
}

/// `getGlobalPoint`: a bound end sits at its fixed point when that is just
/// off the outline, and is snapped there otherwise.
private func globalPoint(
  _ arrow: StoredElbowArrow, _ points: [Point2D], _ end: ArrowEnd, _ binding: JSONValue?, _ initial: Point2D,
  _ bound: DrawingElement?
) -> Point2D {
  guard let bound else { return initial }
  let fixed = bound.globalFixedPoint(fixedPoint(of: binding) ?? [0, 0])
  guard abs(bound.distanceToOutline(fixed) - fixedBindingDistance) > 0.01 else { return fixed }
  return bound.snappedToOutline(arrow.global(end == .start ? points[0] : points[points.count - 1]))
}

/// `getBindPointHeading`: an end bound to a shape leaves it the way the
/// side it is on faces; a free end heads for the other.
private func bindPointHeading(_ p: Point2D, _ other: Point2D, _ element: DrawingElement?, _ origin: Point2D) -> Heading {
  guard let element else { return Heading(other, from: p) }
  let distance = element.distanceToOutline(origin)
  if !(distance <= element.maxBindingGap(width: element.width, height: element.height)) || distance == 0 {
    return Heading(p, from: element.center)
  }
  return element.heading(of: p, element.box(Array(repeating: element.distanceToOutline(p), count: 4)))
}

/// `getDonglePosition`: where the end's first segment meets its box.
private func donglePosition(_ box: Box, _ heading: Heading, _ p: Point2D) -> Point2D {
  switch heading {
  case .up: Point2D(p.x, box[1])
  case .right: Point2D(box[2], p.y)
  case .down: Point2D(p.x, box[3])
  case .left: Point2D(box[0], p.y)
  }
}

/// `generateDynamicAABBs`: a box around each end, grown out to meet the
/// other's halfway where they face each other.
private func dynamicBoxes(
  _ a: Box, _ b: Box, _ common: Box, _ startDifference: [Double], _ endDifference: [Double], disableSideHack: Bool,
  _ startElementBounds: Box?, _ endElementBounds: Box?
) -> [Box] {
  let startEl = startElementBounds ?? a
  let endEl = endElementBounds ?? b
  let (startUp, startRight, startDown, startLeft) = (
    startDifference[0], startDifference[1], startDifference[2], startDifference[3]
  )
  let (endUp, endRight, endDown, endLeft) = (endDifference[0], endDifference[1], endDifference[2], endDifference[3])
  let first: Box = [
    a[0] > b[2]
      ? (a[1] > b[3] || a[3] < b[1] ? min((startEl[0] + endEl[2]) / 2, a[0] - startLeft) : (startEl[0] + endEl[2]) / 2)
      : a[0] > b[0] ? a[0] - startLeft : common[0] - startLeft,
    a[1] > b[3]
      ? (a[0] > b[2] || a[2] < b[0] ? min((startEl[1] + endEl[3]) / 2, a[1] - startUp) : (startEl[1] + endEl[3]) / 2)
      : a[1] > b[1] ? a[1] - startUp : common[1] - startUp,
    a[2] < b[0]
      ? (a[1] > b[3] || a[3] < b[1] ? max((startEl[2] + endEl[0]) / 2, a[2] + startRight) : (startEl[2] + endEl[0]) / 2)
      : a[2] < b[2] ? a[2] + startRight : common[2] + startRight,
    a[3] < b[1]
      ? (a[0] > b[2] || a[2] < b[0] ? max((startEl[3] + endEl[1]) / 2, a[3] + startDown) : (startEl[3] + endEl[1]) / 2)
      : a[3] < b[3] ? a[3] + startDown : common[3] + startDown,
  ]
  let second: Box = [
    b[0] > a[2]
      ? (b[1] > a[3] || b[3] < a[1] ? min((endEl[0] + startEl[2]) / 2, b[0] - endLeft) : (endEl[0] + startEl[2]) / 2)
      : b[0] > a[0] ? b[0] - endLeft : common[0] - endLeft,
    b[1] > a[3]
      ? (b[0] > a[2] || b[2] < a[0] ? min((endEl[1] + startEl[3]) / 2, b[1] - endUp) : (endEl[1] + startEl[3]) / 2)
      : b[1] > a[1] ? b[1] - endUp : common[1] - endUp,
    b[2] < a[0]
      ? (b[1] > a[3] || b[3] < a[1] ? max((endEl[2] + startEl[0]) / 2, b[2] + endRight) : (endEl[2] + startEl[0]) / 2)
      : b[2] < a[2] ? b[2] + endRight : common[2] + endRight,
    b[3] < a[1]
      ? (b[0] > a[2] || b[2] < a[0] ? max((endEl[3] + startEl[1]) / 2, b[3] + endDown) : (endEl[3] + startEl[1]) / 2)
      : b[3] < a[3] ? b[3] + endDown : common[3] + endDown,
  ]
  let c = commonBox([first, second])
  guard !disableSideHack, first[2] - first[0] + second[2] - second[0] > c[2] - c[0] + 1e-11,
    first[3] - first[1] + second[3] - second[1] > c[3] - c[1] + 1e-11
  else { return [first, second] }
  // Boxes that overlap are cut apart halfway between them, across one
  // axis or the other by how the start box sits against the end box's
  // centre.
  let endCenter = Point2D((second[0] + second[2]) / 2, (second[1] + second[3]) / 2)
  func leans(_ p: Point2D, _ q: Point2D) -> Bool {
    cross(Point2D(p.x - endCenter.x, p.y - endCenter.y), Point2D(q.x - endCenter.x, q.y - endCenter.y)) > 0
  }
  if b[0] > a[2] && a[1] > b[3] {
    let cX = first[2] + (second[0] - first[2]) / 2
    let cY = second[3] + (first[1] - second[3]) / 2
    if leans(Point2D(a[2], a[1]), Point2D(a[0], a[3])) {
      return [[first[0], first[1], cX, first[3]], [cX, second[1], second[2], second[3]]]
    }
    return [[first[0], cY, first[2], first[3]], [second[0], second[1], second[2], cY]]
  } else if a[2] < b[0] && a[3] < b[1] {
    let cX = first[2] + (second[0] - first[2]) / 2
    let cY = first[3] + (second[1] - first[3]) / 2
    if leans(Point2D(a[0], a[1]), Point2D(a[2], a[3])) {
      return [[first[0], first[1], first[2], cY], [second[0], cY, second[2], second[3]]]
    }
    return [[first[0], first[1], cX, first[3]], [cX, second[1], second[2], second[3]]]
  } else if a[0] > b[2] && a[3] < b[1] {
    let cX = second[2] + (first[0] - second[2]) / 2
    let cY = first[3] + (second[1] - first[3]) / 2
    if leans(Point2D(a[2], a[1]), Point2D(a[0], a[3])) {
      return [[cX, first[1], first[2], first[3]], [second[0], second[1], cX, second[3]]]
    }
    return [[first[0], first[1], first[2], cY], [second[0], cY, second[2], second[3]]]
  } else if a[0] > b[2] && a[1] > b[3] {
    let cX = second[2] + (first[0] - second[2]) / 2
    let cY = second[3] + (first[1] - second[3]) / 2
    if leans(Point2D(a[0], a[1]), Point2D(a[2], a[3])) {
      return [[cX, first[1], first[2], first[3]], [second[0], second[1], cX, second[3]]]
    }
    return [[first[0], cY, first[2], first[3]], [second[0], second[1], second[2], cY]]
  }
  return [first, second]
}

/// `getElbowArrowData`, for an arrow not being dragged by an end.
private func elbowArrowData(
  _ arrow: StoredElbowArrow, startBinding: JSONValue?, endBinding: JSONValue?, _ nextPoints: [Point2D],
  _ startElement: DrawingElement?, _ endElement: DrawingElement?
) -> ElbowArrowData {
  let origStart = arrow.global(nextPoints[0])
  let origEnd = arrow.global(nextPoints[nextPoints.count - 1])
  let hoveredStart = startElement
  let hoveredEnd = endElement
  let startGlobal = globalPoint(arrow, nextPoints, .start, startBinding, origStart, startElement)
  let endGlobal = globalPoint(arrow, nextPoints, .end, endBinding, origEnd, endElement)
  let startHeading = bindPointHeading(startGlobal, endGlobal, hoveredStart, origStart)
  let endHeading = bindPointHeading(endGlobal, startGlobal, hoveredEnd, origEnd)
  let startPointBounds: Box = [startGlobal.x - 2, startGlobal.y - 2, startGlobal.x + 2, startGlobal.y + 2]
  let endPointBounds: Box = [endGlobal.x - 2, endGlobal.y - 2, endGlobal.x + 2, endGlobal.y + 2]
  let startHead = arrow.startArrowhead ? fixedBindingDistance * 6 : fixedBindingDistance * 2
  let endHead = arrow.endArrowhead ? fixedBindingDistance * 6 : fixedBindingDistance * 2
  let startElementBounds = hoveredStart?.box(startHeading.offsets(head: startHead, side: 1)) ?? startPointBounds
  let endElementBounds = hoveredEnd?.box(endHeading.offsets(head: endHead, side: 1)) ?? endPointBounds
  let boundsOverlap =
    isInside(startGlobal, hoveredEnd?.box(endHeading.offsets(head: basePadding, side: basePadding)) ?? endPointBounds)
    || isInside(
      endGlobal, hoveredStart?.box(startHeading.offsets(head: basePadding, side: basePadding)) ?? startPointBounds)
  let commonBounds = commonBox(
    boundsOverlap ? [startPointBounds, endPointBounds] : [startElementBounds, endElementBounds])
  let unbound = hoveredStart == nil && hoveredEnd == nil
  let boxes = dynamicBoxes(
    boundsOverlap ? startPointBounds : startElementBounds,
    boundsOverlap ? endPointBounds : endElementBounds,
    commonBounds,
    boundsOverlap
      ? startHeading.offsets(head: unbound ? 0 : basePadding, side: 0)
      : startHeading.offsets(head: unbound ? 0 : basePadding - startHead, side: basePadding),
    boundsOverlap
      ? endHeading.offsets(head: unbound ? 0 : basePadding, side: 0)
      : endHeading.offsets(head: unbound ? 0 : basePadding - endHead, side: basePadding),
    disableSideHack: boundsOverlap,
    hoveredStart?.box(),
    hoveredEnd?.box())
  return ElbowArrowData(
    dynamicBoxes: boxes, startDongle: donglePosition(boxes[0], startHeading, startGlobal),
    startGlobalPoint: startGlobal, startHeading: startHeading,
    endDongle: donglePosition(boxes[1], endHeading, endGlobal), endGlobalPoint: endGlobal, endHeading: endHeading,
    commonBounds: commonBounds, hoveredStartElement: hoveredStart, hoveredEndElement: hoveredEnd)
}

/// `routeElbowArrow`: the path from end to end, in scene coordinates.
private func route(_ arrow: StoredElbowArrow, _ data: ElbowArrowData) -> [Point2D]? {
  let grid = Grid(
    data.dynamicBoxes, start: data.startDongle, data.startHeading, end: data.endDongle, data.endHeading,
    data.commonBounds)
  let startDongle = grid.node(at: data.startDongle)
  let endDongle = grid.node(at: data.endDongle)
  let endNode = grid.node(at: data.endGlobalPoint)
  if let endNode, data.hoveredEndElement != nil { endNode.closed = true }
  let startNode = grid.node(at: data.startGlobalPoint)
  if let startNode, arrow.isStartBound { startNode.closed = true }
  var dongleOverlap = false
  if let startDongle, let endDongle {
    dongleOverlap =
      isInside(startDongle.pos, data.dynamicBoxes[1]) || isInside(endDongle.pos, data.dynamicBoxes[0])
  }
  guard let from = startDongle ?? startNode, let to = endDongle ?? endNode,
    let path = astar(from, to, grid, data.startHeading, data.endHeading, dongleOverlap ? [] : data.dynamicBoxes)
  else { return nil }
  var points = path.map(\.pos)
  if startDongle != nil { points.insert(data.startGlobalPoint, at: 0) }
  if endDongle != nil { points.append(data.endGlobalPoint) }
  return points
}

/// `removeElbowArrowShortSegments`.
private func removingShortSegments(_ points: [Point2D]) -> [Point2D] {
  guard points.count >= 4 else { return points }
  return points.indices.filter { index in
    index == 0 || index == points.count - 1 || points[index - 1].distance(to: points[index]) > dedupThreshold
  }.map { points[$0] }
}

/// `getElbowArrowCornerPoints`: the ends and the points where the path
/// turns.
private func cornerPoints(_ points: [Point2D]) -> [Point2D] {
  guard points.count > 1 else { return points }
  var previousHorizontal = abs(points[0].y - points[1].y) < abs(points[0].x - points[1].x)
  return points.indices.filter { index in
    if index == 0 || index == points.count - 1 { return true }
    let p = points[index]
    let next = points[index + 1]
    let nextHorizontal = abs(p.y - next.y) < abs(p.x - next.x)
    defer { previousHorizontal = nextHorizontal }
    return previousHorizontal != nextHorizontal
  }.map { points[$0] }
}

/// `normalizeArrowElementUpdate`: the arrow placed at its first point,
/// with the rest relative to it.
private func normalizedUpdate(
  _ global: [Point2D], _ fixedSegments: [JSONValue]?, _ startIsSpecial: JSONValue?, _ endIsSpecial: JSONValue?
) -> RawElement? {
  guard let origin = global.first else { return nil }
  let points = global.map { clamp(Point2D($0.x - origin.x, $0.y - origin.y)) }
  let xs = points.map(\.x)
  let ys = points.map(\.y)
  var update: RawElement = [
    "points": .points(points), "x": .number(clamp(origin.x, -maxPosition, maxPosition)),
    "y": .number(clamp(origin.y, -maxPosition, maxPosition)),
    "fixedSegments": fixedSegments.flatMap { $0.isEmpty ? nil : .array($0) } ?? .null,
    "width": .number(xs.max()! - xs.min()!), "height": .number(ys.max()! - ys.min()!),
  ]
  update["startIsSpecial"] = startIsSpecial
  update["endIsSpecial"] = endIsSpecial
  return update
}

private func routedAndNormalized(_ arrow: StoredElbowArrow, _ data: ElbowArrowData) -> RawElement? {
  guard let path = route(arrow, data) else { return nil }
  return normalizedUpdate(cornerPoints(removingShortSegments(path)), nil, .null, .null)
}

/// `handleSegmentRenormalization`: an arrow tidied after a drag, its
/// placed segments merged where two in a row run the same way and dropped
/// where they are too short, and routed afresh when none of them is left
/// but the first and last.
private func renormalized(_ arrow: StoredElbowArrow, _ shape: (JSONValue?) -> DrawingElement?) -> RawElement? {
  guard let placed = arrow.fixedSegments?.arrayValue else {
    var update: RawElement = ["x": .number(arrow.x), "y": .number(arrow.y), "points": .points(arrow.points)]
    update["fixedSegments"] = arrow.fixedSegments
    update["startIsSpecial"] = arrow.startIsSpecial
    update["endIsSpecial"] = arrow.endIsSpecial
    return update
  }
  var segments = placed.compactMap(FixedSegment.init)
  let points = arrow.points.map(arrow.global)
  var merged: [Point2D] = []
  for (i, p) in points.enumerated() {
    if i >= 2, Heading(p, from: points[i - 1]) == Heading(points[i - 1], from: points[i - 2]) {
      let previous = segments.firstIndex { $0.index == i - 1 }
      if let current = segments.firstIndex(where: { $0.index == i }) {
        segments[current].start = Point2D(points[i - 2].x - arrow.x, points[i - 2].y - arrow.y)
      }
      if let previous { segments.remove(at: previous) }
      merged.removeLast()
      for k in segments.indices where segments[k].index > i - 1 { segments[k].index -= 1 }
    }
    merged.append(p)
  }
  var nextPoints: [Point2D] = []
  for (i, p) in merged.enumerated() {
    guard i >= 3, merged[i - 2].distance(to: merged[i - 1]) < dedupThreshold else {
      nextPoints.append(p)
      continue
    }
    let beforePrevious = segments.firstIndex { $0.index == i - 2 }
    if let previous = segments.firstIndex(where: { $0.index == i - 1 }) { segments.remove(at: previous) }
    if let beforePrevious, beforePrevious < segments.count { segments.remove(at: beforePrevious) }
    nextPoints.removeLast(min(2, nextPoints.count))
    for k in segments.indices where segments[k].index > i - 2 { segments[k].index -= 2 }
    let isHorizontal = Heading(p, from: merged[i - 1]).isHorizontal
    nextPoints.append(Point2D(isHorizontal ? p.x : merged[i - 2].x, isHorizontal ? merged[i - 2].y : p.y))
  }
  let kept = segments.filter { $0.index != 1 && $0.index != nextPoints.count - 1 }
  guard kept.isEmpty else {
    return normalizedUpdate(nextPoints, kept.map(\.json), arrow.startIsSpecial, arrow.endIsSpecial)
  }
  let data = elbowArrowData(
    arrow, startBinding: arrow.startBinding, endBinding: arrow.endBinding,
    nextPoints.map { Point2D($0.x - arrow.x, $0.y - arrow.y) }, shape(arrow.startBinding), shape(arrow.endBinding))
  return routedAndNormalized(arrow, data)
}

/// `handleEndpointDrag`: the ends moved with the placed segments kept
/// where they are, the segments next to each end straightened to meet it.
private func endpointDragged(
  _ arrow: StoredElbowArrow, _ updatedPoints: [Point2D], _ fixedSegments: [FixedSegment], _ data: ElbowArrowData
) -> RawElement? {
  var startIsSpecial = arrow.startIsSpecial ?? .null
  var endIsSpecial = arrow.endIsSpecial ?? .null
  let wasStartSpecial = startIsSpecial == .bool(true)
  let wasEndSpecial = endIsSpecial == .bool(true)
  let last = updatedPoints.count - 1
  let global = updatedPoints.indices.map { i in
    i == 0 || i == last || i >= arrow.points.count ? arrow.global(updatedPoints[i]) : arrow.global(arrow.points[i])
  }
  guard global.count >= 4 else { return nil }
  var indices = fixedSegments.map(\.index)
  let (startGlobal, endGlobal) = (data.startGlobalPoint, data.endGlobalPoint)
  var newPoints: [Point2D] = []
  let offset = 2 + (wasStartSpecial ? 1 : 0)
  let endOffset = 2 + (wasEndSpecial ? 1 : 0)
  while newPoints.count + offset < global.count - endOffset { newPoints.append(global[newPoints.count + offset]) }

  let second = global[wasStartSpecial ? 2 : 1]
  let third = global[wasStartSpecial ? 3 : 2]
  let startIsHorizontal = data.startHeading.isHorizontal
  let secondIsHorizontal = Heading(second, from: third).isHorizontal
  if data.hoveredStartElement != nil && startIsHorizontal == secondIsHorizontal {
    let padding = data.startHeading.isPositive ? basePadding : -basePadding
    newPoints.insert(
      Point2D(
        secondIsHorizontal ? startGlobal.x + padding : third.x, secondIsHorizontal ? third.y : startGlobal.y + padding),
      at: 0)
    newPoints.insert(
      Point2D(
        startIsHorizontal ? startGlobal.x + padding : startGlobal.x,
        startIsHorizontal ? startGlobal.y : startGlobal.y + padding),
      at: 0)
    if startIsSpecial != .bool(true) {
      startIsSpecial = .bool(true)
      for k in indices.indices where indices[k] > 1 { indices[k] += 1 }
    }
  } else {
    newPoints.insert(
      Point2D(secondIsHorizontal ? startGlobal.x : second.x, secondIsHorizontal ? second.y : startGlobal.y), at: 0)
    if startIsSpecial == .bool(true) {
      startIsSpecial = .bool(false)
      for k in indices.indices where indices[k] > 1 { indices[k] -= 1 }
    }
  }
  newPoints.insert(startGlobal, at: 0)

  let secondToLast = global[global.count - (wasEndSpecial ? 3 : 2)]
  let thirdToLast = global[global.count - (wasEndSpecial ? 4 : 3)]
  let endIsHorizontal = data.endHeading.isHorizontal
  let beforeIsHorizontal = Heading(thirdToLast, from: secondToLast).isHorizontal
  if data.hoveredEndElement != nil && endIsHorizontal == beforeIsHorizontal {
    let padding = data.endHeading.isPositive ? basePadding : -basePadding
    newPoints.append(
      Point2D(
        beforeIsHorizontal ? endGlobal.x + padding : thirdToLast.x,
        beforeIsHorizontal ? thirdToLast.y : endGlobal.y + padding))
    newPoints.append(
      Point2D(
        endIsHorizontal ? endGlobal.x + padding : endGlobal.x, endIsHorizontal ? endGlobal.y : endGlobal.y + padding))
    if endIsSpecial != .bool(true) { endIsSpecial = .bool(true) }
  } else {
    newPoints.append(
      Point2D(
        beforeIsHorizontal ? endGlobal.x : secondToLast.x, beforeIsHorizontal ? secondToLast.y : endGlobal.y))
    if endIsSpecial == .bool(true) { endIsSpecial = .bool(false) }
  }
  newPoints.append(endGlobal)

  guard indices.allSatisfy({ $0 >= 1 && $0 < newPoints.count }) else { return nil }
  let segments = indices.map { index in
    FixedSegment(
      index: index,
      start: Point2D(newPoints[index - 1].x - startGlobal.x, newPoints[index - 1].y - startGlobal.y),
      end: Point2D(newPoints[index].x - startGlobal.x, newPoints[index].y - startGlobal.y)
    ).json
  }
  return normalizedUpdate(newPoints, segments, startIsSpecial, endIsSpecial)
}

/// `updateElbowArrowPoints`, for the updates this app makes: new ends,
/// new bindings, or nothing, to tidy the arrow. Nil where the web stops on
/// an error, which leaves the arrow as it was.
private func elbowArrowUpdate(
  _ stored: StoredElbowArrow, _ updates: RawElement, ownBindings: Bool,
  _ shape: (JSONValue?) -> DrawingElement?
) -> RawElement? {
  var arrow = stored
  let givenPoints = updates["points"].map { (["points": $0] as RawElement).points.map { clamp($0) } }
  guard arrow.points.count >= 2 else { return ["points": updates["points"] ?? .points(arrow.points)] }
  arrow.x = clamp(arrow.x, -maxPosition, maxPosition)
  arrow.y = clamp(arrow.y, -maxPosition, maxPosition)
  let updatedPoints: [Point2D]
  if let givenPoints, givenPoints.count == 2 {
    updatedPoints = arrow.points.indices.map { index in
      index == 0 ? givenPoints[0] : index == arrow.points.count - 1 ? givenPoints[1] : arrow.points[index]
    }
  } else {
    updatedPoints = givenPoints ?? arrow.points
  }
  let startBinding = updates.keys.contains("startBinding") ? updates["startBinding"] : arrow.startBinding
  let endBinding = updates.keys.contains("endBinding") ? updates["endBinding"] : arrow.endBinding
  let startElement = shape(startBinding)
  let endElement = shape(endBinding)
  if startElement?.id != startBinding?["elementId"]?.stringValue
    || endElement?.id != endBinding?["elementId"]?.stringValue
  {
    return normalizedUpdate(
      updatedPoints.map(arrow.global), arrow.fixedSegments?.arrayValue, arrow.startIsSpecial, arrow.endIsSpecial)
  }
  let data = elbowArrowData(
    arrow, startBinding: startBinding, endBinding: endBinding, updatedPoints, startElement, endElement)
  let fixedSegments = arrow.fixedSegments?.arrayValue?.compactMap(FixedSegment.init) ?? []
  func given(_ key: String) -> Bool { updates[key].map { $0 != .null } ?? false }
  if givenPoints == nil && !given("startBinding") && !given("endBinding") { return renormalized(arrow, shape) }
  // The web tells an unchanged binding by reference: null is null, and an
  // object is the arrow's own only when passed on as it was.
  func unchanged(_ key: String, _ own: JSONValue?) -> Bool {
    guard let value = updates[key] else { return own == nil }
    return value == .null ? own == .null : ownBindings && value == own
  }
  if unchanged("startBinding", arrow.startBinding) && unchanged("endBinding", arrow.endBinding)
    && (givenPoints ?? []).enumerated().allSatisfy({ i, p in i < arrow.points.count && pointsEqual(p, arrow.points[i]) })
  {
    return [:]
  }
  if fixedSegments.isEmpty { return routedAndNormalized(arrow, data) }
  // `handleSegmentMove`, given the arrow's own segments, moves none.
  guard givenPoints != nil else { return ["points": .points(arrow.points)] }
  return endpointDragged(arrow, updatedPoints, fixedSegments, data)
}

extension DrawingEditor {
  /// `mutateElement` on an elbow arrow, which routes it again when its
  /// ends or bindings are given, and tidies it when given nothing.
  /// `ownBindings` says bindings in `updates` are the arrow's own, passed
  /// on unchanged.
  @discardableResult
  func mutateElbowArrow(_ id: String, _ updates: RawElement, ownBindings: Bool) -> Bool {
    guard let raw = element(id),
      let routed = elbowArrowUpdate(StoredElbowArrow(raw), updates, ownBindings: ownBindings, bindableElement)
    else { return false }
    var merged = updates
    merged["angle"] = .number(0)
    merged.merge(routed) { $1 }
    // The web sizes an elbow arrow only by what routing gives it.
    for key in ["width", "height"] where merged[key] == nil { merged[key] = raw[key] }
    return mutate(id, merged)
  }

  /// `getBindableElementForId`, among the elements not deleted.
  private func bindableElement(_ binding: JSONValue?) -> DrawingElement? {
    guard let id = binding?["elementId"]?.stringValue, let element = restored(id), !element.isDeleted,
      element.isBindable
    else { return nil }
    return element
  }
}
