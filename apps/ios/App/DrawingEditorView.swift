import DrawingKit
import LexidrawKit
import PhotosUI
import SwiftUI

/// A drawing being edited: the editor, and the saving of what it changes.
@MainActor @Observable final class DrawingEditing {
  let editor: DrawingEditor
  private(set) var tool = DrawingTool.selection
  private(set) var historyButtons: [EditorButton] = []
  private(set) var selectionButtons: [EditorButton] = []
  private(set) var styles = StyleControls()
  private(set) var status = DrawingSaver.Status.saved
  /// Something about an image that went wrong, to tell the user.
  var imageProblem: String?
  /// The files the drawing's images show, by id.
  @ObservationIgnored private(set) var images: [String: DrawingImage] = [:]
  /// Draws the canvas again; the canvas sets it.
  @ObservationIgnored var redraw: () -> Void = {}
  /// The middle of what is on screen, in the drawing's units, and the
  /// screen's height in points; the canvas sets it.
  @ObservationIgnored var viewport: () -> (center: Point2D, height: Double) = { (Point2D(0, 0), 800) }
  @ObservationIgnored private let session: Session
  @ObservationIgnored private let drawingId: String
  @ObservationIgnored private let saver: DrawingSaver
  @ObservationIgnored private var saved: [JSONValue]
  /// The last hand-over to the saver, which the next one waits for, so
  /// the saver gets the edits in the order they were made.
  @ObservationIgnored private var sending: Task<Void, Never>?
  /// Placed images whose upload failed, sent again after the next edit.
  @ObservationIgnored private var unsent: [String: ImageFile] = [:]
  @ObservationIgnored private var uploading = false

  init(session: Session, drawing: StoredDrawing) {
    editor = DrawingEditor(elements: drawing.elements, measurer: FontLibrary.shared)
    saved = editor.elements
    self.session = session
    drawingId = drawing.id
    saver = DrawingSaver(session: session, drawing: drawing.id, readAt: drawing.updatedAt)
  }

  func loadImages() async {
    await DrawingImages.load(for: editor.elements, drawing: drawingId, session: session) { id, image in
      images[id] = image
      redraw()
    }
  }

  /// Places a picked image in the middle of the screen, and stores its
  /// file, as the web does with a dropped one.
  func place(_ picked: Data) async {
    let file: ImageFile
    do {
      file = try await Task.detached { try ImageFile(data: picked) }.value
    } catch is ImageFile.TooLarge {
      imageProblem = "This image is too large to place, even when shrunk."
      return
    } catch {
      imageProblem = "This file isn’t an image that can be placed."
      return
    }
    images[file.id] = await DrawingImages.decode(file.data, mimeType: file.mimeType)
    let viewport = viewport()
    editor.tool = .selection
    perform(.placeImage(file, at: viewport.center, viewportHeight: viewport.height))
    unsent[file.id] = file
    await sendImages()
  }

  /// Uploads what was placed and not yet stored, marking each image stored
  /// or refused, as the web marks them.
  private func sendImages() async {
    guard !uploading else { return }
    uploading = true
    defer { uploading = false }
    for (id, file) in unsent {
      do {
        try await session.store(file.data, as: id, mimeType: file.mimeType, inDrawing: drawingId)
        unsent[id] = nil
        editor.setStatus("saved", ofImagesShowing: id)
      } catch let refusal as FileRefused {
        unsent[id] = nil
        editor.setStatus("error", ofImagesShowing: id)
        imageProblem = refusal.reason
      } catch {
        imageProblem = "An image couldn’t be uploaded. It’s tried again after your next change."
        return
      }
      edited()
    }
  }

  func perform(_ action: EditorAction) {
    editor.perform(action)
    edited()
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

  /// While a gesture is under way: the canvas and the controls follow the
  /// editor, and what it is in the middle of isn't saved.
  func changing() {
    tool = editor.tool
    historyButtons = editor.historyButtons
    selectionButtons = editor.selectionButtons
    styles = editor.styleControls
    redraw()
  }

  /// After an edit is made: changed elements are handed to the saver too.
  func edited() {
    changing()
    if !unsent.isEmpty { Task { await sendImages() } }
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
  @State private var stylesShown = false
  @State private var photo: PhotosPickerItem?
  @State private var photosShown = false
  @State private var filesShown = false
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
          buttons(editing.historyButtons)
          Menu("Insert Image", systemImage: "photo.badge.plus") {
            Button("Photo Library", systemImage: "photo.on.rectangle") { photosShown = true }
            Button("Files", systemImage: "folder") { filesShown = true }
          }
          Button("Style", systemImage: "paintpalette") { stylesShown = true }
            .popover(isPresented: $stylesShown) {
              StyleInspector(controls: editing.styles, theme: theme) { editing.perform(.style($0)) }
                .presentationCompactAdaptation(.popover)
            }
        }
        ToolbarItemGroup(placement: .bottomBar) {
          Picker("Tool", selection: Binding(get: { editing.tool }, set: { editing.select($0) })) {
            ForEach(DrawingTool.allCases, id: \.self) { tool in
              Label(tool.name, systemImage: tool.systemImage).tag(tool)
            }
          }
          .pickerStyle(.segmented)
          .fixedSize()
          buttons(editing.selectionButtons)
        }
      }
      .alert("Someone else changed this drawing", isPresented: .constant(editing.status == .conflict)) {
        Button("Keep My Changes") { editing.keepMine() }
        Button("Use Theirs", role: .cancel) { Task { await reload() } }
      } message: {
        Text("It was saved elsewhere while you were editing it. Your changes can replace theirs, or be discarded.")
      }
      .photosPicker(isPresented: $photosShown, selection: $photo, matching: .images)
      .onChange(of: photo) {
        guard let photo else { return }
        self.photo = nil
        Task {
          if let data = try? await photo.loadTransferable(type: Data.self) {
            await editing.place(data)
          } else {
            editing.imageProblem = "The photo couldn’t be read."
          }
        }
      }
      .fileImporter(isPresented: $filesShown, allowedContentTypes: [.image]) { result in
        guard case .success(let url) = result else { return }
        let reading = url.startAccessingSecurityScopedResource()
        defer { if reading { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else {
          editing.imageProblem = "The file couldn’t be read."
          return
        }
        Task { await editing.place(data) }
      }
      .alert(
        "Image", isPresented: Binding(get: { editing.imageProblem != nil }, set: { if !$0 { editing.imageProblem = nil } })
      ) {
        Button("OK") {}
      } message: {
        Text(editing.imageProblem ?? "")
      }
      .task { await editing.loadImages() }
      .task { await editing.followSaving() }
      .onDisappear { editing.saveNow() }
      .onChange(of: scenePhase) { if scenePhase != .active { editing.saveNow() } }
  }

  private func buttons(_ buttons: [EditorButton]) -> some View {
    ForEach(buttons) { button in
      Button(button.title, systemImage: button.systemImage, role: button.isDestructive ? .destructive : nil) {
        editing.perform(button.action)
      }
      .disabled(!button.isEnabled)
    }
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
    case .arrow: "Arrow"
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
    case .arrow: "arrow.up.right"
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
    case .arrow: "a"
    case .line: "l"
    case .freedraw: "p"
    case .text: "t"
    }
  }
}
