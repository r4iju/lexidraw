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
      ForEach(shared.value ?? []) { entry in
        OpenLink(file: entry) { FileRow(entry: entry) }
          .fileActions(for: entry)
      }
    }
    .overlay(for: shared, what: "what’s shared with you", retry: load, isEmpty: \.isEmpty) {
      ContentUnavailableView(
        "Nothing shared with you", systemImage: "person.2",
        description: Text("Files others share with you show up here."))
    }
    .navigationTitle("Shared with Me")
    .task(id: browser.reloads) { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    if let loaded = await Loaded.from({ try await session.sharedWithMe() }) { shared = loaded }
  }
}
