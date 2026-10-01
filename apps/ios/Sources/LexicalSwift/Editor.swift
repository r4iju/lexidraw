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
  /// don't model, tables of them, and embedded drawing nodes.
  public private(set) var isEditable = false
  private var knowsListMarker = false
  /// How many markdown shortcuts this editor has left as typed where Lexical
  /// runs a transformer LexicalSwift doesn't port yet.
  public private(set) var shortcutsDeclinedAsNotPorted = 0

  public var supportsRichText: Bool { !plainText }
  private let plainText: Bool
  private let editorContext: EditorContext
  public init(plainText: Bool = false, editorContext: EditorContext = .document) {
    self.plainText = plainText
    self.editorContext = editorContext
  }

  public func load(_ json: JSONValue) throws {
    guard let root = json["root"], root["type"] == "root" else { throw EditorError.invalidState("No root") }
    var update = Update(EditorState(nodes: [:], selection: nil), nextKey: 0, revision: nextRevision())
    update.plainText = plainText
    update.editorContext = editorContext
    _ = try update.parse(root)
    try update.applyTransforms()
    if update.unregisteredType != nil {
      throw EditorError.invalidState("Node type is not registered in \(editorContext.rawValue)")
    }
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
    case .updateStructuralFields(let path, let fields):
      guard let index = path.last else { throw EditorError.invalidState("No structural node") }
      let keys = try childKeys(at: Array(path.dropLast()))
      guard keys.indices.contains(index) else { throw EditorError.invalidState("No structural node") }
      let original = try node(at: path)
      guard let changes = fields.objectValue, !changes.isEmpty else { throw EditorError.invalidState("No structural fields") }
      let allowed: Set<String>
      switch original["type"]?.stringValue {
      case "layout-container": allowed = ["templateColumns"]
      case "callout": allowed = ["kind", "title"]
      case "collapsible-container": allowed = ["open"]
      case "sticky": allowed = ["color", "xOffset", "yOffset", "caption"]
      case "slide-deck": allowed = ["data"]
      default: throw EditorError.unsupported("Structural setter belongs to #133")
      }
      guard changes.keys.allSatisfy(allowed.contains) else { throw EditorError.unsupported("Structural setter belongs to #133") }
      if original["type"] == "layout-container" {
        guard isEditable else { throw EditorError.unsupported("This document cannot be edited") }
        guard let key = NodeKey(keys[index]), let template = changes["templateColumns"]?.stringValue else { throw EditorError.invalidState("No column template") }
        return try commit { try $0.updateLayoutColumns(key, template: template) }
      }
      var replacement = original.objectValue!
      for (field, value) in changes { replacement[field] = value }
      return try replaceEmbeddedNode(key: keys[index], expected: original, replacement: .object(replacement), clearsSelection: original["type"] == "sticky" && (changes["xOffset"] != nil || changes["yOffset"] != nil))
    case .wait(let milliseconds):
      now += milliseconds
      return ChangeSet(changed: [])
    case .undo, .redo:
      let restored = command == .undo ? history.undo(at: now) : history.redo(at: now)
      guard let restored else { return ChangeSet(changed: []) }
      defer { state = restored }
      return ChangeSet(changed: restored.changedPaths(since: state))
    default:
      guard isEditable else {
        throw EditorError.unsupported("Editing a document with a node LexicalSwift doesn't edit yet")
      }
    }
    let saved = (state, nextKey, history, knowsListMarker)
    do {
      guard command == .cut else {
        let compositionEnd = if case .commitComposition = command { true } else { false }
        return try commit(compositionEnd: compositionEnd) { try $0.run(command, plainText: plainText) }
      }
      var isCutByATable = false
      let byATable = try commit { isCutByATable = try $0.cutHandler() }
      if isCutByATable { return byATable }
      // Rich text's cut is two updates: a copy, then a delete.
      let copied = try commit(tags: [.cut]) { try $0.copyForCut() }
      var changes = try commit(tags: [.cut]) { update in
        if let nodes = update.nodeSelection {
          for node in update.nodes(in: nodes) { try update.remove(node) }
          return
        }
        guard let selection = update.selection else { throw EditorError.noSelection }
        try update.removeText(selection)
      }
      changes.clipboard = plainText ? copied.clipboard.map { Clipboard(plainText: $0.plainText) } : copied.clipboard
      return changes
    } catch let failure as ShortcutFailure {
      throw failure.error
    } catch {
      (state, nextKey, history, knowsListMarker) = saved
      throw error
    }
  }

  public func replaceDrawing(key: String, expectedData: String, data: String?) throws -> ChangeSet {
    guard isEditable else { throw EditorError.unsupported("This document cannot be edited") }
    guard let key = NodeKey(key), let node = state.nodes[key],
      case .excalidraw(let drawing) = node.payload, (drawing.data?.stringValue ?? "[]") == expectedData
    else { throw EditorError.invalidState("The drawing changed while it was open") }
    return try commit { update in
      if let data {
        update.modify(key) { node in
          guard case .excalidraw(var drawing) = node.payload else { return }
          drawing.data = .string(data)
          node.payload = .excalidraw(drawing)
        }
      } else {
        try update.remove(key)
      }
    }
  }

  public func replaceRenderedNode(key: String, expected: JSONValue, replacement: JSONValue) throws -> ChangeSet {
    guard isEditable else { throw EditorError.unsupported("This document cannot be edited") }
    guard let key = NodeKey(key), let node = state.nodes[key],
      ["mermaid", "equation", "chart", "code"].contains(node.type),
      state.json(of: key) == expected, replacement["type"] == expected["type"]
    else { throw EditorError.invalidState("The node changed while its source was open") }
    return try commit { update in
      let new = try update.parse(replacement)
      var pending = [new]
      while let key = pending.popLast() {
        guard update.state[key].isEditable else { throw EditorError.invalidState("Unsupported rendered node fields") }
        pending.append(contentsOf: update.state.children(of: key))
      }
      try update.replace(key, with: new)
    }
  }

  public func replaceEmbeddedNode(key: String, expected: JSONValue, replacement: JSONValue?) throws -> ChangeSet {
    let moved = expected["type"] == "sticky" && replacement != nil &&
      (expected["xOffset"] != replacement?["xOffset"] || expected["yOffset"] != replacement?["yOffset"])
    return try replaceEmbeddedNode(key: key, expected: expected, replacement: replacement, clearsSelection: moved)
  }

  private func replaceEmbeddedNode(key: String, expected: JSONValue, replacement: JSONValue?, clearsSelection: Bool) throws -> ChangeSet {
    guard isEditable else { throw EditorError.unsupported("This document cannot be edited") }
    guard let key = NodeKey(key), let node = state.nodes[key], (node.isDecorator || Self.structuralTypes.contains(node.type)),
      state.json(of: key) == expected, replacement == nil || replacement?["type"] == expected["type"]
    else { throw EditorError.invalidState("The block changed while its editor was open") }
    guard let replacement else { return try commit { try $0.remove(key) } }
    // Load with the registered schemas before committing; unknown fields/nodes
    // cannot make an editable document silently become an approximated one.
    let validation = Editor()
    let validationChild: JSONValue = node.isInline
      ? ["type": "paragraph", "version": 1, "children": [replacement]] : replacement
    try validation.load(["root": ["type": "root", "version": 1, "children": [validationChild]]])
    guard validation.isEditable else { throw EditorError.unsupported("The replacement contains unported behavior (#133)") }
    let loaded = try validation.node(at: node.isInline ? [0, 0] : [0])
    return try commit { update in
      if clearsSelection { update.current = nil }
      if replacement["children"] != expected["children"], let children = loaded["children"]?.arrayValue {
        update.current = nil
        for child in Array(update.state.children(of: key)) { try update.remove(child, preservingEmptyParent: true) }
        try update.append(key, children.map { try update.parse($0) })
      }
      var fields = loaded.objectValue!
      fields["children"] = nil
      update.modify(key) { node in
        node.payload = SerializedNode(json: .object(fields)).asLoaded().preservingUnchangedUnreadFields(from: node.payload, before: expected, after: replacement)
      }
    }
  }

  private static let structuralTypes: Set<String> = [
    "callout", "collapsible-container", "collapsible-content", "collapsible-title",
    "layout-container", "layout-item", "page-break", "sticky", "slide-deck",
  ]

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
    update.plainText = plainText
    update.editorContext = editorContext
    update.tags = tags
    try run(&update)
    shortcutsDeclinedAsNotPorted += update.shortcutsDeclinedAsNotPorted
    let clipboard = update.clipboard
    var previous = state
    guard try commit(&update) else { return ChangeSet(changed: [], clipboard: clipboard) }
    var changed = update.changedKeys
    var compositionEnd = compositionEnd
    while !plainText, editorContext == .document || editorContext.mountedPlugins.contains("MarkdownShortcutPlugin"),
      let caret = state.markdownShortcutCaret(
        after: previous, dirtyLeaves: update.dirtyLeaves, compositionEnd: compositionEnd)
    {
      compositionEnd = false
      previous = state
      update = Update(state, nextKey: nextKey, revision: nextRevision(), knowsListMarker: knowsListMarker)
      update.editorContext = editorContext
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
    if update.unregisteredType != nil {
      throw EditorError.invalidState("Node type is not registered in \(editorContext.rawValue)")
    }
    try update.applyTransforms()
    if update.unregisteredType != nil {
      throw EditorError.invalidState("Node type is not registered in \(editorContext.rawValue)")
    }
    update.collectGarbage()
    if let selection = update.selection,
      update.state.nodes[selection.anchor.key] == nil || update.state.nodes[selection.focus.key] == nil
    {
      throw EditorError.invalidState("Selection has been lost")
    }
    let saved: KeySelection?
    let movesSelection: Bool
    switch update.current {
    case .range(let selection):
      saved = .range(selection.saved)
      movesSelection = selection.dirty || !selection.is(state.selection)
    case .table(let selection, let isDirty):
      saved = .table(selection)
      movesSelection = isDirty || saved != state.selection
    case .node(let selection) where selection.keys.isEmpty:
      saved = nil
      movesSelection = state.selection != nil
    case .node(let selection):
      saved = .node(selection.keys)
      movesSelection = selection.dirty || !selection.is(state.selection)
    case nil:
      saved = nil
      movesSelection = state.selection != nil
    }
    guard update.hasDirtyNodes || movesSelection else { return false }
    var next = update.state
    next.selection = saved
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
    Snapshot(state: try serializedState(), selection: try state.pathSelection())
  }

  public func serializedState() throws -> JSONValue {
    guard !state.nodes.isEmpty else { throw EditorError.invalidState("No document loaded") }
    return state.json
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
    return try state.pathSelection()
  }

  public func node(at path: [Int]) throws -> JSONValue {
    state.json(of: try key(at: path))
  }

  public func nodeForPresentation(at path: [Int]) throws -> JSONValue {
    state.json(of: try key(at: path), canonicalKeyOrder: false)
  }

  public func elementFormatting(at path: [Int]) throws -> JSONValue {
    let node = state[try key(at: path)]
    guard let fields = node.payload.elementFields else { throw EditorError.unsupported("Not an element") }
    let indent = node.type == SerializedListItemNode.type ? 0
      : (fields as? any FloatingElementFields)?.indent ?? fields.editorIndent.map(Double.init) ?? 0
    let direction: JSONValue
    if case .value(let value) = fields.direction { direction = .string(value.rawValue) } else { direction = .null }
    return ["type": .string(node.type), "direction": direction,
      "format": .string(fields.format?.rawValue ?? ""), "indent": .number(indent)]
  }

  public func nodeTextContent(at path: [Int]) throws -> String {
    state.textContent(of: try key(at: path))
  }

  public func childKeys(at path: [Int]) throws -> [String] {
    state.children(of: try key(at: path)).map(String.init)
  }

  public func nodePath(for key: String) throws -> [Int] {
    guard let key = NodeKey(key), let path = state.path(of: key) else {
      throw EditorError.invalidState("The structural block no longer exists")
    }
    return path
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
    case .lineBreak(let node): node.unknownFields.isEmpty || node.holdsOnlyAMarkdownHardLineBreak
    case .horizontalRule(let node): node.unknownFields.isEmpty
    case .image(let node): node.unknownFields.isEmpty && (node.showCaption != true || MediaCaptionSupport.refusal(in: node.caption?.json) == nil)
    case .inlineImage(let node): node.unknownFields.isEmpty && (node.showCaption != true || node.captionsEnabled == false || MediaCaptionSupport.refusal(in: node.caption?.json) == nil)
    case .video(let node): node.unknownFields.isEmpty && (node.showCaption != true || node.captionsEnabled != true || MediaCaptionSupport.refusal(in: node.caption) == nil)
    case .youTube(let node): node.unknownFields.isEmpty
    case .tweet(let node): node.unknownFields.isEmpty
    case .figma(let node): node.unknownFields.isEmpty
    case .link(let node): node.unknownFields.isEmpty
    case .autoLink(let node): node.unknownFields.isEmpty
    case .table(let node): node.unknownFields.isEmpty
    case .tableRow(let node): node.unknownFields.isEmpty
    case .tableCell(let node): node.unknownFields.isEmpty
    case .hTMLBlock: true
    case .documentCode(let node): node.unknownFields.isEmpty
    case .codeHighlight(let node): node.unknownFields.isEmpty && node.mode == .normal && (node.detail ?? 0) == 0
    case .mermaid(let node): node.unknownFields.isEmpty && (node.schema == nil || node.schema?.stringValue != nil)
    case .equation(let node): node.unknownFields.isEmpty && (node.equation == nil || node.equation?.stringValue != nil) && (node.inline == nil || node.inline?.boolValue != nil)
    case .chart(let node): node.unknownFields.isEmpty && (node.chartType == nil || RenderedEmbedStyle.chartTypes.contains(node.chartType?.stringValue ?? "")) && (node.chartData == nil || node.chartData?.stringValue != nil) && (node.chartConfig == nil || node.chartConfig?.stringValue != nil)

    case .callout(let node): node.unknownFields.isEmpty
    case .layoutContainer(let node): node.unknownFields.isEmpty
    case .layoutItem(let node): node.unknownFields.isEmpty
    case .collapsibleContainer(let node): node.unknownFields.isEmpty
    case .collapsibleContent(let node): node.unknownFields.isEmpty
    case .collapsibleTitle(let node): node.unknownFields.isEmpty
    case .pageBreak(let node): node.unknownFields.isEmpty
    case .sticky(let node):
      node.unknownFields.isEmpty && node.caption?.unknownFields.isEmpty != false && node.color.hasTypedShape()
    case .slide(let node): node.unknownFields.isEmpty && node.data.hasTypedShape()
    case .excalidraw(let node): node.unknownFields.isEmpty && (node.data == nil || node.data?.stringValue != nil)
    case .text(let node): node.unknownFields.isEmpty && node.mode == .normal && [0, 1].contains(node.detail ?? 0)
    case .hashtag(let node): node.unknownFields.isEmpty && node.mode == .normal && (node.detail ?? 0) == 0
    case .keyword(let node): node.unknownFields.isEmpty && node.detail?.numberValue == 0
      && node.text?.stringValue != nil && node.style?.stringValue != nil && node.format?.numberValue != nil
    case .emoji(let node): node.unknownFields.isEmpty && (node.mode == .normal || node.mode == .token)
      && node.detail?.numberValue == 0 && node.text?.stringValue != nil && node.style?.stringValue != nil
      && node.format?.numberValue != nil && node.className?.stringValue != nil
    case .mention(let node): node.unknownFields.isEmpty && (node.mode == .normal || node.mode == .segmented)
      && [0, 1].contains(node.detail?.numberValue) && node.text?.stringValue != nil && node.style?.stringValue != nil
      && node.format?.numberValue != nil && node.mentionName?.stringValue != nil
    case .comment(let node):
      if case .typed(let comment)? = node.comment { node.unknownFields.isEmpty && Self.supportsComment(comment) } else { false }
    case .thread(let node):
      if case .typed(let thread)? = node.thread {
        node.unknownFields.isEmpty && thread.unknownFields.isEmpty && thread.id != nil && thread.quote != nil
          && thread.type == .thread && thread.comments != nil && (thread.comments ?? []).allSatisfy(Self.supportsComment)
      } else { false }
    case .mark(let node): node.unknownFields.isEmpty
    case .footnoteDefinition(let node): node.unknownFields.isEmpty
    case .footnoteReference(let node): node.unknownFields.isEmpty && node.label?.stringValue != nil
    case .article(let node): Self.supportsArticle(node)
    case .poll(let node): Self.supportsPoll(node)
    case .tab(let node): node.unknownFields.isEmpty && node.detail == Double(TextDetail.unmergeable.rawValue)
    default: false
    }
  }

  private static func supportsArticle(_ node: SerializedArticleNode) -> Bool {
    guard node.unknownFields.isEmpty, ElementFormat(rawValue: node.format?.stringValue ?? "") != nil,
      case .typed(let data)? = node.data else { return false }
    switch data {
    case .url(let value):
      return value.mode == .url && value.url != nil && value.distilled?.title != nil && value.distilled?.contentHtml != nil
    case .entity(let value):
      return value.mode == .entity && value.entityId != nil && (value.snapshot == nil || (value.snapshot?.title != nil && value.snapshot?.contentHtml != nil))
    }
  }

  static func supportsComment(_ comment: Comment) -> Bool {
    comment.unknownFields.isEmpty && comment.author != nil && comment.content != nil && comment.deleted != nil
      && comment.id != nil && comment.timeStamp != nil && comment.type == .comment
  }

  private static func supportsPoll(_ node: SerializedPollNode) -> Bool {
    guard node.unknownFields.isEmpty, node.question?.stringValue != nil,
      case .typed(let options)? = node.options else { return false }
    return options.allSatisfy { $0.unknownFields.isEmpty }
  }

  /// The issue that ports editing nodes of this type, where one does.
  var portingIssue: Int? { Self.portingIssues[type] }

  private static let portingIssues: [String: Int] = [
    "table": 117, "tablerow": 117, "tablecell": 117,
    "image": 131, "inline-image": 131, "video": 131, "youtube": 131, "tweet": 131, "figma": 131,
    "code": 132, "code-highlight": 132, "mermaid": 132, "equation": 132, "chart": 132,
    "callout": 133, "collapsible-container": 133, "collapsible-content": 133, "collapsible-title": 133,
    "layout-container": 133, "layout-item": 133, "page-break": 133, "slide-deck": 133, "sticky": 133,
    "poll": 134, "comment": 134, "thread": 134, "mention": 134, "hashtag": 134, "emoji": 134, "keyword": 134,
    "footnote-definition": 134, "footnote-reference": 134, "article": 134, "mark": 134,
    "excalidraw": 139,
  ]
}

