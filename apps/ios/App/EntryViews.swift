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

extension EnvironmentValues {
  /// The signed-in session, for screens a list opens.
  @Entry var session: Session?
}

/// Opens a folder in the browser, and a file where the app will open it.
struct OpenLink<Label: View>: View {
  let file: any FileItem
  @ViewBuilder let label: Label
  @Environment(\.session) private var session

  var body: some View {
    if file.kind == .folder {
      NavigationLink(value: Place.Folder(id: file.id, title: file.title)) { label }
    } else {
      NavigationLink { screen } label: { label }
    }
  }

  @ViewBuilder private var screen: some View {
    switch (file.kind, session) {
    case (.drawing, let session?): DrawingScreen(session: session, id: file.id, title: file.title)
    case (.document, let session?): DocumentScreen(session: session, id: file.id, title: file.title)
    case (.url, let session?): LinkScreen(session: session, file: file)
    default: NotYet(title: file.title, systemImage: file.kind.systemImage, feature: "Files open")
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
