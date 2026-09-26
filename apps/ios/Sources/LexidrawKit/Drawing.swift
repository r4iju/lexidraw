import Foundation
import LexidrawJSON

/// A drawing as the server stores it. The elements are kept as the JSON they
/// came as, so a save sends back what this app doesn't understand unchanged.
public struct StoredDrawing: Sendable {
  public let id: String
  public let title: String
  public let access: Access
  public let elements: [JSONValue]
  public let appState: JSONObject
  /// When it last changed, which a save sends back so the server can refuse
  /// it if someone saved in between.
  public let updatedAt: Date

  /// The colour the web draws it on.
  public var background: String { appState["viewBackgroundColor"]?.stringValue ?? "#ffffff" }
}

extension Session {
  public func drawing(_ id: String) async throws -> StoredDrawing {
    let entity = try await ask { try await $0.entitiesLoad(path: .init(id: id)) }.ok.body.json
    let elements =
      entity.elements.isEmpty ? [] : try JSONValue(parsing: entity.elements).arrayValue ?? []
    let appState = try entity.appState.map { try JSONValue(parsing: $0).objectValue }
    return StoredDrawing(
      id: entity.id, title: entity.title, access: entity.accessLevel == .edit ? .edit : .read,
      elements: elements, appState: (appState ?? nil) ?? [:], updatedAt: entity.updatedAt)
  }
}
