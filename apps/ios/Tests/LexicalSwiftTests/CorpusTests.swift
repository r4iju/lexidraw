import Foundation
import LexicalFuzz
import LexicalSwift
import Testing

/// The maintainer's real documents, pulled through the REST API and never
/// written anywhere. Failures name documents by id and properties by path, so
/// a log shows no content.
@Suite(.enabled(if: Corpus.token != nil, "LEXIDRAW_TOKEN isn't set; `bun run test:corpus` reads the CLI's"))
struct CorpusTests {
  @Test func everyDocumentSavesAsLexicalSavesIt() async throws {
    let documents = try await Corpus(token: Corpus.token!).documents()
    let reference = try Support.referenceEditor()
    var failures: [String] = []

    for (id, state) in documents {
      do {
        let fixture = try Fixture.record(start: state, commands: [], on: reference)
        let lexical = fixture.expected.state
        let lexicalSwift = try fixture.replay(on: Editor()).snapshot.state
        failures += Corpus.differences(lexicalSwift["root"]!, lexical["root"]!, at: "root").map { "\(id): \($0)" }

        try reference.load(lexicalSwift)
        if try reference.snapshot().state != lexical {
          failures.append("\(id): Lexical reads LexicalSwift's save as a different document")
        }
        let resaved = Editor()
        try resaved.load(lexical)
        if try resaved.snapshot().state != lexical {
          failures.append("\(id): LexicalSwift changes the document Lexical saved")
        }
      } catch {
        failures.append("\(id): \(error)")
      }
    }

    #expect(documents.count > 0)
    #expect(failures.isEmpty, "\(failures.count) of \(documents.count) documents:\n\(failures.joined(separator: "\n"))")
  }
}

struct Corpus {
  static let token = Support.environment("LEXIDRAW_TOKEN").flatMap { $0.isEmpty ? nil : $0 }

  let base: URL
  let token: String

  init(token: String) {
    self.token = token
    base = URL(string: Support.environment("LEXIDRAW_URL") ?? "https://lexidraw.vercel.app")!
      .appending(path: "api/v1")
  }

  /// Every document the token's account owns, archived ones included, by id.
  func documents() async throws -> [(String, JSONValue)] {
    var documents: [(String, JSONValue)] = []
    var folders: [String?] = [nil]
    while let folder = folders.popLast() {
      var query = [
        URLQueryItem(name: "includeArchived", value: "true"),
        URLQueryItem(name: "entityTypes", value: "document,directory"),
      ]
      if let folder { query.append(URLQueryItem(name: "parentId", value: folder)) }
      for entity in try await get("entities", query).arrayValue ?? [] {
        guard let id = entity["id"]?.stringValue else { continue }
        if entity["entityType"]?.stringValue == "directory" {
          folders.append(id)
        } else {
          let elements = try await get("entities/\(id)", [])["elements"]?.stringValue ?? ""
          documents.append((id, try JSONDecoder().decode(JSONValue.self, from: Data(elements.utf8))))
        }
      }
    }
    return documents.sorted { $0.0 < $1.0 }
  }

  private func get(_ path: String, _ query: [URLQueryItem]) async throws -> JSONValue {
    var request = URLRequest(url: base.appending(path: path).appending(queryItems: query))
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else {
      throw SupportError("GET \(path) answered \((response as? HTTPURLResponse)?.statusCode ?? 0)")
    }
    return try JSONDecoder().decode(JSONValue.self, from: data)
  }

  /// Where LexicalSwift's save differs from Lexical's. A node LexicalSwift
  /// keeps opaque writes back what it read, and a known node keeps the
  /// properties its schema doesn't declare, where Lexical applies the custom
  /// node's own defaults and drops what it doesn't know.
  static func differences(_ lexicalSwift: JSONValue, _ lexical: JSONValue, at path: String) -> [String] {
    guard case .object(let ours) = lexicalSwift, case .object(let theirs) = lexical else {
      return lexicalSwift == lexical ? [] : ["\(path) isn't a node in both"]
    }
    guard ours["type"] == theirs["type"] else {
      return ["\(path) is a \(ours["type"]?.stringValue ?? "?") node, not \(theirs["type"]?.stringValue ?? "?")"]
    }
    var found: [String] = []
    if let payload = SerializedNode(json: lexicalSwift).payload {
      for key in Set(ours.keys).union(theirs.keys) where key != "children" && ours[key] != theirs[key] {
        if theirs[key] == nil, payload.unknownFields[key] != nil { continue }
        found.append("\(path).\(key) differs")
      }
    }
    let ourChildren = ours["children"]?.arrayValue ?? []
    let theirChildren = theirs["children"]?.arrayValue ?? []
    guard ourChildren.count == theirChildren.count else {
      return found + ["\(path) has \(ourChildren.count) children, not \(theirChildren.count)"]
    }
    for (index, (mine, other)) in zip(ourChildren, theirChildren).enumerated() {
      found += differences(mine, other, at: "\(path).\(index)(\(other["type"]?.stringValue ?? "?"))")
    }
    return found
  }
}
