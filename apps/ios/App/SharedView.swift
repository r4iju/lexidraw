import LexidrawKit
import SwiftUI

/// What others shared with the caller, wherever they keep it, so a file in a
/// folder nobody gave them is still reachable.
struct SharedView: View {
  let session: Session
  @Environment(Browser.self) private var browser
  @State private var shared: Loaded<[Entry]> = .loading

  var body: some View {
    List {
      if let entries = shared.value, !entries.isEmpty {
        Section {
          ForEach(entries) { entry in
            OpenLink(file: entry) { FileRow(entry: entry) }
              .fileActions(for: entry)
          }
        } header: {
          Text("Shared files")
        }
        Text("Available here even when you can’t open their folders. Each file’s access determines what you can change.")
          .font(.footnote)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
          .listRowSeparator(.hidden)
          .listRowBackground(Color.clear)
      }
    }
    .overlay(for: shared, what: "Shared", retry: load, isEmpty: \.isEmpty) {
      ContentUnavailableView(
        "Nothing shared with you", systemImage: "person.2",
        description: Text("Files others share with you show up here."))
    }
    .accountControl()
    .navigationTitle("Shared")
    .task(id: browser.reloads) { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    if shared.value == nil { shared = .loading }
    if let loaded = await Loaded.from({ try await session.sharedWithMe() }) { shared = loaded }
  }
}
