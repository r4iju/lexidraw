import Foundation
import HTTPTypes

extension Entry.Kind {
  /// What the New menu makes, each starting empty. A link can't: its
  /// address is what it holds.
  public static let blank: [Entry.Kind] = [.document, .drawing, .folder]
}

/// Something done to a file, offered by the least access it takes, as the
/// server decides it.
public enum FileAction: Sendable {
  case rename, move, delete

  var needs: Access {
    switch self {
    case .rename, .move: .edit
    case .delete: .owner
    }
  }
}

extension Access {
  public func may(_ action: FileAction) -> Bool { self >= action.needs }
}

extension Entry {
  /// Whether the server takes this file into `folder`, or to the top of Home
  /// when it is nil. Moving someone else's file into a folder also needs its
  /// owner to be able to edit there, which the caller cannot see, so only an
  /// owner is offered a folder.
  public func mayMove(into folder: Entry?) -> Bool {
    guard access.may(.move) else { return false }
    guard let folder else { return true }
    return folder.id != id && access == .owner && folder.access >= .edit
  }
}

/// What someone types to confirm deleting their account: its email, or its
/// name when it has none.
public struct DeletionConfirmation: Sendable, Equatable {
  public let expected: String

  public init(expected: String) {
    self.expected = expected
  }

  public func isConfirmed(by typed: String) -> Bool {
    let expected = normalized(self.expected)
    return !expected.isEmpty && normalized(typed) == expected
  }

  private func normalized(_ text: String) -> String {
    text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  }
}

/// Where a restored file went.
public enum Restored: Sendable, Equatable {
  case itsFolder
  /// Its folder is gone, or its owner may no longer write there.
  case home
}

extension Session {
  /// Makes an empty file or folder in `folder`, or at the top of Home, titled
  /// as the server titles a new one.
  public func create(_ kind: Entry.Kind, in folder: String?) async throws -> Entry {
    try await create(kind, title: nil, in: folder)
  }

  /// Nil `title` and content are left for the server to title and start
  /// empty. A document's content may be `markdown`, which the server reads
  /// as it reads a document's markdown written later.
  func create(
    _ kind: Entry.Kind, title: String?, elements: String? = nil, markdown: String? = nil, in folder: String?
  ) async throws -> Entry {
    let type: Operations.EntitiesCreate.Input.Body.JsonPayload.EntityTypePayload =
      switch kind {
      case .folder: .directory
      case .document: .document
      case .drawing: .drawing
      case .url: .url
      }
    let body = Operations.EntitiesCreate.Input.Body.JsonPayload(
      id: UUID().uuidString.lowercased(), entityType: type, title: title, elements: elements, parentId: folder,
      markdown: markdown)
    let made = try await ask { try await $0.entitiesCreate(body: .json(body)) }.ok.body.json
    return Entry(
      id: made.id, title: made.title, kind: Entry.Kind(made.entityType), updatedAt: made.updatedAt,
      access: .owner, parentId: made.parentId, tags: [], folderCount: 0, pictures: Pictures(light: "", dark: ""))
  }

  public func rename(_ id: String, to title: String) async throws {
    _ = try await ask { try await $0.entitiesUpdate(path: .init(id: id), body: .json(.init(title: title))) }.ok
  }

  /// Into `folder`, or to the top of Home when it is nil. Sent by hand: the
  /// generated client leaves a nil out of the body, where Home must be sent
  /// as null.
  public func move(_ id: String, to folder: String?) async throws {
    let segment = id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(["/"])) ?? id
    try await connection.send(
      HTTPRequest(method: .patch, scheme: nil, authority: nil, path: "/entities/\(segment)"),
      json: try JSONSerialization.data(withJSONObject: ["parentId": folder.map { $0 as Any } ?? NSNull()]),
      operationID: Operations.EntitiesUpdate.id)
  }

  public func moveToTrash(_ id: String) async throws {
    _ = try await ask { try await $0.entitiesDelete(path: .init(id: id)) }.ok
  }

  public func restore(_ id: String) async throws -> Restored {
    try await ask { try await $0.entitiesRestore(path: .init(id: id)) }.ok.body.json.parentId == nil ? .home : .itsFolder
  }

  /// What to type to confirm deleting the account, as the server will check it.
  public func deletionConfirmation() async throws -> DeletionConfirmation {
    DeletionConfirmation(expected: try await ask { try await $0.authDeletionConfirmation() }.ok.body.json.confirmation)
  }

  /// Deletes the account for good. The token went with it, so the app is
  /// signed out even when this device won't let go of it.
  public func deleteAccount(confirmation: String) async throws {
    _ = try await ask { try await $0.authDeleteAccount(body: .json(.init(confirmation: confirmation))) }.ok
    try? store.delete()
  }
}
