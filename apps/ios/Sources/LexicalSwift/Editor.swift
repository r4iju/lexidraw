/// LexicalSwift's editor: a document, its selection and its history, changed
/// by one update per command as Lexical's editor is.
public final class Editor: EditorModel {
  public private(set) var state = EditorState(nodes: [:], selection: nil)
  private var nextKey: NodeKey = 0
  private var revisions = 0
  private var history = History(EditorState(nodes: [:], selection: nil))
  private var now = 0
  /// Whether the document holds only what the editing commands are ported
  /// for: paragraphs, headings, quotes, lists, horizontal rules, line
  /// breaks, tabs and text in any format, with no field the payload types
  /// don't model.
  public private(set) var isEditable = false
  private var knowsListMarker = false
  /// How many markdown shortcuts this editor has left as typed where Lexical
  /// runs a transformer LexicalSwift doesn't port yet.
  public private(set) var shortcutsDeclinedAsNotPorted = 0

  public init() {}

  public func load(_ json: JSONValue) throws {
    guard let root = json["root"], root["type"] == "root" else { throw EditorError.invalidState("No root") }
    var update = Update(EditorState(nodes: [:], selection: nil), nextKey: 0, revision: nextRevision())
    _ = try update.parse(root)
    try update.applyTransforms()
    update.collectGarbage()
    state = update.state
    nextKey = update.nextKey
    now = 0
    history = History(state)
    knowsListMarker = false
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
      defer { state = restored }
      return ChangeSet(changed: restored.changedPaths(since: state))
    default:
      guard isEditable else { throw EditorError.unsupported("Editing a document with a node LexicalSwift doesn't edit yet") }
    }
    let saved = (state, nextKey, history, knowsListMarker)
    do {
      guard command == .cut else {
        let compositionEnd = if case .commitComposition = command { true } else { false }
        return try commit(compositionEnd: compositionEnd) { try $0.run(command) }
      }
      // Rich text's cut is two updates: one widens a selection of the whole
      // document to its blocks and copies it, and the next deletes it.
      let copied = try commit(tags: [.cut]) { try $0.copyForCut() }
      var changes = try commit(tags: [.cut]) { update in
        guard let selection = update.selection else { throw EditorError.noSelection }
        try update.removeText(selection)
      }
      changes.clipboard = copied.clipboard
      return changes
    } catch let failure as ShortcutFailure {
      throw failure.error
    } catch {
      (state, nextKey, history, knowsListMarker) = saved
      throw error
    }
  }

  /// An error in a markdown shortcut's update. Lexical reports it and drops
  /// that update alone, so the updates before it, the one that set the
  /// shortcut off among them, stay.
  private struct ShortcutFailure: Error {
    let error: any Error
  }

  /// Runs and commits an update, then the markdown shortcuts it sets off:
  /// `registerMarkdownShortcuts` runs an update of its own after one that
  /// finishes a shortcut, which can finish another.
  private func commit(
    tags: Set<UpdateTag> = [], compositionEnd: Bool = false, _ run: (inout Update) throws -> Void
  ) throws -> ChangeSet {
    var update = Update(state, nextKey: nextKey, revision: nextRevision(), knowsListMarker: knowsListMarker)
    update.tags = tags
    try run(&update)
    shortcutsDeclinedAsNotPorted += update.shortcutsDeclinedAsNotPorted
    let clipboard = update.clipboard
    var previous = state
    guard try commit(&update) else { return ChangeSet(changed: [], clipboard: clipboard) }
    var changed = update.changedKeys
    var compositionEnd = compositionEnd
    while let caret = state.markdownShortcutCaret(
      after: previous, dirtyLeaves: update.dirtyLeaves, compositionEnd: compositionEnd)
    {
      compositionEnd = false
      previous = state
      update = Update(state, nextKey: nextKey, revision: nextRevision(), knowsListMarker: knowsListMarker)
      let isShortcut: Bool
      do { isShortcut = try update.runMarkdownShortcut(at: caret) } catch { throw ShortcutFailure(error: error) }
      shortcutsDeclinedAsNotPorted += update.shortcutsDeclinedAsNotPorted
      guard try commit(&update, pushingHistory: isShortcut) else { break }
      changed += update.changedKeys
    }
    return ChangeSet(changed: Set(changed.compactMap(state.path(of:))), clipboard: clipboard)
  }

  /// Lexical commits an update that marked a node or moved the selection,
  /// and drops one that did neither. Returns whether `update` committed.
  private func commit(_ update: inout Update, pushingHistory: Bool = false) throws -> Bool {
    try update.applyTransforms()
    update.collectGarbage()
    let selection = update.selection
    if let selection, update.state.nodes[selection.anchor.key] == nil || update.state.nodes[selection.focus.key] == nil {
      throw EditorError.invalidState("Selection has been lost")
    }
    let movesSelection = selection.map { $0.dirty || !$0.is(state.selection) } ?? (state.selection != nil)
    guard update.hasDirtyNodes || movesSelection else { return false }
    var next = update.state
    next.selection = selection?.saved
    history.record(update, from: state, to: next, at: now, pushing: pushingHistory)
    state = next
    nextKey = update.nextKey
    knowsListMarker = update.knowsListMarker
    return true
  }

  private func nextRevision() -> Int {
    revisions += 1
    return revisions
  }

  public func snapshot() throws -> Snapshot {
    guard !state.nodes.isEmpty else { throw EditorError.invalidState("No document loaded") }
    return Snapshot(state: state.json, selection: state.pathSelection)
  }

  /// `state` as an editor that registers `types` saves it once it has read
  /// it, or nil where that editor can't read it: Lexical refuses a type it
  /// hasn't registered.
  static func saved(_ state: JSONValue, registering types: Set<String>) -> JSONValue? {
    func registered(_ node: JSONValue) -> Bool {
      guard let type = node["type"]?.stringValue, types.contains(type) else { return false }
      return node["children"]?.arrayValue?.allSatisfy(registered) ?? true
    }
    guard let root = state["root"], registered(root) else { return nil }
    let editor = Editor()
    return (try? editor.load(state)).flatMap { try? editor.snapshot().state }
  }

  public func selection() throws -> Selection? {
    guard !state.nodes.isEmpty else { throw EditorError.invalidState("No document loaded") }
    return state.pathSelection
  }

  public func node(at path: [Int]) throws -> JSONValue {
    state.json(of: try key(at: path))
  }

  public func childKeys(at path: [Int]) throws -> [String] {
    state.children(of: try key(at: path)).map(String.init)
  }

  private func key(at path: [Int]) throws -> NodeKey {
    guard !state.nodes.isEmpty else { throw EditorError.invalidState("No document loaded") }
    guard let key = state.key(at: path) else { throw EditorError.noNode(path: path) }
    return key
  }
}

