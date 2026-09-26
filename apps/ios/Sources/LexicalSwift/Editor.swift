/// LexicalSwift's editor. This first cut only covers typing at a caret in
/// text; it refuses anything else as `unsupported` so the fuzzer can be
/// scoped to what exists.
public final class Editor: EditorModel {
  private final class Node {
    /// Every serialized field except `children`.
    var fields: [String: JSONValue]
    var children: [Node]?

    init(fields: [String: JSONValue], children: [Node]?) {
      self.fields = fields
      self.children = children
    }

    var type: String? { fields["type"]?.stringValue }

    var text: String {
      get { fields["text"]?.stringValue ?? "" }
      set { fields["text"] = .string(newValue) }
    }
  }

  private var root: Node?
  private var selection: Selection?

  public init() {}

  public func load(_ state: JSONValue) throws {
    guard let root = state["root"] else { throw EditorError.invalidState("No root") }
    self.root = try node(from: root)
    selection = nil
  }

  @discardableResult
  public func apply(_ command: EditorCommand) throws -> ChangeSet {
    switch command {
    case .setSelection(let anchor, let focus):
      guard anchor == focus, anchor.type == .text else {
        throw EditorError.unsupported("Only a caret in text can be placed")
      }
      let node = try self.node(at: anchor.path)
      guard node.type == "text", (0...node.text.utf16.count).contains(anchor.offset) else {
        throw EditorError.unsupported("A caret must be inside a text node")
      }
      selection = Selection(
        anchor: anchor, focus: focus,
        format: node.fields["format"]?.intValue ?? 0,
        style: node.fields["style"]?.stringValue ?? "")
      return ChangeSet()

    case .insertText(let text):
      guard let selection else { throw EditorError.noSelection }
      let node = try self.node(at: selection.anchor.path)
      guard selection.isCollapsed,
        selection.format == node.fields["format"]?.intValue,
        selection.style == node.fields["style"]?.stringValue
      else {
        throw EditorError.unsupported("Only typing into text of the caret's format")
      }
      var units = Array(node.text.utf16)
      units.insert(contentsOf: text.utf16, at: selection.anchor.offset)
      node.text = String(decoding: units, as: UTF16.self)
      var caret = selection.anchor
      caret.offset += text.utf16.count
      self.selection?.anchor = caret
      self.selection?.focus = caret
      return ChangeSet(changed: [selection.anchor.path, []])
    }
  }

  public func snapshot() throws -> Snapshot {
    guard let root else { throw EditorError.invalidState("No document loaded") }
    return Snapshot(state: ["root": json(from: root)], selection: selection)
  }

  private func node(from value: JSONValue) throws -> Node {
    guard case .object(var fields) = value else { throw EditorError.invalidState("A node isn't an object") }
    let children = fields.removeValue(forKey: "children")?.arrayValue
    return Node(fields: fields, children: try children?.map { try node(from: $0) })
  }

  private func json(from node: Node) -> JSONValue {
    var fields = node.fields
    if let children = node.children {
      fields["children"] = .array(children.map(json(from:)))
    }
    return .object(fields)
  }

  private func node(at path: [Int]) throws -> Node {
    guard var node = root else { throw EditorError.invalidState("No document loaded") }
    for index in path {
      guard let children = node.children, children.indices.contains(index) else {
        throw EditorError.noNode(path: path)
      }
      node = children[index]
    }
    return node
  }
}
