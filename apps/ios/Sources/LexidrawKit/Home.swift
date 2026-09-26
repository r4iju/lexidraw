import Foundation

/// The top of the caller's files: the folders as their own group above
/// everything else, each group in the order the server listed it.
public struct Home: Sendable, Equatable {
  public struct Folder: Sendable, Hashable, Identifiable {
    public let id: String
    public let title: String
  }

  public struct File: Sendable, Hashable, Identifiable {
    public enum Kind: Sendable, Hashable {
      case document, drawing, url
    }

    public let id: String
    public let title: String
    public let kind: Kind
    public let updatedAt: Date
  }

  public let folders: [Folder]
  public let files: [File]

  init(listing: Operations.EntitiesList.Output.Ok.Body.JsonPayload) {
    var folders: [Folder] = []
    var files: [File] = []
    for item in listing {
      let kind: File.Kind
      switch item.entityType {
      case .directory:
        folders.append(Folder(id: item.id, title: item.title))
        continue
      case .document: kind = .document
      case .drawing: kind = .drawing
      case .url: kind = .url
      }
      files.append(File(id: item.id, title: item.title, kind: kind, updatedAt: item.updatedAt))
    }
    self.folders = folders
    self.files = files
  }
}
