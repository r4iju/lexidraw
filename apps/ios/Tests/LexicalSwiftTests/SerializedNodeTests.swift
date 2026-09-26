import Foundation
import LexicalSwift
import Testing

@Suite struct SerializedNodeTests {
  static let everyBuiltInNode: JSONValue = {
    let url = Bundle.module.url(
      forResource: "every-built-in-node", withExtension: "json", subdirectory: "Documents")!
    return try! JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
  }()

  static var root: JSONValue { everyBuiltInNode["root"]! }

  @Test func theSyntheticDocumentIsWhatLexicalWrites() throws {
    let reference = try Support.referenceEditor()
    try reference.load(Self.everyBuiltInNode)

    #expect(try reference.snapshot().state == Self.everyBuiltInNode)
  }

  @Test func theSyntheticDocumentHasEveryDeclaredNode() throws {
    let schema = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: Support.nodeSchema))
    let declared = Set(schema["nodes"]?.arrayValue?.compactMap { $0["type"]?.stringValue } ?? [])
    let present = Set(Self.everyBuiltInNode.nodePaths().compactMap {
      Self.everyBuiltInNode.node(at: $0)?["type"]?.stringValue
    })

    #expect(!declared.isEmpty)
    #expect(declared.subtracting(present).isEmpty)
  }

  @Test func everyBuiltInNodeRoundTripsThroughCodableToEqualJSON() throws {
    let decoded = try JSONDecoder().decode(SerializedNode.self, from: JSONEncoder().encode(Self.root))
    let encoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(decoded))

    #expect(encoded == Self.root)
  }

  /// The generated types cover what Lexical writes: nothing is left opaque or
  /// unparsed but `version`.
  @Test func everyPropertyLexicalWritesIsTyped() {
    var untyped: [String] = []
    func walk(_ node: SerializedNode) {
      guard let payload = node.payload else {
        untyped.append("an opaque \(node.json["type"]?.stringValue ?? "node")")
        return
      }
      for key in payload.unknownFields.keys where key != "version" {
        untyped.append("\(type(of: payload).type).\(key)")
      }
      (payload as? any ElementNodePayload)?.children?.forEach(walk)
    }

    walk(SerializedNode(json: Self.root))

    #expect(untyped == [])
  }

  @Test func unknownFieldsAndNodesAreWrittenBackAsRead() {
    let future: JSONValue = ["type": "future-node", "version": 3, "shape": ["sides": [1, 2.5]]]
    let callout: JSONValue = [
      "type": "callout", "version": 1, "kind": "note", "children": [], "direction": nil,
      "format": "", "indent": 0,
    ]
    let heading: JSONValue = [
      "type": "heading", "version": 1, "tag": "h3", "children": [future, callout],
      "direction": nil, "format": "", "indent": 0, "addedLater": ["nested": [true, nil]],
    ]

    let node = SerializedNode(json: heading)

    #expect(node.json == heading)
    guard case .heading(let payload) = node else {
      Issue.record("A heading should decode as one")
      return
    }
    #expect(payload.tag == .h3)
    #expect(payload.children == [.opaque(future), .opaque(callout)])
  }

  @Test func aNullablePropertyTellsAbsentFromNullFromAValue() {
    func direction(_ json: JSONValue) -> Nullable<Direction>? {
      guard case .heading(let heading) = SerializedNode(json: json) else { return nil }
      return heading.direction
    }

    #expect(direction(["type": "heading", "children": []]) == .absent)
    #expect(direction(["type": "heading", "children": [], "direction": nil]) == .null)
    #expect(direction(["type": "heading", "children": [], "direction": "rtl"]) == .value(.rtl))
  }

  /// A stored value outside a field's domain reads as Lexical reads it, so a
  /// document means the same on both sides.
  @Test(arguments: [
    OddValue(at: [1], "tag", "h7"),
    OddValue(at: [1], "direction", "up"),
    OddValue(at: [1], "format", 3),
    OddValue(at: [1], "indent", -2),
    OddValue(at: [1], "indent", 1.5),
    OddValue(at: [1], "indent", "2"),
    OddValue(at: [1], "indent", "0x10"),
    OddValue(at: [0, 0], "format", "italic"),
    OddValue(at: [0, 0], "format", ["bold"]),
    OddValue(at: [0, 1], "detail", "unmergeable"),
    OddValue(at: [0, 1], "mode", "loud"),
    OddValue(at: [0, 4], "rel", ""),
    OddValue(at: [0, 4], "target", 5),
    OddValue(at: [0, 5], "isUnlinked", "yes"),
    OddValue(at: [0, 6], "ids", "a"),
    OddValue(at: [0, 6], "ids", ["a", 2]),
    OddValue(at: [3, 0], "checked", "yes"),
    OddValue(at: [4], "listType", "ul"),
    OddValue(at: [4], "start", "5"),
    OddValue(at: [6], "colWidths", "wide"),
    OddValue(at: [6, 0], "height", "tall"),
    OddValue(at: [6, 0, 0], "width", 0),
    OddValue(at: [6, 0, 0], "colSpan", 0),
    OddValue(at: [6, 0, 0], "verticalAlign", "top"),
    OddValue(at: [6, 0, 0], "backgroundColor", 5),
  ])
  func aValueOutsideItsDomainReadsAsLexicalReadsIt(_ odd: OddValue) throws {
    let document = Self.everyBuiltInNode.settingField(odd.field, to: odd.value, at: odd.path)
    let reference = try Support.referenceEditor()
    try reference.load(document)
    let lexical = try reference.snapshot().state.node(at: odd.path)?[odd.field]

    let swift = SerializedNode(json: document["root"]!).json.nodeInRoot(at: odd.path)?[odd.field]

    #expect(swift == lexical)
  }
}

struct OddValue: CustomTestStringConvertible, Sendable {
  let path: [Int]
  let field: String
  let value: JSONValue

  init(at path: [Int], _ field: String, _ value: JSONValue) {
    self.path = path
    self.field = field
    self.value = value
  }

  var testDescription: String { "\(field) = \(value) at \(path)" }
}

extension JSONValue {
  /// Paths of every node in a serialized editor state, depth first.
  func nodePaths() -> [[Int]] {
    func walk(_ node: JSONValue, _ path: [Int]) -> [[Int]] {
      let children = node["children"]?.arrayValue ?? []
      return [path] + children.indices.flatMap { walk(children[$0], path + [$0]) }
    }
    return self["root"].map { walk($0, []) } ?? []
  }

  func node(at path: [Int]) -> JSONValue? {
    self["root"]?.nodeInRoot(at: path)
  }

  /// The descendant of this node at `path`, by child index.
  func nodeInRoot(at path: [Int]) -> JSONValue? {
    path.reduce(self) { node, index in
      node?["children"]?.arrayValue.flatMap { $0.indices.contains(index) ? $0[index] : nil }
    }
  }

  func settingField(_ field: String, to value: JSONValue, at path: [Int]) -> JSONValue {
    func set(_ node: JSONValue, _ path: ArraySlice<Int>) -> JSONValue {
      guard case .object(var object) = node else { return node }
      if let index = path.first, case .array(var children)? = object["children"] {
        children[index] = set(children[index], path.dropFirst())
        object["children"] = .array(children)
      } else {
        object[field] = value
      }
      return .object(object)
    }
    guard case .object(var state) = self, let root = state["root"] else { return self }
    state["root"] = set(root, path[...])
    return .object(state)
  }
}
