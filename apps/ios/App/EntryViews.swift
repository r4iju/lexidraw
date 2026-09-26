import LexidrawKit
import SwiftUI

/// A file in a list: its picture, title, when it last changed, and the
/// caller's own tags on it.
struct EntryRow: View {
  let entry: Entry
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    HStack(spacing: 12) {
      ThumbnailView(url: entry.thumbnail(dark: colorScheme == .dark), kind: entry.kind)
      VStack(alignment: .leading, spacing: 2) {
        Text(entry.title).lineLimit(1)
        Text(detail)
          .font(.caption)
          .foregroundStyle(.secondary)
          .lineLimit(1)
      }
    }
  }

  private var detail: String {
    let changed = entry.updatedAt.formatted(.relative(presentation: .named))
    return entry.tags.isEmpty ? changed : "\(changed) · \(entry.tags.joined(separator: ", "))"
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
