import EditorModelInterface
import LexicalSwift
import LexidrawKit
import SwiftUI
import TextKitEditor

/// Opens the stored native editor and saves accepted edits against the revision read.
struct DocumentScreen: View {
  let session: Session
  let id: String
  let title: String

  var body: some View {
    FileScreen(what: "the document", title: title, titled: \.title) {
      let stored = try await session.document(id)
      let settings = try DocumentSettings(state: stored.state, appState: stored.appState)
      let font = try await loadDocumentFont(settings, session: session)
      try Task.checkCancellation()
      return try DocumentEditing(session: session, stored: stored, settings: settings, font: font)
    } content: { editing, reload in
      DocumentContent(editing: editing, reload: reload)
        .id(ObjectIdentifier(editing))
    }
  }
}

@MainActor @Observable final class DocumentEditing {
  enum Mode { case editing, readOnly, notYetEditable }
  private(set) var title: String
  private(set) var id: String
  let model: any EditorModel
  let mode: Mode
  let session: Session
  let settings: DocumentSettings
  let font: DocumentFont
  private let appState: JSONValue?
  private let saver: DocumentSaver
  private var sending: Task<Void, Never>?
  private(set) var status = DocumentSaver.Status.saved
  var conflict = false
  var copyProblem: String?

  init(session: Session, stored: StoredDocument, settings: DocumentSettings, font: DocumentFont)
    throws
  {
    let model = Editor()
    do { try model.load(stored.state) } catch { throw Unreadable() }
    self.model = model
    self.session = session
    self.settings = settings
    self.font = font
    id = stored.id
    title = stored.title
    appState = stored.appState
    mode = stored.access != .edit ? .readOnly : model.isEditable ? .editing : .notYetEditable
    saver = DocumentSaver(session: session, document: stored.id, readAt: stored.updatedAt)
  }

  func changed() {
    guard mode == .editing else { return }
    sending = Task { [sending, saver, weak self] in
      await sending?.value
      await saver.changed { @MainActor [weak self] in
        guard let self else { throw CancellationError() }
        return try model.serializedState()
      }
    }
  }

  func followSaving() async {
    let (stream, continuation) = AsyncStream.makeStream(of: DocumentSaver.Status.self)
    await saver.observe { continuation.yield($0) }
    for await status in stream {
      self.status = status
      if status == .conflict { conflict = true }
    }
  }

  func saveNow() async {
    await sending?.value
    await saver.saveNow()
  }

  func keepMineAsCopy() async {
    await sending?.value
    do {
      let copy = try await saver.keepMineAsCopy(title: title, appState: appState)
      id = copy.id
      title = copy.title
      conflict = false
      copyProblem = nil
      // Edits made while creating the copy must follow it to its new revision.
      await saver.saveNow()
    } catch {
      copyProblem =
        "Couldn’t finish saving a copy of “\(title)”. Try Keep Mine as a Copy again. \(error.localizedDescription)"
    }
  }
}

private struct DocumentContent: View {
  @Bindable var editing: DocumentEditing
  let reload: () async -> Void
  @Environment(\.scenePhase) private var scenePhase

  var body: some View {
    DocumentEditor(editing: editing)
      .ignoresSafeArea(.container, edges: .bottom)
      .safeAreaInset(edge: .top, spacing: 0) { notice }
      .task { await editing.followSaving() }
      .onDisappear { Task { await editing.saveNow() } }
      .onChange(of: scenePhase) { _, phase in
        if phase != .active { Task { await editing.saveNow() } }
      }
  }

  private var notice: some View {
    VStack(spacing: 6) {
      switch editing.mode {
      case .readOnly: Label("Read only", systemImage: "eye")
      case .notYetEditable:
        Label("Read only: this document has parts the app can’t edit yet", systemImage: "eye")
      case .editing:
        if editing.conflict {
          Text(
            "“\(editing.title)” has newer edits. Reload theirs or keep your edits as a separate copy."
          )
          HStack {
            Button("Reload Theirs") { Task { await reload() } }
            Button("Keep Mine as a Copy") { Task { await editing.keepMineAsCopy() } }
          }
          if let problem = editing.copyProblem { Text(problem) }
        } else {
          switch editing.status {
          case .saved: Text("Saved")
          case .unsaved: Text("Unsaved changes")
          case .saving: ProgressView("Saving…")
          case .conflict: EmptyView()
          case .failed(let message):
            Text("Couldn’t save “\(editing.title)”. Try again. \(message)")
            Button("Try Again") { Task { await editing.saveNow() } }
          }
        }
      }
    }
    .font(.footnote)
    .frame(maxWidth: .infinity)
    .padding(.horizontal)
    .padding(.vertical, 8)
    .background(.bar)
  }
}

private struct DocumentEditor: UIViewRepresentable {
  let editing: DocumentEditing

  func makeUIView(context: Context) -> EditorView {
    let view = EditorView(
      model: editing.model, isEditable: editing.mode == .editing,
      language: editing.settings.language, font: editing.font)
    view.onChange = { [weak editing] in editing?.changed() }
    configureEmbeddedDrawings(view)
    configureHTMLBlocks(view, session: editing.session, documentID: editing.id)
    configureRenderedEmbeds(view, session: editing.session, fontFamily: editing.settings.fontFamily)
    view.configureSocialNodes(userID: nil, author: "Guest")
    Task { [weak view, session = editing.session] in
      guard let identity = try? await session.identity() else { return }
      view?.configureSocialNodes(userID: identity.id, author: identity.name)
    }
    if editing.mode == .editing {
      view.uploadImage = { [weak editing] data in
        guard let editing else { throw CancellationError() }
        return try await editing.session.uploadImage(data, in: editing.id)
      }
      view.insertionActions = view.imageInsertionActions + view.socialInsertionActions + [drawingInsertionAction(for: view)] + renderedInsertionActions(for: view)
    }
    return view
  }

  func updateUIView(_ view: EditorView, context: Context) {}
}
