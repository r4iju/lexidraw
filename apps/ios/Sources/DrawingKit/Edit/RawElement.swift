import Foundation

/// An element as stored: every field kept, the ones this app doesn't know
/// included, so a save sends back what it read.
typealias RawElement = JSONObject

extension JSONObject {
  var id: String { self["id"]?.stringValue ?? "" }
  var type: ElementType? { self["type"]?.stringValue.flatMap(ElementType.init(rawValue:)) }
  var isDeleted: Bool { self["isDeleted"]?.boolValue ?? false }
  var index: String? { self["index"]?.stringValue }
  func number(_ key: String) -> Double { self[key]?.numberValue ?? 0 }

  /// As a spread merges: keys already there keep their place, new ones go
  /// last.
  mutating func merge(
    _ other: JSONObject, uniquingKeysWith combine: (JSONValue, JSONValue) -> JSONValue
  ) {
    for (key, value) in other { self[key] = self[key].map { combine($0, value) } ?? value }
  }

  var points: [Point2D] {
    (self["points"]?.arrayValue ?? []).map { entry in
      let pair = entry.arrayValue ?? []
      return Point2D(pair.first?.numberValue ?? 0, pair.dropFirst().first?.numberValue ?? 0)
    }
  }
}

extension JSONValue {
  static func point(_ p: Point2D) -> JSONValue { [.number(p.x), .number(p.y)] }
  static func points(_ points: [Point2D]) -> JSONValue { .array(points.map(point)) }
}

extension EditorEnvironment {
  /// What `mutateElement` and `newElementWith` stamp on a changed element.
  func bump(_ element: inout RawElement) {
    element["version"] = .number(element.number("version") + 1)
    element["versionNonce"] = .number(Double(randomInteger()))
    element["updated"] = .number(now())
  }

  /// `mutateElement`: applies `updates`, and bumps the version when any of
  /// them changes the element. A list or an object counts as a change
  /// whatever it holds, as the web compares them by reference, except
  /// points, compared point by point after the first, and the image scale.
  @discardableResult
  func mutate(_ element: inout RawElement, _ updates: RawElement) -> Bool {
    var updates = updates
    if let points = updates["points"]?.arrayValue {
      let xs = points.compactMap { $0.arrayValue?.first?.numberValue }
      let ys = points.compactMap { $0.arrayValue?.dropFirst().first?.numberValue }
      if updates["width"] == nil { updates["width"] = .number((xs.max() ?? 0) - (xs.min() ?? 0)) }
      if updates["height"] == nil { updates["height"] = .number((ys.max() ?? 0) - (ys.min() ?? 0)) }
    }
    var changed = false
    for (key, value) in updates {
      let old = element[key]
      switch value {
      case .array, .object:
        if key == "scale", old == value { continue }
        if key == "points", let old = old?.arrayValue, let new = value.arrayValue,
          old.count == new.count, old.indices.dropFirst().allSatisfy({ old[$0] == new[$0] })
        {
          continue
        }
      default:
        if old == value { continue }
      }
      element[key] = value
      changed = true
    }
    if changed { bump(&element) }
    return changed
  }

  /// `newElementWith`: as `mutate`, but with no exceptions for points and
  /// scale, and bumping the version anyway when `force` is set.
  @discardableResult
  func update(_ element: inout RawElement, _ updates: RawElement, force: Bool = false) -> Bool {
    let changed = updates.contains { key, value in
      switch value {
      case .array, .object: true
      default: element[key] != value
      }
    }
    guard changed || force else { return false }
    element.merge(updates) { $1 }
    bump(&element)
    return true
  }
}
