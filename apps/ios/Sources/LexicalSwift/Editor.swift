/// LexicalSwift's editor: a document, its selection and its history, changed
/// by one update per command as Lexical's editor is.
public final class Editor: EditorModel {
  public private(set) var state = EditorState(nodes: [:], selection: nil)
  private var nextKey: NodeKey = 0
  private var history = History(EditorState(nodes: [:], selection: nil))
  private var now = 0
  /// Whether the document holds only what the editing commands are ported
  /// for: paragraphs of plain text and line breaks. The other nodes come
  /// with #115 to #118 and #131 to #134.
  private var isEditable = false

  public init() {}

  public func load(_ json: JSONValue) throws {
    guard let root = json["root"], root["type"] == "root" else { throw EditorError.invalidState("No root") }
    var update = Update(EditorState(nodes: [:], selection: nil), nextKey: 0)
    _ = try update.parse(root)
    try update.applyTransforms()
    update.collectGarbage()
    state = update.state
    nextKey = update.nextKey
    now = 0
    history = History(state)
    isEditable = state.nodes.values.allSatisfy(\.isEditable)
  }

  @discardableResult
  public func apply(_ command: EditorCommand) throws -> ChangeSet {
    guard !state.nodes.isEmpty else { throw EditorError.invalidState("No document loaded") }
    switch command {
    case .wait(let milliseconds):
      now += milliseconds
      return ChangeSet(changed: [])
    case .undo, .redo:
      let restored = command == .undo ? history.undo(at: now) : history.redo(at: now)
      guard let restored else { return ChangeSet(changed: []) }
      state = restored
      return ChangeSet(changed: [], everything: true)
    default:
      guard isEditable else { throw EditorError.unsupported("Editing a document with more than plain paragraphs") }
    }
    var update = Update(state, nextKey: nextKey)
    try update.run(command)
    try update.applyTransforms()
    update.collectGarbage()
    let selection = update.selection
    if let selection, update.state.nodes[selection.anchor.key] == nil || update.state.nodes[selection.focus.key] == nil {
      throw EditorError.invalidState("Selection has been lost")
    }
    // Lexical commits an update that marked a node or moved the selection,
    // and drops one that did neither.
    let movesSelection = selection.map { $0.dirty || !$0.is(state.selection) } ?? (state.selection != nil)
    guard update.hasDirtyNodes || movesSelection else { return ChangeSet(changed: []) }
    var next = update.state
    next.selection = selection?.saved
    history.record(update, from: state, to: next, at: now)
    state = next
    nextKey = update.nextKey
    return update.changes
  }

  public func snapshot() throws -> Snapshot {
    guard !state.nodes.isEmpty else { throw EditorError.invalidState("No document loaded") }
    return Snapshot(state: state.json, selection: state.pathSelection)
  }
}

extension Node {
  fileprivate var isEditable: Bool {
    switch payload {
    case .root(let node): Self.isPlain(node.unknownFields)
    case .paragraph(let node): Self.isPlain(node.unknownFields)
    case .lineBreak(let node): Self.isPlain(node.unknownFields)
    case .text(let node): Self.isPlain(node.unknownFields) && node.mode == .normal && (node.detail ?? 0) == 0
    default: false
    }
  }

  /// Fields no payload type reads, but the version every node writes.
  private static func isPlain(_ unknownFields: [String: JSONValue]) -> Bool {
    unknownFields.keys.allSatisfy { $0 == "version" }
  }
}

extension Update {
  mutating func run(_ command: EditorCommand) throws {
    if case .setSelection(let anchor, let focus) = command {
      return try placeSelection(anchor, focus)
    }
    if command == .selectAll {
      return selectAll()
    }
    guard let selection else { throw EditorError.noSelection }
    switch command {
    case .insertText(let text): try insertText(selection, text)
    case .deleteCharacter(let backward): try deleteCharacter(selection, backward: backward)
    case .deleteWord(let backward): try deleteWord(selection, backward: backward)
    case .deleteLine(let backward): try deleteLine(selection, backward: backward)
    case .insertParagraph: try insertParagraph(selection)
    case .insertLineBreak: try insertLineBreak(selection)
    case .formatText(let format): try formatText(selection, format)
    default: throw EditorError.unsupported(command.name)
    }
  }

  /// `setSelection` in `reference/entry.ts`.
  private mutating func placeSelection(_ anchorAt: Point, _ focusAt: Point) throws {
    let last = selection
    let placed = RangeSelection(
      anchor: SelectionPoint(try pointNode(anchorAt), anchorAt.offset, anchorAt.type),
      focus: SelectionPoint(try pointNode(focusAt), focusAt.offset, focusAt.type), format: [], style: "")
    try normalizePointsForBoundaries(placed.anchor, placed.focus)
    let anchorNode = placed.anchor.key
    if let last {
      if last.anchor.key == anchorNode {
        placed.format = last.format
        placed.style = last.style
      } else if state[anchorNode].isText {
        placed.format = format(of: anchorNode)
        placed.style = style(of: anchorNode)
      } else if state[anchorNode].isElement {
        placed.format = textFormat(of: anchorNode)
        placed.style = textStyle(of: anchorNode)
      }
    }
    setSelection(placed)
    placed.dirty = false
    if placed.isCollapsed {
      if state[anchorNode].isText {
        placed.updateFormatStyle(format(of: anchorNode), style(of: anchorNode))
      } else if state[anchorNode].isElement, !state.textContent(of: EditorState.rootKey).isEmpty {
        if isEmpty(anchorNode) {
          placed.updateFormatStyle(textFormat(of: anchorNode), textStyle(of: anchorNode))
        } else {
          placed.updateFormatStyle(placed.format, "")
        }
      }
    } else {
      placed.format = try combinedFormat(placed, anchorAt, focusAt)
    }
  }

  /// `combinedFormat` in `reference/entry.ts`.
  private func combinedFormat(_ selection: RangeSelection, _ anchorAt: Point, _ focusAt: Point) throws -> TextFormat {
    let nodes = try nodes(in: selection)
    let (start, end) = try state.startEnd(selection)
    let (startAt, endAt) = start === selection.anchor ? (anchorAt, focusAt) : (focusAt, anchorAt)
    var combined = TextFormat.all
    var hasText = false
    for (index, node) in nodes.enumerated() where state[node].isText {
      let size = state.textSize(of: node)
      let touchesStart = index == 0 && node == start.key && startAt.offset == size
      let touchesEnd = index == nodes.count - 1 && node == end.key && endAt.offset == 0
      guard size != 0, !touchesStart, !touchesEnd else { continue }
      hasText = true
      combined.formIntersection(format(of: node))
      if combined.isEmpty { break }
    }
    return hasText ? combined : []
  }

  /// `pointNode` in `reference/entry.ts`.
  private func pointNode(_ point: Point) throws -> NodeKey {
    guard let key = state.key(at: point.path) else { throw EditorError.noNode(path: point.path) }
    let node = state[key]
    let size =
      point.type == .text
      ? (node.isText ? state.textSize(of: key) : -1) : (node.isElement ? state.childCount(of: key) : -1)
    guard size >= 0, (0...size).contains(point.offset) else {
      throw EditorError.invalidState("No \(point.type.rawValue) point at \(point.path), \(point.offset)")
    }
    return key
  }
}
