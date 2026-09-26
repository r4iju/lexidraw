import Foundation

/// What the caller may do with something they can reach, least first, as the
/// server decides it.
public enum Access: Int, Sendable, Hashable, Comparable {
  case read, edit, owner

  public static func < (lhs: Access, rhs: Access) -> Bool { lhs.rawValue < rhs.rawValue }
}

/// A file or folder as a listing shows it.
public struct Entry: Sendable, Hashable, Identifiable {
  public enum Kind: Sendable, Hashable {
    case folder, document, drawing, url
  }

  public let id: String
  public let title: String
  public let kind: Kind
  public let updatedAt: Date
  public let access: Access
  /// The caller's own tags on it; nobody else's are ever sent.
  public let tags: [String]
  /// How many things directly inside a folder the caller can see.
  public let itemCount: Int
  let pictures: Pictures

  /// The picture for a screen in dark or light appearance, if the file has
  /// one for it.
  public func thumbnail(dark: Bool) -> URL? { pictures.url(dark: dark) }
}

extension Entry {
  /// Listings and Shared with me send the same row.
  init(_ item: Operations.EntitiesList.Output.Ok.Body.JsonPayloadPayload) {
    self.init(
      id: item.id, title: item.title, kind: Kind(item.entityType), updatedAt: item.updatedAt,
      access: Access(item.access), tags: item.tags, itemCount: Int(item.childCount),
      pictures: Pictures(light: item.screenShotLight, dark: item.screenShotDark))
  }

  init(_ item: Operations.EntitiesSharedWithMe.Output.Ok.Body.JsonPayloadPayload) {
    self.init(
      id: item.id, title: item.title, kind: Kind(item.entityType), updatedAt: item.updatedAt,
      access: Access(item.access), tags: item.tags, itemCount: Int(item.childCount),
      pictures: Pictures(light: item.screenShotLight, dark: item.screenShotDark))
  }
}

/// A file's thumbnail in each theme. The server sends "" for a theme that has
/// none.
struct Pictures: Sendable, Hashable {
  let light: URL?
  let dark: URL?

  init(light: String, dark: String) {
    self.light = light.isEmpty ? nil : URL(string: light)
    self.dark = dark.isEmpty ? nil : URL(string: dark)
  }

  func url(dark: Bool) -> URL? { dark ? self.dark : light }
}

/// A folder's contents, or Home's: the folders as their own group above the
/// files, each group in the order the server listed it.
public struct Listing: Sendable, Equatable {
  public let folders: [Entry]
  public let files: [Entry]

  init(_ entries: [Entry]) {
    folders = entries.filter { $0.kind == .folder }
    files = entries.filter { $0.kind != .folder }
  }
}

/// Where a folder is: its own title and the caller's access, and the folders
/// above it that the caller may open, from the top down.
public struct Place: Sendable, Equatable {
  public struct Folder: Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String

    public init(id: String, title: String) {
      self.id = id
      self.title = title
    }
  }

  public let id: String
  public let title: String
  public let access: Access
  public let ancestors: [Folder]
}

public struct SearchResult: Sendable, Hashable, Identifiable {
  public let id: String
  public let title: String
  public let kind: Entry.Kind
  public let updatedAt: Date
  /// The folder it is in, when the caller may open that folder.
  public let folder: Place.Folder?
  let pictures: Pictures

  public func thumbnail(dark: Bool) -> URL? { pictures.url(dark: dark) }

  /// What it is and where, as the web's search says it: a folder the caller
  /// can't open reads as Home.
  public var location: String {
    "\(kind.label) in \(folder?.title ?? "Home")"
  }
}

public struct TrashedEntry: Sendable, Hashable, Identifiable {
  public let id: String
  public let title: String
  public let kind: Entry.Kind
  public let deletedAt: Date
  let pictures: Pictures

  public func thumbnail(dark: Bool) -> URL? { pictures.url(dark: dark) }
}

extension Entry.Kind {
  /// What people call it; "directory" and "url" are the server's words.
  public var label: String {
    switch self {
    case .folder: "Folder"
    case .document: "Document"
    case .drawing: "Drawing"
    case .url: "Link"
    }
  }

  init(_ type: some RawRepresentable<String>) {
    switch type.rawValue {
    case "directory": self = .folder
    case "document": self = .document
    case "drawing": self = .drawing
    default: self = .url
    }
  }
}

extension Access {
  init(_ access: some RawRepresentable<String>) {
    switch access.rawValue {
    case "owner": self = .owner
    case "edit": self = .edit
    default: self = .read
    }
  }
}
