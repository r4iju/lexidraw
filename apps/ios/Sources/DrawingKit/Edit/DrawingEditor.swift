import Foundation

public enum DrawingTool: String, CaseIterable, Sendable {
  case selection, rectangle, diamond, ellipse, line, freedraw, text
}

public enum PointerKind: String, Sendable {
  case mouse, pen, touch
}

/// Where the editor gets what the web gets at random or from the clock.
public struct EditorEnvironment: Sendable {
  public var newId: @Sendable () -> String
  public var randomInteger: @Sendable () -> Int
  public var now: @Sendable () -> Double

  public init(
    newId: @escaping @Sendable () -> String, randomInteger: @escaping @Sendable () -> Int,
    now: @escaping @Sendable () -> Double
  ) {
    self.newId = newId
    self.randomInteger = randomInteger
    self.now = now
  }

  /// nanoid's alphabet and length for ids, `randomInteger`'s range for seeds
  /// and nonces, and the clock in milliseconds, as the web has them.
  public static let live = EditorEnvironment(
    newId: {
      let alphabet = Array("useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict")
      return String((0..<21).map { _ in alphabet[Int.random(in: 0..<64)] })
    },
    randomInteger: { Int.random(in: 0..<(1 << 31)) },
    now: { (Date().timeIntervalSince1970 * 1000).rounded(.down) })
}

/// What new elements are drawn with: the web's `currentItem…` settings.
public struct ElementStyle: Equatable, Sendable {
  public var strokeColor = "#1e1e1e"
  public var backgroundColor = "transparent"
  public var fillStyle = "solid"
  public var strokeWidth = 2.0
  public var strokeStyle = "solid"
  public var roughness = 1.0
  public var opacity = 100.0
  public var roundness = true
  public var fontSize = 20.0
  public var fontFamily = 5.0
  public var textAlign = "left"

  public init() {}
}

/// Excalidraw's editor, gesture by gesture: the same presses, drags and
/// keys change the same elements the same way, so a drawing edited here
/// saves as the web would have saved it.
public final class DrawingEditor {
  /// Every element, deleted ones too, in drawing order.
  public var elements: [JSONValue] { store.map(JSONValue.object) }
  public internal(set) var selectedIds: Set<String> = []
  public var tool: DrawingTool = .selection {
    didSet {
      if tool != .selection { selectedIds = [] }
    }
  }
  public var style = ElementStyle()
  /// How far the view is zoomed in, which sets how near a finger must come.
  public var zoom = 1.0
  /// The text being written, while it is.
  public var editingText: String? { editing.flatMap { element($0.id)?["originalText"]?.stringValue } }
  public var editingTextId: String? { editing?.id }

  var store: [RawElement]
  let measurer: TextMeasuring
  let characterWidths: CharacterWidths
  let environment: EditorEnvironment
  var gesture: Gesture?
  var editing: (id: String, isNew: Bool)?
  /// `originalContainerCache`: a container's height before a label grew it,
  /// which it shrinks back to as the label is cut.
  var originalContainerHeights: [String: Double] = [:]
  var history: History

  public init(elements: [JSONValue], measurer: TextMeasuring, environment: EditorEnvironment = .live) {
    store = elements.compactMap(\.objectValue)
    self.measurer = measurer
    characterWidths = CharacterWidths(measurer)
    self.environment = environment
    history = History()
    syncInvalidIndices()
    history.reset(to: store, selection: selectedIds)
  }

  func position(of id: String) -> Int? { store.firstIndex { $0.id == id } }

  func element(_ id: String) -> RawElement? { position(of: id).map { store[$0] } }

  @discardableResult
  func mutate(_ id: String, _ updates: RawElement) -> Bool {
    guard let position = position(of: id) else { return false }
    return environment.mutate(&store[position], updates)
  }

  var selectedElements: [RawElement] {
    store.filter { !$0.isDeleted && selectedIds.contains($0.id) }
  }

  // MARK: Order

  private func syncInvalidIndices() {
    let indices = store.map(\.index)
    let updates = FractionalIndex.generate(indices, groups: FractionalIndex.invalidGroups(indices))
    for (position, key) in updates { environment.mutate(&store[position], ["index": .string(key)]) }
  }

  /// `Scene.insertElement`: at the end, or below the frame it is in, or at
  /// `position`, keyed between its neighbours.
  func insert(_ element: RawElement, at position: Int? = nil) {
    var position = position ?? store.count
    if let frameId = element["frameId"]?.stringValue, let frame = self.position(of: frameId) {
      position = frame
    }
    store.insert(element, at: position)
    var indices = store.map(\.index)
    indices[position] = nil
    let groups = FractionalIndex.movedGroups(indices) { $0 == position }
    var candidate = indices
    let updates = FractionalIndex.generate(indices, groups: groups)
    for (position, key) in updates { candidate[position] = key }
    if FractionalIndex.areValid(candidate) {
      for (position, key) in updates { environment.mutate(&store[position], ["index": .string(key)]) }
    } else {
      syncInvalidIndices()
    }
  }

