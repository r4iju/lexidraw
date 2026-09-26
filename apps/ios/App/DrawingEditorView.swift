import DrawingKit
import LexidrawKit
import SwiftUI

/// A drawing being edited: the editor, and the saving of what it changes.
@MainActor @Observable final class DrawingEditing {
  let editor: DrawingEditor
  private(set) var tool = DrawingTool.selection
  private(set) var canUndo = false
  private(set) var canRedo = false
  private(set) var hasSelection = false
  private(set) var status = DrawingSaver.Status.saved
  /// Draws the canvas again; the canvas sets it.
  @ObservationIgnored var redraw: () -> Void = {}
  @ObservationIgnored private let saver: DrawingSaver
  @ObservationIgnored private var saved: [JSONValue]
  /// The last hand-over to the saver, which the next one waits for, so
  /// the saver gets the edits in the order they were made.
  @ObservationIgnored private var sending: Task<Void, Never>?

  init(session: Session, drawing: StoredDrawing) {
    editor = DrawingEditor(elements: drawing.elements, measurer: FontLibrary.shared)
    saved = editor.elements
    saver = DrawingSaver(session: session, drawing: drawing.id, readAt: drawing.updatedAt)
  }

  /// Follows the saver's status for as long as the caller waits.
  func followSaving() async {
    let (statuses, continuation) = AsyncStream.makeStream(of: DrawingSaver.Status.self)
    await saver.observe { continuation.yield($0) }
    for await status in statuses { self.status = status }
  }

  func select(_ tool: DrawingTool) {
    editor.tool = tool
    edited()
  }

  func undo() {
    editor.undo()
    edited()
  }

  func redo() {
    editor.redo()
    edited()
  }

  func deleteSelection() {
    editor.deleteSelection()
    edited()
  }

  /// While a gesture is under way: the canvas and the controls follow the
  /// editor, and what it is in the middle of isn't saved.
  func changing() {
    tool = editor.tool
    canUndo = editor.canUndo
    canRedo = editor.canRedo
    hasSelection = !editor.selectedIds.isEmpty
    redraw()
  }

  /// After an edit is made: changed elements are handed to the saver too.
  func edited() {
    changing()
    let elements = editor.elements
    guard elements != saved else { return }
    saved = elements
    sending = Task { [sending, saver] in
      await sending?.value
      await saver.changed(elements)
    }
  }

  func saveNow() {
    Task { [sending, saver] in
      await sending?.value
      await saver.saveNow()
    }
  }

  func keepMine() {
    Task { [saver] in await saver.keepMine() }
  }
}

struct DrawingEditorScreen: View {
  let drawing: StoredDrawing
  let theme: DrawingTheme
  let reload: () async -> Void
  @State private var editing: DrawingEditing
  @Environment(\.scenePhase) private var scenePhase

  init(session: Session, drawing: StoredDrawing, theme: DrawingTheme, reload: @escaping () async -> Void) {
    self.drawing = drawing
    self.theme = theme
    self.reload = reload
    _editing = State(initialValue: DrawingEditing(session: session, drawing: drawing))
  }

  var body: some View {
    EditorCanvas(editing: editing, background: drawing.background, theme: theme)
      .ignoresSafeArea(edges: .bottom)
      .navigationSubtitle(status)
      .toolbar {
        ToolbarItemGroup(placement: .topBarTrailing) {
          if case .failed = editing.status {
            Button("Try Saving Again", systemImage: "arrow.clockwise") { editing.saveNow() }
          }
          Button("Undo", systemImage: "arrow.uturn.backward") { editing.undo() }
            .disabled(!editing.canUndo)
          Button("Redo", systemImage: "arrow.uturn.forward") { editing.redo() }
            .disabled(!editing.canRedo)
        }
        ToolbarItemGroup(placement: .bottomBar) {
          Picker("Tool", selection: Binding(get: { editing.tool }, set: { editing.select($0) })) {
            ForEach(DrawingTool.allCases, id: \.self) { tool in
              Label(tool.name, systemImage: tool.systemImage).tag(tool)
            }
          }
          .pickerStyle(.segmented)
          .fixedSize()
          if editing.hasSelection {
            Button("Delete", systemImage: "trash", role: .destructive) { editing.deleteSelection() }
          }
        }
      }
      .alert("Someone else changed this drawing", isPresented: .constant(editing.status == .conflict)) {
        Button("Keep My Changes") { editing.keepMine() }
        Button("Use Theirs", role: .cancel) { Task { await reload() } }
      } message: {
        Text("It was saved elsewhere while you were editing it. Your changes can replace theirs, or be discarded.")
      }
      .task { await editing.followSaving() }
      .onDisappear { editing.saveNow() }
      .onChange(of: scenePhase) { if scenePhase != .active { editing.saveNow() } }
  }

  private var status: String {
    switch editing.status {
    case .saved: "Saved"
    case .saving: "Saving…"
    case .unsaved: "Edited"
    case .conflict: "Not saved"
    case .failed: "Couldn’t save"
    }
  }
}

extension DrawingTool {
  var name: String {
    switch self {
    case .selection: "Select"
    case .rectangle: "Rectangle"
    case .diamond: "Diamond"
    case .ellipse: "Ellipse"
    case .line: "Line"
    case .freedraw: "Draw"
    case .text: "Text"
    }
  }

  var systemImage: String {
    switch self {
    case .selection: "cursorarrow"
    case .rectangle: "rectangle"
    case .diamond: "diamond"
    case .ellipse: "circle"
    case .line: "line.diagonal"
    case .freedraw: "pencil.tip"
    case .text: "textformat"
    }
  }

  /// The web's key for the tool.
  var key: String {
    switch self {
    case .selection: "v"
    case .rectangle: "r"
    case .diamond: "d"
    case .ellipse: "o"
    case .line: "l"
    case .freedraw: "p"
    case .text: "t"
    }
  }
}
