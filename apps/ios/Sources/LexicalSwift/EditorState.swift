import HashTreeCollections
import OrderedCollections

public typealias NodeKey = Int

/// A document as Lexical holds it: its nodes by key in a persistent map, so
/// an update copies only the nodes it changes and every earlier state stays
/// valid beside it.
public struct EditorState: Sendable {
  static let rootKey: NodeKey = 0

  var nodes: TreeDictionary<NodeKey, Node>
  var selection: KeySelection?

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
  /// The update that last marked the node, standing in for the identity of
  /// Lexical's node object, which each update that marks a node replaces.
  var revision = 0

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

  func firstChild(of key: NodeKey) -> NodeKey? { self[key].children?.first }

  func lastChild(of key: NodeKey) -> NodeKey? { self[key].children?.last }

  func childCount(of key: NodeKey) -> Int { self[key].children?.count ?? 0 }

  func child(of key: NodeKey, at index: Int) -> NodeKey? {
    guard let children = self[key].children, children.indices.contains(index) else { return nil }
    return children[index]
  }

  /// A text node's length in UTF-16 code units, which Lexical's offsets count.
  func textSize(of key: NodeKey) -> Int { self[key].text.utf16.count }

  /// Lexical's `getTextContent`: a line break reads as a newline, and blocks
  /// are set apart by a blank line.
  func textContent(of key: NodeKey) -> String {
    let node = self[key]
    if node.isLineBreak { return "\n" }
    guard let children = node.children else { return node.text }
    var text = ""
    for (index, child) in children.enumerated() {
      text += textContent(of: child)
      if self[child].isElement, index != children.count - 1, !self[child].isInline {
        text += "\n\n"
      }
    }
    return text
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

  /// The paths of the nodes an update between `earlier` and this state
  /// marked, as undo and redo report them.
  func changedPaths(since earlier: EditorState) -> Set<[Int]> {
    Set(nodes.compactMap { key, node in earlier.nodes[key]?.revision == node.revision ? nil : path(of: key) })
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
