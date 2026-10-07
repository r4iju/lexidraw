import Foundation
import LexidrawJSON

/// A saved link as its page shows it: where it points and the text kept from there.
public struct SavedLink: Sendable {
  public let title: String
  /// What was saved as the page's address, empty when none has been yet.
  public let address: String
  /// The page's sanitized text and its details, when it has been kept.
  public let distilled: JSONValue?
  /// Where the web shows this link, for what the app doesn't do itself.
  public let webPage: URL

  /// The page, when what was saved reads as an address.
  public var url: URL? { address.isEmpty ? nil : URL(string: address) }
}

extension Session {
  /// A saved link, read as the web's `parseLinkElements` reads it: a field
  /// that doesn't fit is absent rather than a failure.
  public func savedLink(_ id: String) async throws -> SavedLink {
    let entity = try await ask { try await $0.entitiesLoad(path: .init(id: id)) }.ok.body.json
    let elements = try? JSONValue(parsing: entity.elements)
    let distilled = elements?["distilled"]
    return SavedLink(
      title: entity.title,
      address: elements?["url"]?.stringValue ?? "",
      distilled: distilled?.objectValue == nil ? nil : distilled,
      webPage: origin.appending(path: "\(Entry.Kind.url.webPath)/\(entity.id)"))
  }

  public func savedArticles() async throws -> [Entry] {
    try await ask {
      try await $0.entitiesList(query: .init(sortBy: .updatedAt, sortOrder: .desc, includeArchived: .init(value1: false), onlyFavorites: .init(value1: false), entityTypes: .init(value1: [.url])))
    }.ok.body.json.map(Entry.init)
  }

  public func articleSnapshot(entityID: String) async throws -> JSONValue? {
    let entity = try await ask { try await $0.entitiesLoad(path: .init(id: entityID)) }.ok.body.json
    return (try? JSONValue(parsing: entity.elements))?["distilled"]
  }

  /// The same sanitized extraction used by the web article insertion and refresh controls.
  public func extractArticle(url: URL) async throws -> JSONValue {
    let result = try await ask {
      try await $0.articlesExtractFromUrl(body: .json(.init(url: url.absoluteString)))
    }.ok.body.json
    guard var fields = try JSONValue(parsing: String(decoding: JSONEncoder().encode(result), as: UTF8.self)).objectValue else {
      preconditionFailure("Generated article response is not an object")
    }
    // The generated encoder omits nil nullable fields; the web extraction
    // response includes these keys with null, which the stored node retains.
    fields["byline"] = result.byline.map(JSONValue.string) ?? .null
    fields["siteName"] = result.siteName.map(JSONValue.string) ?? .null
    fields["wordCount"] = result.wordCount.map(JSONValue.number) ?? .null
    fields["excerpt"] = result.excerpt.map(JSONValue.string) ?? .null
    fields["bestImageUrl"] = result.bestImageUrl.map(JSONValue.string) ?? .null
    fields["datePublished"] = result.datePublished.map(JSONValue.string) ?? .null
    return .object(fields)
  }
}