extension Optional {
  fileprivate func hasTypedShape<Value>() -> Bool where Wrapped == Shaped<Value> {
    if case .some(.stored) = self { return false }
    return true
  }
}

extension Update {
  mutating func run(_ command: EditorCommand, plainText: Bool = false) throws {
    if case .convertArticle(let path, let html) = command {
      guard !plainText else { throw EditorError.unsupported("Articles require rich text") }
      return try convertArticle(path: path, html: html)
    }
    if case .removeCommentAnnotations(let id) = command {
      guard !plainText else { throw EditorError.unsupported("Comments require rich text") }
      return try removeCommentAnnotations(id: id)
    }
    if case .saveCommentThread(let id, let thread) = command {
      guard !plainText else { throw EditorError.unsupported("Comments require rich text") }
      return try saveCommentThread(id: id, thread: thread)
    }
    if case .annotateComment(let id) = command {
      guard !plainText else { throw EditorError.unsupported("Comments require rich text") }
      guard let selection else { throw EditorError.noSelection }
      return try annotateComment(selection, id: id)
    }
    if case .appendComment(let json) = command {
      guard !plainText else { throw EditorError.unsupported("Comments require rich text") }
      guard json["type"] == "comment" || json["type"] == "thread" else { throw EditorError.invalidState("Not a comment marker") }
      let node = try parse(json)
      guard state[node].isEditable else { throw EditorError.unsupported("Unsupported comment fields (#134)") }
      try append(EditorState.rootKey, [node])
      return
    }
    if case .setSelection(let anchor, let focus) = command {
      return try placeSelection(anchor, focus)
    }
    if case .arrow(let key, let extend, let native, let atCellEdge, let parentRTL, let anchorRTL) = command {
      return try arrow(
        key, extend: extend, native: native, atCellEdge: atCellEdge, parentRTL: parentRTL,
        anchorRTL: anchorRTL ?? parentRTL)
    }
    if command == .selectAll {
      // Rich text answers what the table's handler leaves.
      if try !hasEditorPlugin("TablePlugin") || !selectAllCells() { selectAll() }
      return
    }
    if case .toggleChecked(let path) = command {
      return try toggleChecked(at: path)
    }
    if let tableSelection {
      return try run(command, onCells: tableSelection)
    }
    if let nodeSelection {
      return try run(command, onNodes: nodeSelection)
    }
    guard let selection else { throw EditorError.noSelection }
    if plainText {
      switch command {
      case .insertText(let text), .commitComposition(let text): try insertText(selection, text)
      case .insertParagraph, .insertLineBreak: try insertLineBreak(selection)
      case .deleteCharacter(let backward): try deleteCharacter(selection, backward: backward)
      case .deleteWord(let backward): try deleteWord(selection, backward: backward)
      case .deleteLine(let backward, let boundary):
        try deleteLine(
          selection, backward: backward,
          lineBoundary: KeyPoint(key: try pointNode(boundary), offset: boundary.offset, type: boundary.type))
      case .paste(let copied):
        tags.insert(.paste)
        try insertRawText(copied.plainText, lineBreaks: true)
      case .copy: if let copied = try copy(selection) { clipboard = Clipboard(plainText: copied.plainText) }
      default: break
      }
      return
    }
    switch command {
    case .insertText(let text), .commitComposition(let text): try insertText(selection, text)
    case .deleteCharacter(let backward):
      if hasEditorPlugin("TablePlugin"), try deleteCellHandler() { return }
      guard let grown = self.selection else { return }
      if backward { try backspace(grown) } else if !structuralDelete(grown) { try deleteCharacter(grown, backward: false) }
    case .deleteWord(let backward): try deleteWord(selection, backward: backward)
    case .deleteLine(let backward, let lineBoundary):
      let boundary = try pointNode(lineBoundary)
      try deleteLine(
        selection, backward: backward,
        lineBoundary: KeyPoint(key: boundary, offset: lineBoundary.offset, type: lineBoundary.type))
    case .insertParagraph:
      if try !structuralEnter(selection) {
        if editorContext != .document && !editorContext.mountedPlugins.contains("MarkdownShortcutPlugin") {
          try enter(selection)
        } else if try !runMarkdownShortcutOnEnter(selection) { try enter(selection) }
      }
    case .insertLineBreak: try insertLineBreak(selection)
    case .formatText(let format): try formatText(selection, format)
    case .formatCode: try formatCode(selection)
    case .setBlockType(let type): try setBlockType(selection, type)
    case .formatElement(let format): try formatElement(selection, format)
    case .changeFontSize(let increase): try changeFontSize(selection, increase: increase)
    case .clearFormatting: try clearFormatting(selection)
    case .setWritingDirection(let direction): try setWritingDirection(selection, direction)
    case .insertList(let listType): if editorContext == .document { try insertList(ListType(listType)) }
    case .removeList: if editorContext == .document { try removeList() }
    case .indent: try indentContent()
    case .outdent: try outdentContent()
    case .toggleLink(let url): try toggleLinkCommand(selection, url: url)
    case .editLink(let url): try editLink(selection, url: url)
    case .copy: clipboard = try copy(selection)
    case .paste(let clipboard): try paste(selection, clipboard)
    case .tab(let backward):
      if !hasEditorPlugin("TablePlugin") { try tab(selection, backward: backward) }
      else if try !tabHandler(backward: backward) { try tab(selection, backward: backward) }
    default: try runOnTable(command)
    }
  }

