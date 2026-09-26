import LexidrawKit
import SwiftUI

/// The caller's own files in the trash, last in first.
struct TrashView: View {
  let session: Session
  @Environment(Browser.self) private var browser
  @Environment(FileActions.self) private var actions
  @Environment(\.colorScheme) private var colorScheme
  @State private var trash: [TrashedEntry]?
  @State private var failure: String?

  var body: some View {
    List {
      ForEach(trash ?? []) { entry in
        HStack(spacing: 12) {
          ThumbnailView(url: entry.thumbnail(dark: colorScheme == .dark), kind: entry.kind)
          VStack(alignment: .leading, spacing: 2) {
            Text(entry.title).lineLimit(1)
            Text("Deleted \(entry.deletedAt, format: .relative(presentation: .named))")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
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
    .overlay {
      if let failure {
        ContentUnavailableView {
          Label("Couldn't load the trash", systemImage: "wifi.exclamationmark")
        } description: {
          Text(failure)
        } actions: {
          Button("Try Again") { Task { await load() } }
        }
      } else if trash == nil {
        ProgressView()
      } else if trash?.isEmpty == true {
        ContentUnavailableView(
          "The trash is empty", systemImage: "trash",
          description: Text("Files you delete go here, until you restore them."))
      }
    }
    .navigationTitle("Trash")
    .task(id: browser.reloads) { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    do {
      trash = try await session.trash()
      failure = nil
    } catch is CancellationError {
      return
    } catch {
      failure = error.localizedDescription
    }
  }
}
