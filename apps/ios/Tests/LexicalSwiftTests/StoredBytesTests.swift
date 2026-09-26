import Foundation
import LexicalSwift
import Testing

/// The web's saves of stored nodes, as stored and odd (`stored-bytes.json` in
/// @packages/lexical-nodes). LexicalSwift has no key order, keeps what it
/// doesn't declare and leaves absent what was absent, so it doesn't write the
/// web's bytes. What it guarantees, property by property down through the
/// objects and arrays both write:
/// - where both write a property, they write the same value;
/// - where only LexicalSwift writes one, it's the value that was stored;
/// - where only the web writes one, nothing was stored there.
///
/// Two things the web writes are the editor's, not the node's, so they're
/// held to the node's own JSON instead:
/// - an inline node stored at the root is loaded into a paragraph, so the
///   web writes that paragraph around it;
/// - on load, the reconciler copies a paragraph's first text's format and
///   style onto the paragraph, so the web writes those as its `textFormat`
///   and `textStyle`.
@Suite struct StoredBytesTests {
  struct StoredCase: Decodable, CustomTestStringConvertible, Sendable {
    let name: String
    let node: JSONValue
    let output: [JSONValue]?
    let threw: Bool?

    var testDescription: String { name }
  }

  static let cases = try! JSONDecoder().decode(
    [StoredCase].self, from: Data(contentsOf: Support.storedBytes))

  /// A node the web couldn't read at all is left out: there's nothing to
  /// agree with.
  @Test(arguments: cases.filter { $0.threw != true })
  func lexicalSwiftAgreesWithWhatTheWebWrites(_ stored: StoredCase) {
    let swift = SerializedNode(json: stored.node).json
    let found = disagreements(
      swift: .array([swift]), web: .array(stored.output.map { unwrapped($0, stored.node) } ?? [stored.node]),
      stored: .array([stored.node]))

    #expect(found.isEmpty, "\(found.joined(separator: "; "))")
  }

  @Test func theCasesAreThere() {
    #expect(Self.cases.count > 4000)
  }
}

/// The web's output with the paragraph it put an inline `stored` node in
/// taken off.
private func unwrapped(_ output: [JSONValue], _ stored: JSONValue) -> [JSONValue] {
  guard stored["type"] != "paragraph", output.count == 1, output[0]["type"] == "paragraph",
    let children = output[0]["children"]?.arrayValue, children.count == 1, children[0]["type"] == stored["type"]
  else { return output }
  return children
}

/// Whether the web wrote `key` of `web` as the reconciler copies it from the
/// element's first text.
private func copiedFromFirstText(_ key: String, of web: [String: JSONValue]) -> Bool {
  let copied = ["textFormat": "format", "textStyle": "style"]
  guard let from = copied[key], let first = web["children"]?.arrayValue?.first, first["text"] != nil
  else { return false }
  return web[key] == first[from]
}

/// Where `swift` and `web` break the guarantee, by path.
private func disagreements(swift: JSONValue?, web: JSONValue?, stored: JSONValue?, at path: String = "")
  -> [String]
{
  switch (swift, web) {
  case (nil, nil):
    return []
  case (let swift?, nil):
    return swift == stored ? [] : ["\(path): only LexicalSwift writes \(swift), and \(stored.map { "\($0)" } ?? "nothing") was stored"]
  case (nil, _?):
    return stored == nil ? [] : ["\(path): only the web writes it, though it was stored"]
  case (.object(let swift)?, .object(let web)?):
    return Set(swift.keys).union(web.keys).sorted().flatMap { key in
      copiedFromFirstText(key, of: web) ? [] : disagreements(swift: swift[key], web: web[key], stored: stored?[key], at: "\(path).\(key)")
    }
  case (.array(let swift)?, .array(let web)?) where swift.count == web.count:
    let stored = stored?.arrayValue
    return swift.indices.flatMap { index in
      disagreements(
        swift: swift[index], web: web[index], stored: stored.flatMap { $0.indices.contains(index) ? $0[index] : nil },
        at: "\(path)[\(index)]")
    }
  case (let swift?, let web?):
    return swift == web ? [] : ["\(path): LexicalSwift writes \(swift), the web \(web)"]
  }
}