extension Node {
  var isEditable: Bool {
    switch payload {
    case .root(let node): node.unknownFields.isEmpty
    case .paragraph(let node): node.unknownFields.isEmpty
    case .heading(let node): node.unknownFields.isEmpty
    case .quote(let node): node.unknownFields.isEmpty && node.shadowRoot != true
    case .list(let node): node.unknownFields.isEmpty || node.holdsOnlyAMarkdownMarker
    case .listItem(let node): node.unknownFields.isEmpty
    case .lineBreak(let node): node.unknownFields.isEmpty
    case .horizontalRule(let node): node.unknownFields.isEmpty
    case .link(let node): node.unknownFields.isEmpty
    case .autoLink(let node): node.unknownFields.isEmpty
    case .text(let node): node.unknownFields.isEmpty && node.mode == .normal && (node.detail ?? 0) == 0
    case .tab(let node): node.unknownFields.isEmpty && node.detail == Double(TextDetail.unmergeable.rawValue)
    default: false
    }
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
    if case .toggleChecked(let path) = command {
      return try toggleChecked(at: path)
    }
    guard let selection else { throw EditorError.noSelection }
    switch command {
    case .insertText(let text), .commitComposition(let text): try insertText(selection, text)
    case .deleteCharacter(true): try backspace(selection)
    case .deleteCharacter(false): try deleteCharacter(selection, backward: false)
    case .deleteWord(let backward): try deleteWord(selection, backward: backward)
    case .deleteLine(let backward, let lineBoundary):
      let boundary = try pointNode(lineBoundary)
      try deleteLine(
        selection, backward: backward,
        lineBoundary: KeyPoint(key: boundary, offset: lineBoundary.offset, type: lineBoundary.type))
    case .insertParagraph:
      if try !runMarkdownShortcutOnEnter(selection) { try enter(selection) }
    case .insertLineBreak: try insertLineBreak(selection)
    case .formatText(let format): try formatText(selection, format)
    case .setBlockType(let type): try setBlockType(selection, type)
    case .insertList(let listType): try insertList(ListType(listType))
    case .removeList: try removeList()
    case .indent: try indentContent()
    case .outdent: try outdentContent()
    case .tab(let backward): try tab(selection, backward: backward)
    case .toggleLink(let url): try toggleLinkCommand(selection, url: url)
    case .editLink(let url): try editLink(selection, url: url)
    case .copy: clipboard = try copy(selection)
    case .paste(let clipboard): try paste(selection, clipboard)
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
