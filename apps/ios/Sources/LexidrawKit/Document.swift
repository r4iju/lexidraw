import Foundation
import LexidrawJSON

/// A document as the server stores it: the Lexical editor state, kept as the
/// JSON it came as.
public struct StoredDocument: Sendable {
  public let id: String
  public let title: String
  public let access: Access
  /// The serialized editor state, `{"root": …}`.
  public let state: JSONValue
  /// Kept verbatim so settings introduced by another editor survive copies.
  public let appState: JSONValue?
  public let updatedAt: Date
}

/// Another editor has saved since this document was read.
public struct DocumentConflict: Error, Sendable {}

extension Session {
  func saveCopiedDocument(_ id: String, state: JSONValue, appState: JSONValue?, readAt: Date)
    async throws -> Date
  {
    try await ask {
      try await $0.entitiesSave(
        path: .init(id: id),
        body: .json(
          .init(
            elements: state.stringified, appState: appState?.stringified, ifUnmodifiedSince: readAt)
        ))
    }.ok.body.json.updatedAt
  }

  public func save(document id: String, state: JSONValue, ifUnmodifiedSince: Date) async throws
    -> Date
  {
    do {
      return try await ask {
        try await $0.entitiesSave(
          path: .init(id: id),
          body: .json(.init(elements: state.stringified, ifUnmodifiedSince: ifUnmodifiedSince)))
      }.ok.body.json.updatedAt
    } catch let refusal as Refusal where refusal.status == 409 {
      throw DocumentConflict()
    }
  }

  public func document(_ id: String) async throws -> StoredDocument {
    let entity = try await ask { try await $0.entitiesLoad(path: .init(id: id)) }.ok.body.json
    return StoredDocument(
      id: entity.id, title: entity.title, access: entity.access,
      state: try JSONValue(parsing: entity.elements),
      appState: try entity.appState.map { try JSONValue(parsing: $0) }, updatedAt: entity.updatedAt)
  }
}