  /// A table selection, where each table's handlers answer first.
  private mutating func run(_ command: EditorCommand, onCells selection: TableSelection) throws {
    switch command {
    case .insertText, .commitComposition: clearSelection()
    case .deleteCharacter: _ = try deleteCellHandler()
    case .deleteWord, .deleteLine: try clearText(selection)
    case .setWritingDirection: break
    case .formatText(let format): try formatCells(selection, format)
    case .formatCode:
      let text = try textContent(selection)
      try insertNodes(selection, [create(SerializedDocumentCodeNode.type)])
      if let range = self.selection { try insertCodeSource(text, at: range) }
    case .setBlockType(let type): try setBlockType(selection, type)
    case .formatElement(let format): try formatElement(selection, format)
    case .changeFontSize(let increase): try changeFontSize(selection, increase: increase)
    case .clearFormatting: try clearFormatting(selection)
    // Rich text's Enter answers a range selection alone.
    case .insertParagraph, .insertLineBreak: break
    // Neither the table's Tab nor Tab indentation's answers cells.
    case .tab: break
    // `$toggleLink` leaves a table selection be.
    case .toggleLink, .editLink: break
    case .insertList(let listType): if editorContext == .document { try insertList(selection, ListType(listType)) }
    // `$removeList` and `$handleIndentAndOutdent` answer a range selection
    // alone.
    case .removeList, .indent, .outdent: break
    case .copy: clipboard = try copy(selection)
    case .paste(let clipboard): try paste(selection, clipboard)
    default: try runOnTable(command)
    }
  }