  // MARK: New elements

  /// `_newElementBase`, with the current style.
  func newElement(_ type: String, at point: Point2D, roundness: JSONValue) -> RawElement {
    [
      "id": .string(environment.newId()), "type": .string(type), "x": .number(point.x),
      "y": .number(point.y), "width": 0, "height": 0, "angle": 0,
      "strokeColor": .string(style.strokeColor), "backgroundColor": .string(style.backgroundColor),
      "fillStyle": .string(style.fillStyle), "strokeWidth": .number(style.strokeWidth),
      "strokeStyle": .string(style.strokeStyle), "roughness": .number(style.roughness),
      "opacity": .number(style.opacity), "groupIds": [], "frameId": nil, "index": nil,
      "roundness": roundness, "seed": .number(Double(environment.randomInteger())), "version": 1,
      "versionNonce": 0, "isDeleted": false, "boundElements": nil,
      "updated": .number(environment.now()), "link": nil, "locked": false,
    ]
  }

  /// `getCurrentItemRoundness`.
  private func roundness(for type: String) -> JSONValue {
    guard style.roundness else { return nil }
    return ["type": .number(type == "rectangle" ? 3 : 2)]
  }

  /// `measureText`: the widest line, and a line height per line, where an
  /// empty line measures as a space.
  func measure(_ text: String, fontSize: Double, fontFamily: Double, lineHeight: Double)
    -> (width: Double, height: Double)
  {
    let font = FontMetrics.fontString(size: fontSize, family: fontFamily)
    let lines = splitIntoLines(text)
    let width = lines.map { measurer.width(of: $0.isEmpty ? " " : $0, font: font) }.max() ?? 0
    return (width, fontSize * lineHeight * Double(lines.count))
  }

  // MARK: Pointer

  public func pointerDown(_ point: Point2D, pointer: PointerKind, pressure: Double) {
    if editing != nil { finishEditingText(viaKeyboard: false) }
    if pointer == .touch, let gesture, case .freedraw = gesture.action { return }
    var gesture = Gesture(
      origin: point, pointer: pointer, last: point,
      before: .init(store: store, selectedIds: selectedIds, tool: tool, heights: originalContainerHeights),
      originals: Dictionary(
        store.filter { !$0.isDeleted }.map { ($0.id, $0) }, uniquingKeysWith: { $1 }),
      hitCommonBox: hitsCommonBounds(point))
    if tool != .selection { selectedIds = [] }
    switch tool {
    case .selection:
      pressWithSelection(&gesture)
    case .text:
      pressWithText(&gesture)
      tool = .selection
    case .line:
      var element = newElement("line", at: point, roundness: roundness(for: "line"))
      element.merge(
        [
          "points": [], "lastCommittedPoint": nil, "startBinding": nil, "endBinding": nil,
          "startArrowhead": nil, "endArrowhead": nil,
        ], uniquingKeysWith: { $1 })
      environment.mutate(&element, ["points": .points([Point2D(0, 0)])])
      insert(element)
      gesture.action = .line(element.id)
    case .freedraw:
      let simulatePressure = pressure == 0.5
      var element = newElement("freedraw", at: point, roundness: nil)
      element.merge(
        [
          "points": .points([Point2D(0, 0)]),
          "pressures": simulatePressure ? [] : [.number(pressure)],
          "simulatePressure": .bool(simulatePressure), "lastCommittedPoint": nil,
        ], uniquingKeysWith: { $1 })
      insert(element)
      gesture.action = .freedraw(element.id)
    case .rectangle, .diamond, .ellipse:
      let element = newElement(tool.rawValue, at: point, roundness: roundness(for: tool.rawValue))
      insert(element)
      gesture.action = .create(element.id)
    }
    self.gesture = gesture
  }

