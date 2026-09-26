import Foundation
import LexicalSwift
import Testing

@Suite struct SerializedNodeTests {
  static let everyNode: JSONValue = try! JSONDecoder().decode(
    JSONValue.self, from: Data(contentsOf: Support.everyNode))

  static var root: JSONValue { everyNode["root"]! }

  @Test func theSyntheticDocumentIsWhatLexicalWrites() throws {
    let reference = try Support.referenceEditor()
    try reference.load(Self.everyNode)

    #expect(try reference.snapshot().state == Self.everyNode)
  }

  @Test func theSyntheticDocumentHasEveryNode() throws {
    let schema = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: Support.nodeSchema))
    let declared = Set(schema["nodes"]?.arrayValue?.compactMap { $0["type"]?.stringValue } ?? [])
    let present = Set(Self.everyNode.nodePaths().compactMap {
      Self.everyNode.node(at: $0)?["type"]?.stringValue
    })

    #expect(!declared.isEmpty)
    #expect(declared.subtracting(present).isEmpty)
  }

  @Test func everyNodeRoundTripsThroughCodableToEqualJSON() throws {
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
      (payload as? any ParentNodePayload)?.children?.forEach(walk)
    }

    walk(SerializedNode(json: Self.root))

    #expect(untyped == [])
  }

  @Test func unknownFieldsAndNodesAreWrittenBackAsRead() {
    let future: JSONValue = ["type": "future-node", "version": 3, "shape": ["sides": [1, 2.5]]]
    let heading: JSONValue = [
      "type": "heading", "version": 1, "tag": "h3", "children": [future],
      "direction": nil, "format": "", "indent": 0, "addedLater": ["nested": [true, nil]],
    ]

    let node = SerializedNode(json: heading)

    #expect(node.json == heading)
    guard case .heading(let payload) = node else {
      Issue.record("A heading should decode as one")
      return
    }
    #expect(payload.tag == .h3)
    #expect(payload.children == [.opaque(future)])
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
    OddValue(at: [2], "shadowRoot", false),
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
    OddValue(at: [7, 0], "className", 5),
    OddValue(at: [7, 2], "mentionName", 7),
    OddValue(at: [7, 4], "uuid", nil),
    OddValue(at: [7, 5], "label", nil),
    OddValue(at: [8], "kind", "shout"),
    OddValue(at: [8], "title", 5),
    OddValue(at: [9], "open", "yes"),
    OddValue(at: [10], "templateColumns", 3),
    OddValue(at: [10], "$.figure.width", "050%"),
    OddValue(at: [10], "$.figure.width", "5%"),
    OddValue(at: [10], "$.figure", "wide"),
    OddValue(at: [12, 0], "direction", "rtl"),
    OddValue(at: [12, 0], "comment", "gone"),
    OddValue(at: [12, 0], "comment.timeStamp", "1"),
    OddValue(at: [12, 1], "thread.comments", "none"),
    OddValue(at: [12, 1], "thread.resolved", "yes"),
    OddValue(at: [12, 2], "color", "teal"),
    OddValue(at: [12, 2], "xOffset", "10"),
    OddValue(at: [12, 2], "caption", 5),
    OddValue(at: [12, 3], "options", 5),
    OddValue(at: [12, 3], "options.0.votes", "u1"),
    OddValue(at: [14, 0], "width", "wide"),
    OddValue(at: [14, 0], "maxWidth", "wide"),
    OddValue(at: [14, 0], "caption", 5),
    OddValue(at: [14, 0], "$.natural.width", "3"),
    OddValue(at: [14, 0], "$.natural.height", 0),
    OddValue(at: [14, 0], "$.figure.extra", 1),
    OddValue(at: [14, 3], "position", "center"),
    OddValue(at: [14, 3], "captionsEnabled", nil),
    OddValue(at: [14, 5], "inline", "yes"),
    OddValue(at: [15], "caption", 5),
    OddValue(at: [15], "caption", ["root": ["children": []]]),
    OddValue(at: [17], "format", "middle"),
    OddValue(at: [17], "width", "560"),
    OddValue(at: [21], "width", 0),
    OddValue(at: [21], "width", "640"),
    OddValue(at: [21], "height", "banana"),
    OddValue(at: [21], "schema", 5),
    OddValue(at: [22], "chartType", "donut"),
    OddValue(at: [23, 0], "width", 0),
    OddValue(at: [25], "theme", "dracula"),
    OddValue(at: [25], "showLineNumbers", "yes"),
    OddValue(at: [26], "data", 5),
    OddValue(at: [26], "data.mode", "other"),
    OddValue(at: [26], "data.distilled.wordCount", "12"),
    OddValue(at: [27], "data.snapshot", "gone"),
    OddValue(at: [28], "data.currentSlideId", 5),
    OddValue(at: [28], "data.slides.0.elements.0.kind", "circle"),
    OddValue(at: [28], "data.slides.0.elements.1.width", "wide"),
    OddValue(at: [28], "data.slides.0.elements.2", 7),
  ])
  func aValueOutsideItsDomainReadsAsLexicalReadsIt(_ odd: OddValue) throws {
    let document = Self.everyNode.settingField(odd.field, to: odd.value, at: odd.path)
    let reference = try Support.referenceEditor()
    try reference.load(document)
    let lexical = try reference.snapshot().state.node(at: odd.path)?.value(at: odd.field)

    let swift = SerializedNode(json: document["root"]!).json.nodeInRoot(at: odd.path)?
      .value(at: odd.field)

    #expect(swift == lexical)
  }
}

struct OddValue: CustomTestStringConvertible, Sendable {
  let path: [Int]
  /// A property of the node, or a dotted path down into one.
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

  /// The value at a dotted path of keys and array indices.
  func value(at keyPath: String) -> JSONValue? {
    keyPath.split(separator: ".").reduce(self) { value, key in
      switch value {
      case .object(let object)?: object[String(key)]
      case .array(let items)?: Int(key).flatMap { items.indices.contains($0) ? items[$0] : nil }
      default: nil
      }
    }
  }

  func setting(_ keyPath: ArraySlice<Substring>, to value: JSONValue) -> JSONValue {
    guard let key = keyPath.first else { return value }
    switch self {
    case .object(var object):
      object[String(key)] = (object[String(key)] ?? .null).setting(keyPath.dropFirst(), to: value)
      return .object(object)
    case .array(var items):
      guard let index = Int(key), items.indices.contains(index) else { return self }
      items[index] = items[index].setting(keyPath.dropFirst(), to: value)
      return .array(items)
    default:
      return self
    }
  }

  func settingField(_ field: String, to value: JSONValue, at path: [Int]) -> JSONValue {
    func set(_ node: JSONValue, _ path: ArraySlice<Int>) -> JSONValue {
      guard case .object(var object) = node else { return node }
      if let index = path.first, case .array(var children)? = object["children"] {
        children[index] = set(children[index], path.dropFirst())
        object["children"] = .array(children)
        return .object(object)
      }
      return node.setting(field.split(separator: ".")[...], to: value)
    }
    guard case .object(var state) = self, let root = state["root"] else { return self }
    state["root"] = set(root, path[...])
    return .object(state)
  }
}
