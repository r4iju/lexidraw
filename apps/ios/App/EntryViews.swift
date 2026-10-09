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
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    HStack(spacing: 12) {
      if !typeSize.isAccessibilitySize {
        ThumbnailView(url: file.thumbnail(dark: colorScheme == .dark), kind: file.kind)
      }
      VStack(alignment: .leading, spacing: 5) {
        Text(file.title)
          .font(.body.weight(.medium))
          .foregroundStyle(.primary)
          .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
          .fixedSize(horizontal: false, vertical: true)
        Text(file.kind.label)
          .font(.caption.weight(.semibold))
          .foregroundStyle(.primary)
        Text(caption)
          .font(.caption)
          .foregroundStyle(.primary)
          .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
      }
    }
    .multilineTextAlignment(.leading)
    .padding(.vertical, 6)
  }
}

extension FileRow {
  /// When it last changed, and the caller's own tags on it.
  init(entry: Entry) {
    let changed = "Updated \(entry.updatedAt.formatted(.relative(presentation: .named)))"
    let access: String = switch entry.access {
    case .owner: ""
    case .edit: "Can edit · "
    case .read: "Read only · "
    }
    let folders = entry.kind == .folder && entry.folderCount > 0
      ? "\(entry.folderCount) \(entry.folderCount == 1 ? "folder" : "folders") · " : ""
    self.init(
      file: entry, caption: access + folders + (entry.tags.isEmpty ? changed : "\(changed) · \(entry.tags.joined(separator: ", "))"))
  }
}

extension EnvironmentValues {
  /// The signed-in session, for screens a list opens.
  @Entry var session: Session?
}

/// Immutable navigation identity, independent of listing refreshes.
struct FileReference: FileItem {
  let id: String
  let title: String
  let kind: Entry.Kind
  let lightThumbnail: URL?
  let darkThumbnail: URL?

  init(_ file: any FileItem) {
    id = file.id
    title = file.title
    kind = file.kind
    lightThumbnail = file.thumbnail(dark: false)
    darkThumbnail = file.thumbnail(dark: true)
  }
  func thumbnail(dark: Bool) -> URL? { dark ? darkThumbnail : lightThumbnail }
}

extension EnvironmentValues {
  @Entry var openFile: ((any FileItem) -> Void)?
}

/// Opens a folder in the browser, and a file where the app will open it.
struct OpenLink<Label: View>: View {
  let file: any FileItem
  @ViewBuilder let label: Label
  @Environment(\.openFile) private var openFile
  var body: some View {
    if file.kind == .folder {
      NavigationLink(value: Browser.Route.folder(Place.Folder(id: file.id, title: file.title))) { label }
    } else if let openFile {
      Button { openFile(file) } label: { label }
        .buttonStyle(.borderless)
        .tint(.primary)
        .accessibilityHint("Opens this file beside the listing")
    } else {
      NavigationLink { FileDestination(file: file) } label: { label }
    }
  }

}

/// The same file screen whether reached from a listing or a retained search route.
struct FileDestination: View {
  let file: any FileItem
  @Environment(\.session) private var session

  @ViewBuilder var body: some View {
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
      RoundedRectangle(cornerRadius: 12).fill(kind.accent.opacity(0.09))
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
    .frame(width: 56, height: 64)
    .clipShape(.rect(cornerRadius: 12))
    .accessibilityHidden(true)
  }

  private var icon: some View {
    Image(systemName: kind.systemImage)
      .font(.system(size: 25, weight: .regular))
      .foregroundStyle(kind.accent)
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
  var accent: Color {
    switch self {
    case .folder: .blue
    case .document: .indigo
    case .drawing: .purple
    case .url: .teal
    }
  }

  var systemImage: String {
    switch self {
    case .folder: "folder"
    case .document: "doc.text"
    case .drawing: "scribble.variable"
    case .url: "link"
    }
  }
}