  public func pointerMove(_ point: Point2D, pressure: Double) {
    guard var gesture else { return }
    defer { self.gesture = gesture }
    if case .line = gesture.action, !gesture.dragged, point.distance(to: gesture.origin) < 10 {
      return
    }
    switch gesture.action {
    case .resize(let handle, let offset):
      gesture.last = point
      resize(gesture, handle: handle, to: Point2D(point.x - offset.x, point.y - offset.y))
      return
    case .rotate:
      gesture.last = point
      rotate(to: point)
      return
    default:
      break
    }
    if case .none = gesture.action, gesture.hitsSelected(selectedIds) || gesture.hitCommonBox {
      gesture.dragged = true
      drag(gesture, by: Point2D(point.x - gesture.origin.x, point.y - gesture.origin.y))
      return
    }
    switch gesture.action {
    case .freedraw(let id):
      guard let element = element(id) else { return }
      let dx = point.x - element.number("x")
      let dy = point.y - element.number("y")
      var points = element.points
      guard points.last != Point2D(dx, dy) else { return }
      points.append(Point2D(dx, dy))
      var pressures = element["pressures"]?.arrayValue ?? []
      if element["simulatePressure"]?.boolValue != true { pressures.append(.number(pressure)) }
      mutate(id, ["points": .points(points), "pressures": .array(pressures)])
    case .line(let id):
      gesture.dragged = true
      guard let element = element(id) else { return }
      let d = Point2D(point.x - element.number("x"), point.y - element.number("y"))
      let points = element.points
      if points.count == 1 {
        mutate(id, ["points": .points(points + [d])])
      } else if points.count == 2 {
        mutate(id, ["points": .points(points.dropLast() + [d])])
      }
    case .create(let id):
      gesture.last = point
      dragNew(id, from: gesture.origin, to: point)
    case .box:
      gesture.last = point
      selectWithin(from: gesture.origin, to: point, gesture: gesture)
    default:
      break
    }
  }

  public func pointerUp(_ point: Point2D, pressure: Double) {
    guard let gesture else { return }
    self.gesture = nil
    switch gesture.action {
    case .freedraw(let id):
      guard let element = element(id) else { break }
      var points = element.points
      var d = Point2D(point.x - element.number("x"), point.y - element.number("y"))
      if d == points[0] {
        d.x += 1e-4
        d.y += 1e-4
      }
      points.append(d)
      let pressures: JSONValue =
        element["simulatePressure"]?.boolValue == true
        ? [] : .array((element["pressures"]?.arrayValue ?? []) + [.number(pressure)])
      mutate(id, ["points": .points(points), "pressures": pressures, "lastCommittedPoint": .point(d)])
      if isPathALoop(points) {
        mutate(id, ["points": .points(points.dropLast() + [points[0]])])
      }
      capture()
      return
    case .line(let id):
      if gesture.dragged {
        tool = .selection
        selectedIds = [id]
      } else if let position = position(of: id) {
        store.remove(at: position)
      }
      capture()
      return
    case .text(let id):
      beginEditing(id, existing: true)
      return
    case .create(let id):
      if let element = element(id), element.number("width") == 0 && element.number("height") == 0 {
        store.removeAll { $0.id == id }
        tool = .selection
        return
      }
      if let element = element(id) {
        var updates: RawElement = [:]
        if element.number("width") < 0 {
          updates["width"] = .number(-element.number("width"))
          updates["x"] = .number(element.number("x") + element.number("width"))
        }
        if element.number("height") < 0 {
          updates["height"] = .number(-element.number("height"))
          updates["y"] = .number(element.number("y") + element.number("height"))
        }
        mutate(id, updates)
      }
    default:
      break
    }
    let resizing: Bool
    switch gesture.action {
    case .resize, .rotate: resizing = true
    default: resizing = false
    }
    if let hit = gesture.hit, !gesture.dragged, !gesture.wasAddedToSelection {
      selectedIds = withGroups([hit])
    }
    if let hit = gesture.hit, !gesture.dragged, !resizing, hitsBoundingBoxOnly(hit, gesture.origin) {
      selectedIds = []
    } else if gesture.hit == nil, !gesture.dragged, !resizing, gesture.hitCommonBox {
      selectedIds = []
    }
    if case .create(let id) = gesture.action {
      selectedIds.insert(id)
      tool = .selection
    }
    capture()
  }

  // MARK: Selection gestures

  private func pressWithSelection(_ gesture: inout Gesture) {
    let selected = selectedElements
    if selected.count == 1, let handle = transformHandle(at: gesture.origin, of: selected[0], pointer: gesture.pointer) {
      if handle == "rotation" {
        gesture.action = .rotate
      } else {
        gesture.action = .resize(handle, offset: resizeOffset(handle, selected[0], gesture.origin))
      }
      return
    }
    gesture.hit = elementAt(gesture.origin)
    gesture.allHits = elementsAt(gesture.origin)
    let someHitSelected = gesture.allHits.contains { selectedIds.contains($0) }
    if (gesture.hit == nil || !someHitSelected) && !gesture.hitCommonBox {
      selectedIds = []
    }
    if let hit = gesture.hit, !selectedIds.contains(hit), !someHitSelected, !gesture.hitCommonBox {
      selectedIds = withGroups(selectedIds.union([hit]))
      gesture.wasAddedToSelection = true
    }
    if gesture.hit == nil { gesture.action = .box }
  }

