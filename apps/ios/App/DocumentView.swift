import EditorModelInterface
import LexicalSwift
import LexidrawKit
import SwiftUI
import TextKitEditor

/// A document in the TextKit editor, edited where the user may edit it and
/// shown read-only elsewhere. A preview until saving comes: nothing edited
/// here reaches the server.
struct DocumentScreen: View {
  let session: Session
  let id: String
  let title: String

  var body: some View {
    FileScreen(what: "the document", title: title, titled: \.title) {
      try OpenDocument(try await session.document(id))
    } content: { open, _ in
      DocumentEditor(model: open.model, isEditable: open.mode == .editing)
        .id(ObjectIdentifier(open.model))
        .ignoresSafeArea(.container, edges: .bottom)
        .safeAreaInset(edge: .top, spacing: 0) { PreviewNotice(mode: open.mode) }
    }
  }
}

/// A stored document loaded into LexicalSwift.
private struct OpenDocument {
  enum Mode {
    case editing
    /// The user may only read it.
    case readOnly
    /// The model loaded it but isn't `isEditable`.
    case notYetEditable
  }

  let title: String
  /// Made for this load, so it tells one load from another.
  let model: any EditorModel
  let mode: Mode

  init(_ stored: StoredDocument) throws {
    let model = Editor()
    do { try model.load(stored.state) } catch { throw Unreadable() }
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
