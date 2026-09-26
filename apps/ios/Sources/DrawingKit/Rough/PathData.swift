import Foundation

// path-data-parser 0.1.0 and points-on-path 0.2.1, which rough.js uses to read
// the SVG paths Excalidraw builds for rounded shapes and elbow arrows. Those
// paths only use M, L, C, Q and Z; arcs are not read.

struct PathSegment {
  var key: Character
  var data: [Double]
}

private let parameterCounts: [Character: Int] = [
  "C": 6, "c": 6, "H": 1, "h": 1, "L": 2, "l": 2, "M": 2, "m": 2, "Q": 4, "q": 4,
  "S": 4, "s": 4, "T": 2, "t": 2, "V": 1, "v": 1, "Z": 0, "z": 0,
]

private enum PathToken {
  case command(Character)
  case number(Double)
}

private func tokenize(_ d: String) -> [PathToken]? {
  var tokens: [PathToken] = []
  let characters = Array(d.utf8)
  var index = 0
  func isDigit(_ c: UInt8) -> Bool { c >= 48 && c <= 57 }
  while index < characters.count {
    let c = characters[index]
    if c == 32 || c == 9 || c == 13 || c == 10 || c == 44 {
      index += 1
    } else if let key = Optional(Character(UnicodeScalar(c))), parameterCounts[key] != nil {
      tokens.append(.command(key))
      index += 1
    } else {
      var end = index
      if characters[end] == 43 || characters[end] == 45 { end += 1 }
      let integerStart = end
      while end < characters.count, isDigit(characters[end]) { end += 1 }
      var hasDigits = end > integerStart
      if end < characters.count, characters[end] == 46 {
        let fractionStart = end + 1
        var fractionEnd = fractionStart
        while fractionEnd < characters.count, isDigit(characters[fractionEnd]) { fractionEnd += 1 }
        if hasDigits || fractionEnd > fractionStart {
          hasDigits = true
          end = fractionEnd
        }
      }
      guard hasDigits else { return nil }
      if end < characters.count, characters[end] == 101 || characters[end] == 69 {
        var exponent = end + 1
        if exponent < characters.count, characters[exponent] == 43 || characters[exponent] == 45 {
          exponent += 1
        }
        let digitsStart = exponent
        while exponent < characters.count, isDigit(characters[exponent]) { exponent += 1 }
        if exponent > digitsStart { end = exponent }
      }
      let text = String(decoding: characters[index..<end], as: UTF8.self)
      guard let value = Double(text) else { return nil }
      tokens.append(.number(value))
      index = end
    }
  }
  return tokens
}

func parsePath(_ d: String) -> [PathSegment] {
  guard let tokens = tokenize(d), let first = tokens.first else { return [] }
  if case .command(let key) = first, key == "M" || key == "m" {
  } else {
    return parsePath("M0,0" + d)
  }
  var segments: [PathSegment] = []
  var mode: Character = "M"
  var index = 0
  while index < tokens.count {
    if case .command(let key) = tokens[index] {
      mode = key
      index += 1
    }
    guard let count = parameterCounts[mode], index + count <= tokens.count else { break }
    var data: [Double] = []
    for token in tokens[index..<(index + count)] {
      guard case .number(let value) = token else { return segments }
      data.append(value)
    }
    segments.append(PathSegment(key: mode, data: data))
    index += count
    if mode == "M" { mode = "L" }
    if mode == "m" { mode = "l" }
    if count == 0, index < tokens.count, case .number = tokens[index] { break }
  }
  return segments
}

func absolutizePath(_ segments: [PathSegment]) -> [PathSegment] {
  var cx = 0.0
  var cy = 0.0
  var subx = 0.0
  var suby = 0.0
  var out: [PathSegment] = []
  func relative(_ data: [Double]) -> [Double] {
    data.enumerated().map { $0.offset % 2 == 1 ? $0.element + cy : $0.element + cx }
  }
  for segment in segments {
    let data = segment.data
    switch segment.key {
    case "M":
      out.append(segment)
      (cx, cy) = (data[0], data[1])
      (subx, suby) = (data[0], data[1])
    case "m":
      cx += data[0]
      cy += data[1]
      out.append(PathSegment(key: "M", data: [cx, cy]))
      (subx, suby) = (cx, cy)
    case "L":
      out.append(segment)
      (cx, cy) = (data[0], data[1])
    case "l":
      cx += data[0]
      cy += data[1]
      out.append(PathSegment(key: "L", data: [cx, cy]))
    case "C":
      out.append(segment)
      (cx, cy) = (data[4], data[5])
    case "c":
      let absolute = relative(data)
      out.append(PathSegment(key: "C", data: absolute))
      (cx, cy) = (absolute[4], absolute[5])
    case "Q", "S":
      out.append(segment)
      (cx, cy) = (data[2], data[3])
    case "q", "s":
      let absolute = relative(data)
      out.append(PathSegment(key: segment.key == "q" ? "Q" : "S", data: absolute))
      (cx, cy) = (absolute[2], absolute[3])
    case "H":
      out.append(segment)
      cx = data[0]
    case "h":
      cx += data[0]
      out.append(PathSegment(key: "H", data: [cx]))
    case "V":
      out.append(segment)
      cy = data[0]
    case "v":
      cy += data[0]
      out.append(PathSegment(key: "V", data: [cy]))
    case "T":
      out.append(segment)
      (cx, cy) = (data[0], data[1])
    case "t":
      cx += data[0]
      cy += data[1]
      out.append(PathSegment(key: "T", data: [cx, cy]))
    case "Z", "z":
      out.append(PathSegment(key: "Z", data: []))
      (cx, cy) = (subx, suby)
    default: break
    }
  }
  return out
}

