import Foundation

/// Excalidraw's `Store` and `History`: each capture records what changed
/// since the last one, and undo applies it backwards as a new version of
/// each element, so an undone edit syncs like any other.
struct History {
  /// What one step changes back: per element, the fields to set, the
  /// selection to take and give up, and the group being edited, when the
  /// step entered or left one.
  struct Entry {
    var elements: [String: RawElement]
    var select: Set<String>
    var deselect: Set<String>
    var editingGroup: (back: String?, forward: String?)?

    var inverse: Entry {
      Entry(
        elements: elements, select: deselect, deselect: select,
        editingGroup: editingGroup.map { ($0.forward, $0.back) })
    }
  }

  /// What the editor shows that a step can change.
  struct State {
    var store: [RawElement]
    var selection: Set<String>
    var editingGroupId: String?
  }

  private var snapshot: [String: RawElement] = [:]
  private var selection: Set<String> = []
  private var editingGroupId: String?
  private var undoStack: [Entry] = []
  private var redoStack: [Entry] = []

  var canUndo: Bool { !undoStack.isEmpty }
  var canRedo: Bool { !redoStack.isEmpty }

  /// The fields a change is not about: what every change stamps anew.
  private static let unrecorded: Set<String> = ["id", "updated", "version", "versionNonce", "seed"]

  mutating func reset(to state: State) {
    snapshot = Dictionary(state.store.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
    selection = state.selection
    editingGroupId = state.editingGroupId
    undoStack = []
    redoStack = []
  }

  /// `Store.captureIncrement`: the step back to the last capture goes on
  /// the undo stack; one that changes elements ends what could be redone.
  mutating func record(_ state: State) {
    var back: [String: RawElement] = [:]
    for element in state.store {
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
      elements: back, select: selection.subtracting(state.selection),
      deselect: state.selection.subtracting(selection),
      editingGroup: editingGroupId == state.editingGroupId ? nil : (editingGroupId, state.editingGroupId))
    if !back.isEmpty || !entry.select.isEmpty || !entry.deselect.isEmpty || entry.editingGroup != nil {
      undoStack.append(entry)
    }
    if !back.isEmpty { redoStack = [] }
    snapshot = Dictionary(state.store.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
    selection = state.selection
    editingGroupId = state.editingGroupId
  }

  /// Takes `element` as it is now without a step to undo.
  mutating func adopt(_ element: RawElement) {
    snapshot[element.id] = element
  }

  mutating func undo(_ state: inout State, environment: EditorEnvironment) {
    perform(&state, environment, from: \.undoStack, to: \.redoStack)
  }

  mutating func redo(_ state: inout State, environment: EditorEnvironment) {
    perform(&state, environment, from: \.redoStack, to: \.undoStack)
  }

  /// `History.perform`: applies entries until one makes a difference to
  /// what's on screen, and keeps the way back to what each overwrote.
  private mutating func perform(
    _ state: inout State, _ environment: EditorEnvironment,
    from source: WritableKeyPath<History, [Entry]>, to target: WritableKeyPath<History, [Entry]>
  ) {
    while let entry = self[keyPath: source].popLast() {
      var visible = false
      var returning = entry.inverse
      for (id, fields) in entry.elements {
        guard let position = state.store.firstIndex(where: { $0.id == id }) else { continue }
        let element = state.store[position]
        returning.elements[id] = fields.reduce(into: [:]) { $0[$1.key] = element[$1.key] ?? .null }
        let deleted = element.isDeleted
        let deleting = fields["isDeleted"]?.boolValue
        if !visible {
          visible =
            deleted
            ? deleting == false
            : deleting == true || fields.contains { element[$0.key] != $0.value }
        }
        environment.update(&state.store[position], fields)
      }
      let shown = state.store.filter { !$0.isDeleted }
      let next = state.selection.subtracting(entry.deselect).union(entry.select).intersection(shown.map(\.id))
      if next != state.selection { visible = true }
      state.selection = next
      // `filterInvisibleChanges`: leaving a group always shows, entering
      // one only while something is still in it.
      if let (group, _) = entry.editingGroup {
        let entered = group.flatMap { group in
          shown.contains { $0["groupIds"]?.arrayValue?.contains(.string(group)) == true } ? group : nil
        }
        if entered != nil || group == nil { visible = true }
        state.editingGroupId = entered
      }
      self[keyPath: target].append(returning)
      if visible { break }
    }
    snapshot = Dictionary(state.store.map { ($0.id, $0) }, uniquingKeysWith: { $1 })
    selection = state.selection
    editingGroupId = state.editingGroupId
  }
}
