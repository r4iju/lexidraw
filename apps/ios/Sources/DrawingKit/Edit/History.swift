import Foundation

/// Excalidraw's `Store` and `History`: each capture records what changed
/// since the last one, and undo applies it backwards as a new version of
/// each element, so an undone edit syncs like any other.
struct History {
  /// What one step changes back: per element, the fields to set, and the
  /// selection to take and give up.
  struct Entry {
    var elements: [String: RawElement]
    var select: Set<String>
    var deselect: Set<String>

    var inverse: Entry { Entry(elements: elements, select: deselect, deselect: select) }
  }

  private var snapshot: [String: RawElement] = [:]
  private var selection: Set<String> = []
  private var undoStack: [Entry] = []
  private var redoStack: [Entry] = []

  var canUndo: Bool { !undoStack.isEmpty }
  var canRedo: Bool { !redoStack.isEmpty }

  /// The fields a change is not about: what every change stamps anew.
  private static let unrecorded: Set<String> = ["id", "updated", "version", "versionNonce", "seed"]

  mutating func reset(to store: [RawElement], selection: Set<String>) {
    snapshot = Dictionary(store.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
    self.selection = selection
    undoStack = []
    redoStack = []
  }

  /// `Store.captureIncrement`: the step back to the last capture goes on
  /// the undo stack; one that changes elements ends what could be redone.
  mutating func record(_ store: [RawElement], selection: Set<String>) {
    var back: [String: RawElement] = [:]
    for element in store {
      guard let previous = snapshot[element.id] else {
        if !element.isDeleted { back[element.id] = ["isDeleted": true] }
        continue
      }
      var fields: RawElement = [:]
      for key in Set(previous.keys).union(element.keys) where !Self.unrecorded.contains(key) {
        if previous[key] != element[key] { fields[key] = previous[key] ?? .null }
      }
      if !fields.isEmpty { back[element.id] = fields }
    }
    let entry = Entry(
      elements: back, select: self.selection.subtracting(selection),
      deselect: selection.subtracting(self.selection))
    if !back.isEmpty || !entry.select.isEmpty || !entry.deselect.isEmpty {
      undoStack.append(entry)
    }
    if !back.isEmpty { redoStack = [] }
    snapshot = Dictionary(store.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
    self.selection = selection
  }

  /// Takes `element` as it is now without a step to undo.
  mutating func adopt(_ element: RawElement) {
    snapshot[element.id] = element
  }

  mutating func undo(_ store: inout [RawElement], selection: inout Set<String>, environment: EditorEnvironment) {
    perform(&store, &selection, environment, from: \.undoStack, to: \.redoStack)
  }

  mutating func redo(_ store: inout [RawElement], selection: inout Set<String>, environment: EditorEnvironment) {
    perform(&store, &selection, environment, from: \.redoStack, to: \.undoStack)
  }

  /// `History.perform`: applies entries until one makes a difference to
  /// what's on screen, and keeps the way back to what each overwrote.
  private mutating func perform(
    _ store: inout [RawElement], _ selectedIds: inout Set<String>, _ environment: EditorEnvironment,
    from source: WritableKeyPath<History, [Entry]>, to target: WritableKeyPath<History, [Entry]>
  ) {
    while let entry = self[keyPath: source].popLast() {
      var visible = false
      var returning = entry.inverse
      for (id, fields) in entry.elements {
        guard let position = store.firstIndex(where: { $0.id == id }) else { continue }
        let element = store[position]
        returning.elements[id] = fields.reduce(into: [:]) { $0[$1.key] = element[$1.key] ?? .null }
        let deleted = element.isDeleted
        let deleting = fields["isDeleted"]?.boolValue
        if !visible {
          visible =
            deleted
            ? deleting == false
            : deleting == true || fields.contains { element[$0.key] != $0.value }
        }
        environment.update(&store[position], fields)
      }
      let shown = Set(store.filter { !$0.isDeleted }.map(\.id))
      let next = selectedIds.subtracting(entry.deselect).union(entry.select).intersection(shown)
      if next != selectedIds { visible = true }
      selectedIds = next
      self[keyPath: target].append(returning)
      if visible { break }
    }
    snapshot = Dictionary(store.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
    selection = selectedIds
  }
}
