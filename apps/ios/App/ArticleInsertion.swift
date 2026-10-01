import EditorModelInterface
import LexidrawKit
import LexicalSwift
import SwiftUI
import TextKitEditor
import UIKit

@MainActor func articleInsertionAction(for editor: EditorView, session: Session) -> UIAction {
  UIAction(title: "Saved link…", image: UIImage(systemName: "link")) { [weak editor] _ in
    guard let editor else { return }
    var responder: UIResponder? = editor
    while responder != nil, !(responder is UIViewController) { responder = responder?.next }
    guard let presenter = responder as? UIViewController else { return }
    let picker = UIHostingController(rootView: ArticleInsertion(session: session) { [weak editor] data in
      guard let editor, editor.isEditable else { throw EditorError.unsupported("The document cannot be edited") }
      guard var fields = try JSONValue(parsing: WebArticleData.insertionNodeJSON).objectValue else { preconditionFailure("Generated article factory is missing") }
      fields["data"] = data
      editor.insertEmbeddedNode(.object(fields), namespace: editorNamespace, openAfterInsertion: false)
    })
    picker.modalPresentationStyle = .pageSheet
    presenter.present(picker, animated: true)
  }
}

private struct ArticleInsertion: View {
  let session: Session
  let insert: (JSONValue) throws -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var saved = false
  @State private var url = ""
  @State private var query = ""
  @State private var choices: [(id: String, title: String)] = []
  @State private var operation: Task<Void, Never>?
  @State private var busy = false
  @State private var problem: String?
  var body: some View {
    NavigationStack {
      Form {
        Picker("Source", selection: $saved) {
          Text("Paste a link").tag(false)
          Text("From saved").tag(true)
        }.pickerStyle(.segmented)
        if saved {
          TextField("Search saved articles", text: $query)
          ForEach(choices, id: \.id) { choice in
            Button(choice.title) { operation = Task { await choose(choice.id, title: choice.title) } }
              .disabled(busy)
          }
        } else {
          TextField("https://example.com/article", text: $url)
            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
          Button("Embed link") { operation = Task { await extract() } }.disabled(url.isEmpty || busy)
        }
        if busy { ProgressView() }
        if let problem { Text(problem).foregroundStyle(.red) }
      }
      .onDisappear { operation?.cancel() }
      .navigationTitle("Embed a link")
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
      .task(id: saved ? query : nil) {
        guard saved else { return }
        do {
          if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let entries = try await session.savedArticles()
            guard !Task.isCancelled else { return }
            choices = entries.map { ($0.id, $0.title) }
          } else {
            let entries = try await session.search(query)
            guard !Task.isCancelled else { return }
            choices = entries.filter { $0.kind == .url }.map { ($0.id, $0.title) }
          }
        } catch { if !Task.isCancelled { problem = error.localizedDescription } }
      }
    }
  }
  private func extract() async {
    busy = true; problem = nil
    defer { busy = false }
    do {
      guard let address = URL(string: url) else { throw EditorError.invalidState("Enter a valid URL") }
      let distilled = try await session.extractArticle(url: address)
      try Task.checkCancellation()
      try insert(["mode": "url", "url": .string(url), "distilled": distilled])
      dismiss()
    } catch { problem = error.localizedDescription }
  }
  private func choose(_ id: String, title: String) async {
    busy = true; problem = nil
    defer { busy = false }
    do {
      var data: JSONObject = ["mode": "entity", "entityId": .string(id)]
      if let distilled = try await session.articleSnapshot(entityID: id),
        let html = distilled["contentHtml"]?.stringValue, !html.isEmpty {
        var snapshot: JSONObject = ["contentHtml": .string(html)]
        snapshot["title"] = distilled["title"]?.stringValue?.isEmpty == false ? distilled["title"] : .string(title)
        for field in ["byline", "siteName", "wordCount", "bestImageUrl"] { snapshot[field] = distilled[field] ?? .null }
        snapshot["updatedAt"] = distilled["updatedAt"] ?? .string(Date.now.ISO8601Format(.init(includingFractionalSeconds: true)))
        data["snapshot"] = .object(snapshot)
      }
      try Task.checkCancellation()
      try insert(.object(data))
      dismiss()
    } catch { problem = error.localizedDescription }
  }
}