  /// Selected nodes, as an arrow or a deletion selects a rule, where rich
  /// text's handlers answer the web's keys and menus.
  private mutating func run(_ command: EditorCommand, onNodes selection: NodeSelection) throws {
    switch command {
    // A browser shows no caret to type at.
    case .insertText, .commitComposition: break
    case .deleteCharacter: try deleteNodes(selection)
    // Rich text deletes a word or a line from a range selection alone.
    case .deleteWord, .deleteLine: break
    case .insertParagraph: try enter(selection, lineBreak: false)
    case .insertLineBreak: try enter(selection, lineBreak: true)
    // `$updateTextFormat` formats inline nodes and `$setBlocksType` changes
    // elements, and a selected rule is neither.
    case .formatCode:
      let text = nodes(in: selection).map(state.textContent(of:)).joined()
      try insertNodes(selection, [create(SerializedDocumentCodeNode.type)])
      if let range = self.selection { try insertCodeSource(text, at: range) }
    case .formatText, .setBlockType, .setWritingDirection: break
    case .formatElement(let format): formatElements(nodes(in: selection), format)
    case .changeFontSize(let increase): try changeFontSizeOfNodes(nodes(in: selection), increase: increase)
    case .clearFormatting: break
    case .insertList(let listType): if editorContext == .document { try insertList(selection, ListType(listType)) }
    // `$removeList`, `$handleIndentAndOutdent` and Tab indentation answer a
    // range selection alone.
    case .removeList, .indent, .outdent, .tab: break
    case .toggleLink(let url): try toggleLinkCommand(selection, url: url)
    case .editLink(let url): try toggleLinkCommand(selection, url: WebLinks.sanitizeUrl(url))
    case .copy: clipboard = try copy(selection)
    case .paste(let clipboard): try paste(selection, clipboard)
    default: try runOnTable(command)
    }
  }

