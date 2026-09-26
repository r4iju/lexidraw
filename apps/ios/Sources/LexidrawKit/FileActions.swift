import Foundation

/// What the server said when it would not do something, in its own words.
public struct Refusal: Error, LocalizedError, Sendable {
  public let message: String

  init(_ answer: Components.Schemas.ErrorResponse) {
    message = answer.message
  }

  init(status: Int) {
    message = "The server answered \(status)."
  }

  public var errorDescription: String? { message }
}

/// What the New menu makes, each titled as the web titles a new one.
public enum NewFile: CaseIterable, Sendable {
  case document, drawing, folder

  public var title: String {
    switch self {
    case .document: "New document"
    case .drawing: "New drawing"
    case .folder: "New folder"
    }
  }

  public var kind: Entry.Kind {
    switch self {
    case .document: .document
    case .drawing: .drawing
    case .folder: .folder
    }
  }
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
  /// owner to be able to write there, which the caller cannot see, so only an
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
  /// Makes an empty file or folder in `folder`, or at the top of Home.
  public func create(_ file: NewFile, in folder: String?) async throws -> Entry {
    let type: Operations.EntitiesCreate.Input.Body.JsonPayload.EntityTypePayload =
      switch file {
      case .document: .document
      case .drawing: .drawing
      case .folder: .directory
      }
    let body = Operations.EntitiesCreate.Input.Body.JsonPayload(
      id: UUID().uuidString.lowercased(), title: file.title, entityType: type, parentId: folder)
    switch try await client.entitiesCreate(body: .json(body)) {
    case .ok(let answer):
      let made = try answer.body.json
      return Entry(
        id: made.id, title: made.title, kind: Entry.Kind(made.entityType), updatedAt: made.updatedAt,
        access: .owner, parentId: made.parentId, tags: [], itemCount: 0, pictures: Pictures(light: "", dark: ""))
    case .badRequest(let answer): throw Refusal(try answer.body.json)
    case .unauthorized(let answer): throw Refusal(try answer.body.json)
    case .forbidden(let answer): throw Refusal(try answer.body.json)
    case .notFound(let answer): throw Refusal(try answer.body.json)
    case .conflict(let answer): throw Refusal(try answer.body.json)
    case .internalServerError(let answer): throw Refusal(try answer.body.json)
    case .undocumented(let status, _): throw Refusal(status: status)
    }
  }

  public func rename(_ id: String, to title: String) async throws {
    switch try await client.entitiesUpdate(path: .init(id: id), body: .json(.init(title: title))) {
    case .ok: return
    case .badRequest(let answer): throw Refusal(try answer.body.json)
    case .unauthorized(let answer): throw Refusal(try answer.body.json)
    case .forbidden(let answer): throw Refusal(try answer.body.json)
    case .notFound(let answer): throw Refusal(try answer.body.json)
    case .internalServerError(let answer): throw Refusal(try answer.body.json)
    case .undocumented(let status, _): throw Refusal(status: status)
    }
  }

  /// Into `folder`, or to the top of Home when it is nil.
  public func move(_ id: String, to folder: String?) async throws {
    switch try await client.entitiesMove(path: .init(id: id), body: .json(.init(parentId: folder))) {
    case .ok: return
    case .badRequest(let answer): throw Refusal(try answer.body.json)
    case .unauthorized(let answer): throw Refusal(try answer.body.json)
    case .forbidden(let answer): throw Refusal(try answer.body.json)
    case .notFound(let answer): throw Refusal(try answer.body.json)
    case .internalServerError(let answer): throw Refusal(try answer.body.json)
    case .undocumented(let status, _): throw Refusal(status: status)
    }
  }

  public func moveToTrash(_ id: String) async throws {
    switch try await client.entitiesDelete(path: .init(id: id)) {
    case .ok: return
    case .badRequest(let answer): throw Refusal(try answer.body.json)
    case .unauthorized(let answer): throw Refusal(try answer.body.json)
    case .forbidden(let answer): throw Refusal(try answer.body.json)
    case .notFound(let answer): throw Refusal(try answer.body.json)
    case .internalServerError(let answer): throw Refusal(try answer.body.json)
    case .undocumented(let status, _): throw Refusal(status: status)
    }
  }

  public func restore(_ id: String) async throws -> Restored {
    switch try await client.entitiesRestore(path: .init(id: id)) {
    case .ok(let answer): return try answer.body.json.parentId == nil ? .home : .itsFolder
    case .badRequest(let answer): throw Refusal(try answer.body.json)
    case .unauthorized(let answer): throw Refusal(try answer.body.json)
    case .forbidden(let answer): throw Refusal(try answer.body.json)
    case .notFound(let answer): throw Refusal(try answer.body.json)
    case .internalServerError(let answer): throw Refusal(try answer.body.json)
    case .undocumented(let status, _): throw Refusal(status: status)
    }
  }

  /// What to type to confirm deleting the account, as the server will check it.
  public func deletionConfirmation() async throws -> DeletionConfirmation {
    DeletionConfirmation(expected: try await client.authMe().ok.body.json.deletionConfirmation)
  }

  /// Deletes the account for good, and with it this app's token.
  public func deleteAccount(confirmation: String) async throws {
    switch try await client.authDeleteAccount(body: .json(.init(confirmation: confirmation))) {
    case .ok: try store.delete()
    case .badRequest(let answer): throw Refusal(try answer.body.json)
    case .unauthorized(let answer): throw Refusal(try answer.body.json)
    case .forbidden(let answer): throw Refusal(try answer.body.json)
    case .internalServerError(let answer): throw Refusal(try answer.body.json)
    case .undocumented(let status, _): throw Refusal(status: status)
    }
  }
}
