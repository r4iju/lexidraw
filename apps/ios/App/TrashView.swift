import LexidrawKit
import SwiftUI

/// The caller's own files in the trash, last in first.
struct TrashView: View {
  let session: Session
  @Environment(Browser.self) private var browser
  @Environment(FileActions.self) private var actions
  @State private var trash: Loaded<[TrashedEntry]> = .loading
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let layout = typeSize.isAccessibilitySize
      ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
      : AnyLayout(HStackLayout(spacing: 8))
    List {
      ForEach(trash.value ?? []) { entry in
        layout {
          FileRow(file: entry, caption: "Deleted \(entry.deletedAt.formatted(.relative(presentation: .named)))")
            .frame(maxWidth: .infinity, alignment: .leading)
          Button {
            Task { await actions.restore(entry) }
          } label: {
            if actions.restoring.contains(entry.id) {
              ProgressView()
                .accessibilityLabel("Restoring \(entry.title)")
                .frame(minHeight: 44)
            } else {
              Label("Restore", systemImage: "arrow.uturn.backward")
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
            }
          }
          .buttonStyle(.borderless)
          .disabled(actions.restoring.contains(entry.id))
          .accessibilityLabel("Restore \(entry.title)")
          .accessibilityValue(actions.restoring.contains(entry.id) ? "Restoring" : "")
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
    .overlay(for: trash, what: "the Trash", retry: load, isEmpty: \.isEmpty) {
      ContentUnavailableView(
        "The Trash is empty", systemImage: "trash",
        description: Text("Files you delete wait here until you restore them."))
    }
    .phoneAccountControl()
    .navigationTitle("Trash")
    .task(id: browser.reloads) { await load() }
    .refreshable { await load() }
  }

  private func load() async {
    if trash.value == nil { trash = .loading }
    if let loaded = await Loaded.from({ try await session.trash() }) { trash = loaded }
  }
}
