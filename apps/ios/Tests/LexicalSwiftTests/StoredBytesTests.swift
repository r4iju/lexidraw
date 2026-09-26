import Foundation
import LexicalFuzz
import LexicalSwift
import Testing

/// The web's saves of stored nodes, as stored and odd (`stored-bytes.json` in
/// @packages/lexical-nodes). LexicalSwift's editor loads each and saves the
/// web's bytes, but for what #111 asks it to keep that Lexical drops: the
/// properties a node doesn't declare.
@Suite struct StoredBytesTests {
  struct StoredCase: CustomTestStringConvertible, Sendable {
    let name: String
    let document: JSONValue
    /// What the web saved it as.
    let saved: JSONValue

    var testDescription: String { name }
  }

  /// A node the web couldn't read at all is left out: there's nothing to
  /// agree with.
  static let cases: [StoredCase] = try! JSONValue(parsing: String(contentsOf: Support.storedBytes, encoding: .utf8))
    .arrayValue!.compactMap { stored in
      guard stored["threw"] != true, let name = stored["name"]?.stringValue, let node = stored["node"] else {
        return nil
      }
      return StoredCase(
        name: name, document: LexicalJSON.document([node]),
        saved: LexicalJSON.document(stored["output"]?.arrayValue ?? [node]))
    }

  @Test(arguments: cases)
  func lexicalSwiftSavesWhatTheWebSaves(_ stored: StoredCase) throws {
    let editor = Editor()
    try editor.load(stored.document)
    let saved = try editor.snapshot().state

    #expect(saved.withoutUndeclaredFields.stringified == stored.saved.stringified)
  }

  /// The web reads LexicalSwift's save, undeclared properties and all, as the
  /// document the web itself saved.
  @Test func theWebOpensWhatLexicalSwiftSavesAsItOpensTheOriginal() throws {
    let reference = try Support.referenceEditor()
    var differ: [String] = []
    for stored in Self.cases {
      let editor = Editor()
      try editor.load(stored.document)
      try reference.load(editor.snapshot().state)
      let fromLexicalSwift = try reference.snapshot().state.stringified
      try reference.load(stored.document)
      if try reference.snapshot().state.stringified != fromLexicalSwift { differ.append(stored.name) }
    }

    #expect(differ == [])
  }

  @Test func theCasesAreThere() {
    #expect(Self.cases.count > 4000)
  }
}

extension JSONValue {
  /// A saved document without the properties its nodes don't declare, which
  /// LexicalSwift keeps and Lexical drops.
  fileprivate var withoutUndeclaredFields: JSONValue {
    guard case .object(var state) = self, let root = state["root"] else { return self }
    state["root"] = root.nodeWithoutUndeclaredFields
    return .object(state)
  }

  /// Lexical keeps the NodeState it doesn't declare, under `$`, where the
  /// node writes `$`.
  private var nodeWithoutUndeclaredFields: JSONValue {
    guard case .object(var fields) = self else { return self }
    var node = fields
    node["children"] = nil
    guard let payload = SerializedNode(json: .object(node)).payload else { return self }
    for key in payload.unknownFields.keys where !type(of: payload).keyOrder.contains(key) {
      fields[key] = nil
    }
    if let children = fields["children"]?.arrayValue {
      fields["children"] = .array(children.map(\.nodeWithoutUndeclaredFields))
    }
    return .object(fields)
  }
}