/// Reduces a path to M, L, C and Z.
func normalizePath(_ segments: [PathSegment]) -> [PathSegment] {
  var out: [PathSegment] = []
  var lastType: Character = " "
  var cx = 0.0
  var cy = 0.0
  var subx = 0.0
  var suby = 0.0
  var lcx = 0.0
  var lcy = 0.0
  for segment in segments {
    let data = segment.data
    switch segment.key {
    case "M":
      out.append(segment)
      (cx, cy) = (data[0], data[1])
      (subx, suby) = (data[0], data[1])
    case "C":
      out.append(segment)
      (cx, cy) = (data[4], data[5])
      (lcx, lcy) = (data[2], data[3])
    case "L":
      out.append(segment)
      (cx, cy) = (data[0], data[1])
    case "H":
      cx = data[0]
      out.append(PathSegment(key: "L", data: [cx, cy]))
    case "V":
      cy = data[0]
      out.append(PathSegment(key: "L", data: [cx, cy]))
    case "S":
      let smooth = lastType == "C" || lastType == "S"
      let cx1 = smooth ? cx + (cx - lcx) : cx
      let cy1 = smooth ? cy + (cy - lcy) : cy
      out.append(PathSegment(key: "C", data: [cx1, cy1] + data))
      (lcx, lcy) = (data[0], data[1])
      (cx, cy) = (data[2], data[3])
    case "T", "Q":
      let x: Double
      let y: Double
      let x1: Double
      let y1: Double
      if segment.key == "Q" {
        (x1, y1, x, y) = (data[0], data[1], data[2], data[3])
      } else {
        (x, y) = (data[0], data[1])
        let smooth = lastType == "Q" || lastType == "T"
        x1 = smooth ? cx + (cx - lcx) : cx
        y1 = smooth ? cy + (cy - lcy) : cy
      }
      let cx1 = cx + 2 * (x1 - cx) / 3
      let cy1 = cy + 2 * (y1 - cy) / 3
      let cx2 = x + 2 * (x1 - x) / 3
      let cy2 = y + 2 * (y1 - y) / 3
      out.append(PathSegment(key: "C", data: [cx1, cy1, cx2, cy2, x, y]))
      (lcx, lcy) = (x1, y1)
      (cx, cy) = (x, y)
    case "Z":
      out.append(segment)
      (cx, cy) = (subx, suby)
    default: break
    }
    lastType = segment.key
  }
  return out
}

func pointsOnPath(_ path: String, tolerance: Double, distance: Double) -> [[Point2D]] {
  let segments = normalizePath(absolutizePath(parsePath(path)))
  var sets: [[Point2D]] = []
  var currentPoints: [Point2D] = []
  var start = Point2D(0, 0)
  var pendingCurve: [Point2D] = []
  func appendPendingCurve() {
    if pendingCurve.count >= 4 {
      currentPoints += pointsOnBezierCurves(pendingCurve, tolerance: tolerance, distance: 0)
    }
    pendingCurve = []
  }
  func appendPendingPoints() {
    appendPendingCurve()
    if !currentPoints.isEmpty {
      sets.append(currentPoints)
      currentPoints = []
    }
  }
  for segment in segments {
    let data = segment.data
    switch segment.key {
    case "M":
      appendPendingPoints()
      start = Point2D(data[0], data[1])
      currentPoints.append(start)
    case "L":
      appendPendingCurve()
      currentPoints.append(Point2D(data[0], data[1]))
    case "C":
      if pendingCurve.isEmpty {
        pendingCurve.append(currentPoints.last ?? start)
      }
      pendingCurve.append(Point2D(data[0], data[1]))
      pendingCurve.append(Point2D(data[2], data[3]))
      pendingCurve.append(Point2D(data[4], data[5]))
    case "Z":
      appendPendingCurve()
      currentPoints.append(start)
    default: break
    }
  }
  appendPendingPoints()
  guard distance != 0 else { return sets }
  return sets.map { simplifyPoints($0, distance) }.filter { !$0.isEmpty }
}
