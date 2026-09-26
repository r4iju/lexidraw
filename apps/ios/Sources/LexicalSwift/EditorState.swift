import HashTreeCollections
import OrderedCollections

public typealias NodeKey = Int

/// A document as Lexical holds it: its nodes by key in a persistent map, so
/// an update copies only the nodes it changes and every earlier state stays
/// valid beside it.
public struct EditorState: Sendable {
  static let rootKey: NodeKey = 0

  var nodes: TreeDictionary<NodeKey, Node>
  var selection: RangeSelection?

  subscript(key: NodeKey) -> Node { nodes[key]! }

  /// The serialized editor state, `{"root": …}`, as Lexical writes it.
  public var json: JSONValue { ["root": json(of: Self.rootKey)] }
}

struct Node: Sendable {
  let type: String
  let traits: NodeTraits
  var parent: NodeKey?
  /// An element's children; nil for a leaf, and for a node kept verbatim with
  /// its children still in its payload. Hashed, so finding a child's place
  /// among thousands of blocks at the root costs no more than among a few.
  var children: OrderedSet<NodeKey>?
  /// The node's own properties as Lexical holds them once read. An element's
  /// children are held apart, in `children`.
  var payload: SerializedNode

  init(_ payload: SerializedNode, type: String, children: OrderedSet<NodeKey>?) {
    self.type = type
    traits = NodeTraits.byType[type] ?? .unregistered
    self.payload = payload
    self.children = children
  }

  var isElement: Bool { children != nil }
  var isText: Bool { traits.kind == .text }
  var isLineBreak: Bool { traits.kind == .lineBreak }
  var isDecorator: Bool { traits.kind == .decorator }
  var isRoot: Bool { type == "root" }
  var isInline: Bool { trait(traits.inline) }
  var isShadowRoot: Bool { trait(traits.shadowRoot) }
  var canBeEmpty: Bool { trait(traits.canBeEmpty) }
  var isRootOrShadowRoot: Bool { isRoot || (isElement && isShadowRoot) }

  private func trait(_ trait: NodeTraits.Trait) -> Bool {
    if case .fixed(let value) = trait { return value }
    return trait.value(in: payload.json)
  }
}

extension NodeTraits {
  /// A type no registered node has. Lexical refuses to load it; LexicalSwift
  /// keeps it whole, as a block that holds nothing it looks into.
  static let unregistered = NodeTraits(
    kind: .decorator, inline: .fixed(false), shadowRoot: .fixed(false), canBeEmpty: .fixed(false))
}

extension EditorState {
  func parent(of key: NodeKey) -> NodeKey? { self[key].parent }

  func children(of key: NodeKey) -> OrderedSet<NodeKey> { self[key].children ?? [] }

  func index(of key: NodeKey) -> Int? {
    parent(of: key).flatMap { children(of: $0).firstIndex(of: key) }
  }

  func previousSibling(of key: NodeKey) -> NodeKey? {
    guard let parent = parent(of: key), let siblings = self[parent].children,
      let index = siblings.firstIndex(of: key), index > 0
    else { return nil }
    return siblings[index - 1]
  }

  func nextSibling(of key: NodeKey) -> NodeKey? {
    guard let parent = parent(of: key), let siblings = self[parent].children,
      let index = siblings.firstIndex(of: key), index + 1 < siblings.count
    else { return nil }
    return siblings[index + 1]
  }

  func isAttached(_ key: NodeKey) -> Bool {
    var current = key
    while current != Self.rootKey {
      guard let node = nodes[current], let parent = node.parent else { return false }
      current = parent
    }
    return true
  }

  /// Child indexes from the root, for a node in the document.
  func path(of key: NodeKey) -> [Int]? {
    var path: [Int] = []
    var current = key
    while current != Self.rootKey {
      guard let parent = nodes[current]?.parent, let index = children(of: parent).firstIndex(of: current)
      else { return nil }
      path.append(index)
      current = parent
    }
    return path.reversed()
  }

  func key(at path: [Int]) -> NodeKey? {
    var current = Self.rootKey
    for index in path {
      let children = children(of: current)
      guard children.indices.contains(index) else { return nil }
      current = children[index]
    }
    return current
  }
}
