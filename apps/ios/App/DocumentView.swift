import EditorModelInterface
import LexicalSwift
import LexidrawKit
import SwiftUI
import TextKitEditor

/// A document in the TextKit editor, edited where the user may edit it and
/// shown read-only elsewhere. A preview until #130 brings saving: nothing
/// edited here reaches the server.
struct DocumentScreen: View {
  let session: Session
  let id: String
  let title: String
  @State private var document: Loaded<OpenDocument> = .loading

  var body: some View {
    Group {
      if let open = document.value {
        DocumentEditor(model: open.model, isEditable: open.mode == .editing)
          .ignoresSafeArea(.container, edges: .bottom)
          .safeAreaInset(edge: .top, spacing: 0) { PreviewNotice(mode: open.mode) }
      } else {
        Color.clear
      }
    }
    .overlay(for: document, what: "the document", retry: load)
    .navigationTitle(document.value?.title ?? title)
    .navigationBarTitleDisplayMode(.inline)
    .task { await load() }
  }

  private func load() async {
    if let loaded = await Loaded.from({ try OpenDocument(try await session.document(id)) }) { document = loaded }
  }
}

/// A stored document loaded into LexicalSwift.
private struct OpenDocument {
  enum Mode {
    case editing
    /// The user may only read it.
    case readOnly
    /// LexicalSwift would refuse every edit.
    case notYetEditable
  }

  let title: String
  let model: any EditorModel
  let mode: Mode

  init(_ stored: StoredDocument) throws {
    let model = Editor()
    try model.load(stored.state)
    title = stored.title
    self.model = model
    mode = stored.access != .edit ? .readOnly : model.isEditable ? .editing : .notYetEditable
  }
}

/// What becomes of the user's edits, said above the document for as long as
/// it is open.
private struct PreviewNotice: View {
  let mode: OpenDocument.Mode

  var body: some View {
    Group {
      switch mode {
      case .editing:
        Label("Preview: changes aren’t saved", systemImage: "exclamationmark.triangle.fill")
          .symbolRenderingMode(.multicolor)
      case .readOnly:
        Label("Read only", systemImage: "eye")
      case .notYetEditable:
        Label("Read only: this document has parts the app can’t edit yet", systemImage: "eye")
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
  let model: any EditorModel
  let isEditable: Bool

  func makeUIView(context: Context) -> EditorView { EditorView(model: model, isEditable: isEditable) }

  func updateUIView(_ view: EditorView, context: Context) {}
}
