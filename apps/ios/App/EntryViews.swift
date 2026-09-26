import LexidrawKit
import SwiftUI

/// A file as every list shows one, whichever list it came from.
protocol FileItem: Identifiable where ID == String {
  var title: String { get }
  var kind: Entry.Kind { get }
  func thumbnail(dark: Bool) -> URL?
}

extension Entry: FileItem {}
extension SearchResult: FileItem {}
extension TrashedEntry: FileItem {}

/// A file in a list: its picture and title, and a line about it.
struct FileRow: View {
  let file: any FileItem
  let caption: String
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    HStack(spacing: 12) {
      ThumbnailView(url: file.thumbnail(dark: colorScheme == .dark), kind: file.kind)
      VStack(alignment: .leading, spacing: 2) {
        Text(file.title).lineLimit(1)
        Text(caption)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
  }
}

extension FileRow {
  /// When it last changed, and the caller's own tags on it.
  init(entry: Entry) {
    let changed = entry.updatedAt.formatted(.relative(presentation: .named))
    self.init(
      file: entry, caption: entry.tags.isEmpty ? changed : "\(changed) · \(entry.tags.joined(separator: ", "))")
  }
}

/// Opens a folder in the browser, and a file where the app will open it.
struct OpenLink<Label: View>: View {
  let file: any FileItem
  @ViewBuilder let label: Label

  var body: some View {
    if file.kind == .folder {
      NavigationLink(value: Place.Folder(id: file.id, title: file.title)) { label }
    } else {
      NavigationLink {
        NotYet(title: file.title, systemImage: file.kind.systemImage, feature: "Files open")
      } label: {
        label
      }
    }
  }
}

/// A file's picture in the screen's appearance, or its icon when it has none.
struct ThumbnailView: View {
  let url: URL?
  let kind: Entry.Kind

  var body: some View {
    ZStack {
      Rectangle().fill(.fill.tertiary)
      if let url {
        AsyncImage(url: url) { phase in
          if let image = phase.image {
            image.resizable().scaledToFill()
          } else {
            icon
          }
        }
      } else {
        icon
      }
    }
    .frame(width: 44, height: 44, alignment: .topLeading)
    .clipShape(.rect(cornerRadius: 8))
    .accessibilityHidden(true)
  }

  private var icon: some View {
    Image(systemName: kind.systemImage).foregroundStyle(.secondary)
  }
}

/// Where opening a file will go, said rather than left a dead end.
struct NotYet: View {
  let title: String
  let systemImage: String
  /// What doesn't work yet, as in "Files open".
  let feature: String

  var body: some View {
    ContentUnavailableView(
      title, systemImage: systemImage, description: Text("\(feature) in a later version of the app."))
  }
}

/// What a screen loads: not yet, what came, or why nothing did.
enum Loaded<Value> {
  case loading
  case loaded(Value)
  case failed(String)

  var value: Value? {
    if case .loaded(let value) = self { value } else { nil }
  }

  /// What `fetch` gave, or why it failed; nil when the task was cancelled,
  /// as it is when a newer load takes over, so what is shown stays.
  @MainActor static func from(_ fetch: () async throws -> Value) async -> Loaded? {
    do {
      return .loaded(try await fetch())
    } catch is CancellationError {
      return nil
    } catch {
      return .failed(error.localizedDescription)
    }
  }
}

extension View {
  /// Stands over a list while it loads, when it couldn't, and when it has
  /// nothing in it. `what` finishes "Couldn’t load".
  func overlay<Value, Empty: View>(
    for loaded: Loaded<Value>,
    what: String,
    retry: @escaping () async -> Void,
    isEmpty: @escaping (Value) -> Bool = { _ in false },
    @ViewBuilder empty: () -> Empty = { EmptyView() }
  ) -> some View {
    overlay {
      switch loaded {
      case .loading:
        ProgressView()
      case .failed(let message):
        ContentUnavailableView {
          Label("Couldn’t load \(what)", systemImage: "wifi.exclamationmark")
        } description: {
          Text(message)
        } actions: {
          Button("Try Again") { Task { await retry() } }
        }
      case .loaded(let value) where isEmpty(value):
        empty()
      case .loaded:
        EmptyView()
      }
    }
  }
}

extension Entry.Kind {
  var systemImage: String {
    switch self {
    case .folder: "folder"
    case .document: "doc.text"
    case .drawing: "scribble.variable"
    case .url: "link"
    }
  }
}
