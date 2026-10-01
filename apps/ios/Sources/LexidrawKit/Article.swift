import Foundation
import LexidrawJSON

extension Session {
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
