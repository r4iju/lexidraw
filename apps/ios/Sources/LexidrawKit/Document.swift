import LexidrawJSON

/// A document as the server stores it: the Lexical editor state, kept as the
/// JSON it came as.
public struct StoredDocument: Sendable {
  public let title: String
  public let access: Access
  /// The serialized editor state, `{"root": …}`.
  public let state: JSONValue
}

extension Session {
  public func document(_ id: String) async throws -> StoredDocument {
    let entity = try await ask { try await $0.entitiesLoad(path: .init(id: id)) }.ok.body.json
    return StoredDocument(
      title: entity.title, access: entity.accessLevel == .edit ? .edit : .read,
      state: try JSONValue(parsing: entity.elements))
  }
}
