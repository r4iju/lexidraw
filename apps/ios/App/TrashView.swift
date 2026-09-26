import LexidrawKit
import SwiftUI

/// The caller's own files in the trash, last in first.
struct TrashView: View {
  let session: Session
  @Environment(Browser.self) private var browser
  @Environment(FileActions.self) private var actions
  @State private var trash: Loaded<[TrashedEntry]> = .loading

  var body: some View {
    List {
      ForEach(trash.value ?? []) { entry in
        FileRow(file: entry, caption: "Deleted \(entry.deletedAt.formatted(.relative(presentation: .named)))")
          .swipeActions {
            Button("Restore", systemImage: "arrow.uturn.backward") {
              Task { await actions.restore(entry) }
            }
            .tint(.blue)
          }
          .contextMenu {
            Button("Restore", systemImage: "arrow.uturn.backward") {
              Task { await actions.restore(entry) }
            }
          }
      }
    }
    .overlay(for: trash, what: "the Trash", retry: load, isEmpty: \.isEmpty) {
      ContentUnavailableView(
        "The Trash is empty", systemImage: "trash",
        description: Text("Files you delete wait here until you restore them."))
    }
    .navigationTitle("Trash")
    .task(id: browser.reloads) { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    if let loaded = await Loaded.from({ try await session.trash() }) { trash = loaded }
  }
}