  /// The insert-table dialog and the table menu.
  private mutating func runOnTable(_ command: EditorCommand) throws {
    switch command {
    case .insertTable(let rows, let columns): if hasEditorPlugin("TablePlugin") { try insertDocumentTable(rows: rows, columns: columns) }
    case .insertTableRow(let after): try insertDocumentTableRows(after: after)
    case .insertTableColumn(let after): try insertDocumentTableColumns(after: after)
    case .deleteTableRow: try deleteTableRowAtSelection()
    case .deleteTable: try deleteTableFromMenu()
    case .toggleTableRowHeader: try toggleTableRowHeaderFromMenu()
    case .toggleTableColumnHeader: try toggleTableColumnHeaderFromMenu()
    case .setTableCellBackground(let color): try setTableCellBackgroundFromMenu(color)
    case .mergeTableCells: try mergeTableCellsFromMenu()
    case .unmergeTableCell: try unmergeTableCellFromMenu()
    case .deleteTableColumn: try deleteTableColumnAtSelection()
    default: throw EditorError.unsupported(command.name)
    }
  }

  /// `setSelection` in `reference/entry.ts`.
  mutating func placeSelection(_ anchorAt: Point, _ focusAt: Point) throws {
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
    if hasEditorPlugin("TablePlugin") { try fixRangeSelectionForSelectedTable(placed) }
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
  func pointNode(_ point: Point) throws -> NodeKey {
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
