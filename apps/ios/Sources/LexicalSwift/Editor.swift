/// LexicalSwift's editor. Typing so far covers a caret in text; anything
/// else is refused as `unsupported` so the fuzzer can be scoped to what exists.
public final class Editor: EditorModel {
  public private(set) var state = EditorState(nodes: [:], selection: nil)
  private var nextKey: NodeKey = 0

  public init() {}

  public func load(_ json: JSONValue) throws {
    guard let root = json["root"], root["type"] == "root" else { throw EditorError.invalidState("No root") }
    var update = Update(EditorState(nodes: [:], selection: nil), nextKey: 0)
    _ = try update.parse(root)
    try update.applyTransforms()
    update.collectGarbage()
    state = update.state
    nextKey = update.nextKey
  }

  @discardableResult
  public func apply(_ command: EditorCommand) throws -> ChangeSet {
    guard !state.nodes.isEmpty else { throw EditorError.invalidState("No document loaded") }
    var update = Update(state, nextKey: nextKey)
    try update.run(command)
    try update.applyTransforms()
    update.collectGarbage()
    state = update.state
    nextKey = update.nextKey
    return update.changes
  }

  public func snapshot() throws -> Snapshot {
    guard !state.nodes.isEmpty else { throw EditorError.invalidState("No document loaded") }
    return Snapshot(state: state.json, selection: state.pathSelection)
  }
}

extension Update {
  mutating func run(_ command: EditorCommand) throws {
    switch command {
    case .setSelection(let anchor, let focus):
      guard anchor == focus, anchor.type == .text, let key = state.key(at: anchor.path),
        let text = self[key].textNode, (0...(text.text ?? "").utf16.count).contains(anchor.offset)
      else {
        throw EditorError.unsupported("Only a caret in text can be placed")
      }
      let point = KeyPoint(key: key, offset: anchor.offset, type: .text)
      state.selection = RangeSelection(
        anchor: point, focus: point, format: Int(text.format ?? 0), style: text.style ?? "")

    case .insertText(let inserted):
      guard let selection = state.selection else { throw EditorError.noSelection }
      let key = selection.anchor.key
      guard selection.isCollapsed, let text = self[key].textNode,
        Double(selection.format) == text.format, selection.style == text.style
      else {
        throw EditorError.unsupported("Only typing into text of the caret's format")
      }
      var units = Array((text.text ?? "").utf16)
      units.insert(contentsOf: inserted.utf16, at: selection.anchor.offset)
      try setText(key, String(decoding: units, as: UTF16.self))
      let caret = KeyPoint(key: key, offset: selection.anchor.offset + inserted.utf16.count, type: .text)
      state.selection?.anchor = caret
      state.selection?.focus = caret
    }
  }
}
