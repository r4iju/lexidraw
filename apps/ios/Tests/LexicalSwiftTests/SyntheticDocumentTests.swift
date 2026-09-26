import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct SyntheticDocumentTests {
  @Test(arguments: [SyntheticDocument.small, .large])
  func hasTheBenchmarksWordsAndNodes(_ document: SyntheticDocument) {
    let root = document.state["root"]
    #expect(root.map(Self.words) == document.words)
    #expect(root.map(Self.nodes) == document.nodes)
  }

  @Test(arguments: [SyntheticDocument.small, .large])
  func holdsTheBlocksLayoutIsDecidedOn(_ document: SyntheticDocument) {
    let types = Set(document.state["root"]?["children"]?.arrayValue?.compactMap { $0["type"]?.stringValue } ?? [])
    #expect(types.isSuperset(of: ["heading", "paragraph", "quote", "list", "table", "youtube"]))
  }

  /// Both models keep it exactly, so a measurement opens what Lexical would.
  @Test(arguments: EditorModelChoice.allCases)
  func loadsAndSavesUnchanged(_ choice: EditorModelChoice) throws {
    let model = try choice.make(referenceScript: Support.iosRoot.appending(path: "reference/dist/lexical-reference.js"))
    try model.load(SyntheticDocument.small.state)
    #expect(try model.snapshot().state == SyntheticDocument.small.state)
  }

  static func words(_ node: JSONValue) -> Int {
    let own = node["text"]?.stringValue?.split(whereSeparator: \.isWhitespace).count ?? 0
    return own + (node["children"]?.arrayValue ?? []).map(words).reduce(0, +)
  }

  static func nodes(_ node: JSONValue) -> Int {
    1 + (node["children"]?.arrayValue ?? []).map(nodes).reduce(0, +)
  }
}
