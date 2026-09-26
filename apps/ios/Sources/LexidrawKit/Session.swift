import Foundation

/// What a signed-in app can do. Only an ``Account`` makes one, from a token it
/// holds.
public struct Session: Sendable {
  let client: Client
  let store: any TokenStore

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
    let listing = try await client.entitiesList(
      query: .init(
        parentId: folder,
        tagNames: tags.isEmpty ? nil : .init(value1: tags),
        sortBy: .updatedAt,
        sortOrder: .desc,
        entityTypes: types.map { .init(value1: $0) }
      ))
    return try listing.ok.body.json.map(Entry.init)
  }

  public func place(of folder: String) async throws -> Place {
    let place = try await client.entitiesGetMetadata(path: .init(id: folder)).ok.body.json
    return Place(
      id: place.id,
      title: place.title,
      access: Access(place.access),
      ancestors: place.ancestors.map { Place.Folder(id: $0.id, title: $0.title) }
    )
  }

  public func search(_ query: String) async throws -> [SearchResult] {
    try await client.entitiesSearch(query: .init(query: query)).ok.body.json.map { hit in
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
    try await client.entitiesGetUserTags().ok.body.json
  }

  /// What others shared with the caller, wherever they keep it.
  public func sharedWithMe() async throws -> [Entry] {
    try await client.entitiesSharedWithMe().ok.body.json.map(Entry.init)
  }

  /// The caller's own files in the trash, last in first.
  public func trash() async throws -> [TrashedEntry] {
    try await client.entitiesTrash().ok.body.json.map { item in
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
      switch try await client.tokensRevokeCurrent(body: .json(.init())) {
      // A token the server no longer takes, or no longer has, is revoked already.
      case .ok, .unauthorized, .notFound: outcome = .revoked
      default: outcome = .stillValidOnServer
      }
    } catch {
      outcome = .stillValidOnServer
    }
    try store.delete()
    return outcome
  }
}
