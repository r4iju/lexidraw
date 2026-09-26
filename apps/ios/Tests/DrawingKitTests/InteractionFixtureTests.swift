import Foundation
import Testing

@testable import DrawingKit

let interactionFixtures = Bundle.module.url(forResource: "Fixtures", withExtension: nil)!
  .appending(path: "Interactions")

let fixtureInteractions = try! FileManager.default.contentsOfDirectory(
  atPath: interactionFixtures.path
).filter { !$0.hasPrefix(".") }.sorted()

/// Every script in `reference/drawings/interactions.ts`, played in the iOS
/// editor, leaves the elements web Excalidraw left.
@Suite struct InteractionFixtureTests {
  @Test(arguments: fixtureInteractions)
  func editsAsTheWebEditorEdits(_ name: String) throws {
    let directory = interactionFixtures.appending(path: name)
    let script = try JSONDecoder().decode(
      JSONValue.self, from: Data(contentsOf: directory.appending(path: "script.json")))
    let expected = try JSONDecoder().decode(
      [JSONValue].self, from: Data(contentsOf: directory.appending(path: "after.json")))

    let editor = DrawingEditor(
      elements: script["before"]?.arrayValue ?? [], measurer: FontLibrary.shared,
      environment: .counting)
    var pressed = 0.5
    for step in script["steps"]?.arrayValue ?? [] { play(step, in: editor, pressed: &pressed) }

    #expect(elementDifference(expected, editor.elements) == nil)
  }

  /// A step as the recorder plays it in the browser, where a move or a lift
  /// reports the pressure of the press unless it names its own, and a lift
  /// reports none.
  private func play(_ step: JSONValue, in editor: DrawingEditor, pressed: inout Double) {
    func point(_ value: JSONValue?) -> Point2D {
      let pair = value?.arrayValue?.compactMap(\.numberValue) ?? []
      return Point2D(pair.first ?? 0, pair.last ?? 0)
    }
    if let tool = step["tool"]?.stringValue {
      editor.tool = DrawingTool(rawValue: tool)!
    } else if step["down"] != nil {
      let pressure = step["pressure"]?.numberValue ?? 0.5
      pressed = pressure
      editor.pointerDown(
        point(step["down"]), pointer: PointerKind(rawValue: step["pointer"]?.stringValue ?? "touch")!,
        pressure: pressure)
    } else if step["move"] != nil {
      editor.pointerMove(point(step["move"]), pressure: step["pressure"]?.numberValue ?? pressed)
    } else if step["up"] != nil {
      editor.pointerUp(point(step["up"]), pressure: 0)
    } else if step["doubleTap"] != nil {
      editor.doubleTap(point(step["doubleTap"]))
    } else if let text = step["type"]?.stringValue {
      for character in text { editor.editText((editor.editingText ?? "") + String(character)) }
    } else {
      switch step["press"]?.stringValue {
      case "Escape": editor.escape()
      case "Delete": editor.deleteSelection()
      case "undo": editor.undo()
      case "redo": editor.redo()
      default: Issue.record("Unknown step \(describe(step))")
      }
    }
  }
}

/// Where two element lists differ, ignoring what is random on the web: ids,
/// compared by the order they first appear in, and the seed, version nonce
/// and timestamp.
func elementDifference(_ expected: [JSONValue], _ actual: [JSONValue]) -> String? {
  let e = normalized(expected)
  let a = normalized(actual)
  for index in 0..<max(e.count, a.count) {
    guard index < e.count else { return "[\(index)]: unexpected \(describe(a[index]))" }
    guard index < a.count else { return "[\(index)]: missing \(describe(e[index]))" }
    if let difference = valueDifference(e[index], a[index], path: "[\(index)]") {
      return difference
    }
  }
  return nil
}

private func normalized(_ elements: [JSONValue]) -> [JSONValue] {
  var ids: [String: String] = [:]
  for element in elements {
    if let id = element["id"]?.stringValue, ids[id] == nil { ids[id] = "#\(ids.count)" }
  }
  func rename(_ value: JSONValue) -> JSONValue {
    switch value {
    case .string(let string): .string(ids[string] ?? string)
    case .array(let array): .array(array.map(rename))
    case .object(let object): .object(object.mapValues(rename))
    default: value
    }
  }
  return elements.map { element in
    var object = element.objectValue ?? [:]
    for key in ["seed", "versionNonce", "updated"] { object[key] = nil }
    return rename(.object(object))
  }
}

/// Numbers match to within float precision, as pressures reach the web as
/// 32-bit floats.
private func valueDifference(_ expected: JSONValue, _ actual: JSONValue, path: String) -> String? {
  switch (expected, actual) {
  case (.number(let x), .number(let y)):
    return abs(x - y) <= 1e-6 * max(1, abs(x)) ? nil : "\(path): expected \(x), got \(y)"
  case (.array(let x), .array(let y)):
    guard x.count == y.count else {
      return "\(path): expected \(describe(expected))\n  got \(describe(actual))"
    }
    for (index, (a, b)) in zip(x, y).enumerated() {
      if let difference = valueDifference(a, b, path: "\(path)[\(index)]") { return difference }
    }
    return nil
  case (.object(let x), .object(let y)):
    for key in Set(x.keys).union(y.keys).sorted() {
      guard let a = x[key] else { return "\(path).\(key): unexpected \(describe(y[key]!))" }
      guard let b = y[key] else { return "\(path).\(key): missing \(describe(a))" }
      if let difference = valueDifference(a, b, path: "\(path).\(key)") { return difference }
    }
    return nil
  default:
    return expected == actual ? nil : "\(path): expected \(describe(expected)), got \(describe(actual))"
  }
}