  /// `selectGroupsForSelectedElements`: a selected element selects the
  /// rest of its outermost group.
  func withGroups(_ ids: Set<String>) -> Set<String> {
    var groups: Set<String> = []
    for element in store where ids.contains(element.id) {
      if let last = element["groupIds"]?.arrayValue?.last?.stringValue { groups.insert(last) }
    }
    guard !groups.isEmpty else { return ids }
    var members: [String: [String]] = [:]
    for element in store where !element.isDeleted {
      let elementGroups = element["groupIds"]?.arrayValue?.compactMap(\.stringValue) ?? []
      if let group = elementGroups.first(where: groups.contains) {
        members[group, default: []].append(element.id)
      }
    }
    return ids.union(members.values.flatMap { $0 })
  }

  private func selectWithin(from origin: Point2D, to point: Point2D, gesture: Gesture) {
    let box = Bounds(
      minX: min(origin.x, point.x), minY: min(origin.y, point.y), maxX: max(origin.x, point.x),
      maxY: max(origin.y, point.y))
    let geometry = makeGeometry()
    let within = store.filter { raw in
      guard !raw.isDeleted, raw["locked"]?.boolValue != true,
        raw["containerId"]?.stringValue == nil || raw.type != "text",
        let element = geometry.elements[raw.id]
      else { return false }
      let b = geometry.bounds(element)
      return box.minX <= b.minX && box.minY <= b.minY && box.maxX >= b.maxX && box.maxY >= b.maxY
    }.map(\.id)
    var next = Set(within)
    if let hit = gesture.hit, within.isEmpty { next.insert(hit) }
    selectedIds = withGroups(next)
  }

  // MARK: Dragging

  /// `dragNewElement`.
  private func dragNew(_ id: String, from origin: Point2D, to point: Point2D) {
    let width = abs(origin.x - point.x)
    let height = abs(origin.y - point.y)
    guard width != 0, height != 0 else { return }
    mutate(
      id,
      [
        "x": .number(point.x < origin.x ? origin.x - width : origin.x),
        "y": .number(point.y < origin.y ? origin.y - height : origin.y),
        "width": .number(width), "height": .number(height),
      ])
  }

  /// `dragSelectedElements`: each selected element, and the text it holds,
  /// moved from where it was when the drag began.
  private func drag(_ gesture: Gesture, by offset: Point2D) {
    var moved: [String] = []
    for element in selectedElements {
      moved.append(element.id)
      if element.type != "arrow",
        let text = element["boundElements"]?.arrayValue?.first(where: { $0["type"] == "text" })?["id"]?
          .stringValue
      {
        moved.append(text)
      }
    }
    for id in moved {
      guard let original = gesture.originals[id] ?? element(id) else { continue }
      mutate(
        id,
        [
          "x": .number(original.number("x") + offset.x),
          "y": .number(original.number("y") + offset.y),
        ])
    }
  }

  // MARK: Keys

  /// Escape: puts the text being written down, or goes back to selecting.
  public func escape() {
    if editing != nil {
      finishEditingText(viaKeyboard: true)
    } else if tool != .freedraw {
      tool = .selection
    }
  }

  public func deleteSelection() {
    guard editing == nil, !selectedIds.isEmpty else { return }
    let selected = selectedIds
    for position in store.indices where !store[position].isDeleted {
      let element = store[position]
      let container = element["containerId"]?.stringValue
      if selected.contains(element.id) || (container.map(selected.contains) ?? false) {
        environment.update(&store[position], ["isDeleted": true])
      }
    }
    selectedIds = []
    tool = .selection
    capture()
  }

  // MARK: History

  public var canUndo: Bool { history.canUndo }
  public var canRedo: Bool { history.canRedo }

  func capture() {
    history.record(store, selection: selectedIds)
  }

  public func undo() {
    guard editing == nil, gesture == nil else { return }
    history.undo(&store, selection: &selectedIds, environment: environment)
  }

  public func redo() {
    guard editing == nil, gesture == nil else { return }
    history.redo(&store, selection: &selectedIds, environment: environment)
  }
}

struct Gesture {
  /// What the editor was before the gesture, for when it is called off.
  struct Before {
    var store: [RawElement]
    var selectedIds: Set<String>
    var tool: DrawingTool
    var heights: [String: Double]
  }

  enum Action {
    case none, box, rotate
    case create(String), freedraw(String), line(String), text(String)
    case resize(String, offset: Point2D)
  }

  var origin: Point2D
  var pointer: PointerKind
  var last: Point2D
  var before: Before
  /// The elements as they were when the gesture began.
  var originals: [String: RawElement]
  var hitCommonBox: Bool
  var action = Action.none
  var hit: String?
  var allHits: [String] = []
  var wasAddedToSelection = false
  var dragged = false

  func hitsSelected(_ selection: Set<String>) -> Bool { allHits.contains(where: selection.contains) }
}
