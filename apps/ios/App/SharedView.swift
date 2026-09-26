import LexidrawKit
import SwiftUI

/// What others shared with the caller, wherever they keep it, so a file in a
/// folder nobody gave them is still reachable.
struct SharedView: View {
  let session: Session
  @Environment(Browser.self) private var browser
  @State private var shared: [Entry]?
  @State private var failure: String?

  var body: some View {
    List {
      ForEach(shared ?? []) { entry in
        if entry.kind == .folder {
          NavigationLink(value: Place.Folder(id: entry.id, title: entry.title)) {
            EntryRow(entry: entry)
          }
        } else {
          NavigationLink {
            NotYet(title: entry.title, systemImage: entry.kind.systemImage, feature: "Files open")
          } label: {
            EntryRow(entry: entry)
          }
        }
      }
    }
    .overlay {
      if let failure {
        ContentUnavailableView {
          Label("Couldn't load what's shared with you", systemImage: "wifi.exclamationmark")
        } description: {
          Text(failure)
        } actions: {
          Button("Try Again") { Task { await load() } }
        }
      } else if shared == nil {
        ProgressView()
      } else if shared?.isEmpty == true {
        ContentUnavailableView(
          "Nothing shared with you", systemImage: "person.2",
          description: Text("Files others share with you show up here."))
      }
    }
    .navigationTitle("Shared with Me")
    .task(id: browser.reloads) { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    do {
      shared = try await session.sharedWithMe()
      failure = nil
    } catch is CancellationError {
      return
    } catch {
      failure = error.localizedDescription
    }
  }
}
