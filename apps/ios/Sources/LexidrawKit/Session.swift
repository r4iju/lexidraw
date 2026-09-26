import Foundation

/// What a signed-in app can do. Only an ``Account`` makes one, from a token it
/// holds.
public struct Session: Sendable {
  /// Where the web is, for addresses that open a file in it.
  let origin: URL
  let connection: Connection
  let store: any TokenStore

  /// Asks the server through the generated client; an answer that isn't a
  /// success comes back as the ``Refusal`` it is.
  func ask<T>(_ call: (Client) async throws -> T) async throws -> T {
    try await unwrapped { try await call(connection.client) }
  }

  /// What is in a folder, or at the top of Home when `folder` is nil, with
  /// the web's default sort. Only what carries every one of `tags` when there
  /// are any.
  public func listing(of folder: String?, taggedWith tags: [String] = []) async throws -> Listing {
    Listing(try await entries(in: folder, tags: tags, types: nil))
  }

  /// The folders directly in a folder, or at the top of Home.
  public func folders(in folder: String?) async throws -> [Entry] {
    try await entries(in: folder, tags: [], types: [.directory])
  }

  private func entries(
    in folder: String?,
    tags: [String],
    types: Operations.EntitiesList.Input.Query.EntityTypesPayload.Value1Payload?
  ) async throws -> [Entry] {
    let listing = try await ask {
      try await $0.entitiesList(
        query: .init(
          parentId: folder,
          tagNames: tags.isEmpty ? nil : .init(value1: tags),
          sortBy: .updatedAt,
          sortOrder: .desc,
          entityTypes: types.map { .init(value1: $0) }
        ))
    }
    return try listing.ok.body.json.map(Entry.init)
  }

  public func place(of folder: String) async throws -> Place {
    let place = try await ask { try await $0.entitiesGetMetadata(path: .init(id: folder)) }.ok.body.json
    return Place(
      id: place.id,
      title: place.title,
      access: Access(place.access),
      ancestors: place.ancestors.map { Place.Folder(id: $0.id, title: $0.title) }
    )
  }

  public func search(_ query: String) async throws -> [SearchResult] {
    try await ask { try await $0.entitiesSearch(query: .init(query: query)) }.ok.body.json.map { hit in
      SearchResult(
        id: hit.id,
        title: hit.title,
        kind: Entry.Kind(hit.entityType),
        updatedAt: hit.updatedAt,
        folder: hit.parentId.flatMap { id in hit.folderTitle.map { Place.Folder(id: id, title: $0) } },
        pictures: Pictures(light: hit.screenShotLight, dark: hit.screenShotDark)
      )
    }
  }

  /// The caller's own tags, the ones a filter can find something by.
  public func tags() async throws -> [String] {
    try await ask { try await $0.entitiesGetUserTags() }.ok.body.json
  }

  /// What others shared with the caller, wherever they keep it.
  public func sharedWithMe() async throws -> [Entry] {
    try await ask { try await $0.entitiesSharedWithMe() }.ok.body.json.map(Entry.init)
  }

  /// The caller's own files in the trash, last in first.
  public func trash() async throws -> [TrashedEntry] {
    try await ask { try await $0.entitiesTrash() }.ok.body.json.map { item in
      TrashedEntry(
        id: item.id,
        title: item.title,
        kind: Entry.Kind(item.entityType),
        deletedAt: item.deletedAt,
        pictures: Pictures(light: item.screenShotLight, dark: item.screenShotDark)
      )
    }
  }

  public enum SignOut: Sendable, Equatable {
    case revoked
    /// The token is gone from this device, but the server may still take it
    /// until it is revoked in Settings on the web.
    case stillValidOnServer
  }

  /// Revokes the token on the server, then forgets it here whatever the
  /// server said, so a failed request never leaves the app signed in.
  public func signOut() async throws -> SignOut {
    let outcome: SignOut
    do {
      _ = try await ask { try await $0.tokensRevokeCurrent(body: .json(.init())) }.ok
      outcome = .revoked
    } catch let refusal as Refusal where [401, 404].contains(refusal.status) {
      // A token the server no longer takes, or no longer has, is revoked already.
      outcome = .revoked
    } catch {
      outcome = .stillValidOnServer
    }
    try store.delete()
    return outcome
  }
}
