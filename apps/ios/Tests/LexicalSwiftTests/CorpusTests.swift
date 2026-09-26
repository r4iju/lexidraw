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
        failures += Corpus.differences(lexicalSwift["root"]!, lexical["root"]!, loaded: state["root"]!).map { "\(id): \($0)" }

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

  /// Where LexicalSwift's save differs from Lexical's, apart from what #111
  /// asks LexicalSwift to keep and Lexical's own classes rewrite: "Unknown
  /// node types and unknown fields on known nodes survive load then save
  /// unchanged". A node LexicalSwift doesn't know has to save what was loaded.
  static func differences(_ lexicalSwift: JSONValue, _ lexical: JSONValue, loaded: JSONValue) -> [String] {
    // Loading wraps, merges and drops only nodes LexicalSwift knows, so the
    // others come in the same order.
    var unknownNodes = preorder(loaded).filter { SerializedNode(json: $0).payload == nil }.makeIterator()

    func differences(_ lexicalSwift: JSONValue, _ lexical: JSONValue, at path: String) -> [String] {
      guard case .object(let ours) = lexicalSwift, case .object(let theirs) = lexical, ours["type"] == theirs["type"]
      else { return ["\(path) is a \(lexicalSwift["type"]?.stringValue ?? "?") node, not \(lexical["type"]?.stringValue ?? "?")"] }
      var found: [String] = []
      if let payload = SerializedNode(json: lexicalSwift).payload {
        for key in Set(ours.keys).union(theirs.keys).sorted() where key != "children" && ours[key] != theirs[key] {
          if theirs[key] == nil, payload.unknownFields[key] != nil { continue }
          found.append("\(path).\(key) differs")
        }
      } else {
        guard case .object(let was) = unknownNodes.next(), was["type"] == ours["type"]
        else { return ["\(path) isn't the node loaded there"] }
        for key in Set(ours.keys).union(was.keys).sorted() where key != "children" && ours[key] != was[key] {
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
    return differences(lexicalSwift, lexical, at: "root")
  }

  private static func preorder(_ node: JSONValue) -> [JSONValue] {
    [node] + (node["children"]?.arrayValue ?? []).flatMap(preorder)
  }
}

@Suite struct CorpusComparisonTests {
  @Test func anOpaqueNodeSavesWhatWasLoadedWhateverLexicalSaves() {
    let asLoaded: JSONValue = ["type": "not-a-node-type", "version": 1, "size": 1]
    let asLexicalSaves: JSONValue = ["type": "not-a-node-type", "version": 1, "size": 2, "added": true]
    let loaded = root([asLoaded])

    #expect(Corpus.differences(root([paragraph([asLoaded])]), root([paragraph([asLexicalSaves])]), loaded: loaded) == [])
    #expect(
      Corpus.differences(root([paragraph([asLexicalSaves])]), root([paragraph([asLexicalSaves])]), loaded: loaded)
        == ["root.0(paragraph).0(not-a-node-type).added differs", "root.0(paragraph).0(not-a-node-type).size differs"])
  }

  private func root(_ children: [JSONValue]) -> JSONValue {
    ["type": "root", "version": 1, "direction": nil, "format": "", "indent": 0, "children": .array(children)]
  }

  private func paragraph(_ children: [JSONValue]) -> JSONValue {
    [
      "type": "paragraph", "version": 1, "direction": nil, "format": "", "indent": 0,
      "textFormat": 0, "textStyle": "", "children": .array(children),
    ]
  }
}
