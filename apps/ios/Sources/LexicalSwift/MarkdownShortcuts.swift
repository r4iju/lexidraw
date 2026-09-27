import JavaScriptCore
import OrderedCollections
import Synchronization

/// A markdown transformer as @lexical/markdown describes one.
/// `MarkdownTransformers.swift` lists the web editor's.
struct MarkdownTransformer: Sendable {
  enum Kind: Sendable {
    case element, multilineElement, textMatch, textFormat
  }

  let kind: Kind
  let name: Name
  /// `regExp`, or a multiline element transformer's `regExpStart`.
  var regExp: JSRegExp?
  var triggerOnEnter = false
  /// Whether a multiline element transformer needs a closing line, which
  /// typing never gives it.
  var isEndRequired = false
  var trigger: String?
  var tag = ""
  var formats: [TextFormatType] = []
  /// Whether a text format's tags may stand inside a word.
  var isIntraword = true
  /// The node types its `replace` can make, its `dependencies`.
  var makes: [String] = []

  /// The web's transformers LexicalSwift doesn't run yet, by the issue that
  /// ports each. Where one would turn what was typed into something else,
  /// the text stays as typed and no transformer after it runs, as none would
  /// after it on the web.
  static let notPortedYet: [Name: Int] = [
    .tweet: 131, .image: 131,
    .equation: 132, .code: 132,
    .table: 117,
    .emoji: 134,
    .link: 118,
  ]

  /// `compositionEndTriggerChars`: the characters that can finish a
  /// shortcut, a space or a trigger.
  static let compositionEndTriggers = Set(
    " ".utf16 + textFormat.compactMap(\.tag.utf16.last) + textMatch.compactMap { $0.trigger?.utf16.last })

  static let element = web.filter { $0.kind == .element }
  static let multilineElement = web.filter { $0.kind == .multilineElement }
  static let textMatch = web.filter { $0.kind == .textMatch }
  static let textFormat = web.filter { $0.kind == .textFormat }
}

/// A JavaScript regular expression. JavaScriptCore evaluates it, so it
/// matches as it does in the web editor.
struct JSRegExp: Sendable {
  let source: String
  let flags: String

  init(_ source: String, flags: String) {
    self.source = source
    self.flags = flags
  }

  /// `text.match(regExp)`: where the first match starts, in UTF-16 code
  /// units, and its groups, the whole match first.
  func firstMatch(in text: String) -> (index: Int, groups: [String?])? {
    let result = Self.match.withLock { $0.call(withArguments: [source, flags, text]) }
    guard let values = result?.toArray(), let index = values.first as? Int else { return nil }
    return (index, values.dropFirst().map { $0 as? String })
  }

  private static let match = Mutex(
    JSContext().evaluateScript(
      """
      const compiled = new Map();
      (source, flags, text) => {
        const key = `/${source}/${flags}`;
        if (!compiled.has(key)) compiled.set(key, new RegExp(source, flags));
        const match = text.match(compiled.get(key));
        return match && [match.index, ...Array.from(match, (group) => group ?? null)];
      }
      """
    )!
  )
}

extension EditorState {
  /// Where `registerMarkdownShortcuts`' update listener looks for a
  /// shortcut after an update from `previous` to this state: a caret that
  /// typing one character, or deleting, has just put in text, or that
  /// `compositionEnd` put after a character that can finish a shortcut.
  func markdownShortcutCaret(after previous: EditorState, dirtyLeaves: OrderedSet<NodeKey>, compositionEnd: Bool)
    -> KeyPoint?
  {
    guard let before = previous.selection, let after = selection, after.anchor == after.focus,
      compositionEnd || !RangeSelection(after).is(before)
    else { return nil }
    let anchor = after.anchor
    guard nodes[anchor.key]?.isText == true, dirtyLeaves.contains(anchor.key) else { return nil }
    if compositionEnd {
      let closeChar = Array(self[anchor.key].text.utf16)[safe: anchor.offset - 1]
      guard let closeChar, MarkdownTransformer.compositionEndTriggers.contains(closeChar) else { return nil }
    } else if anchor.offset != 1, offsetInParent(anchor) > previous.offsetInParent(before.anchor) + 1 {
      return nil
    }
    return anchor
  }

  /// `$getOffsetInParent`: a point's offset counted in characters from the
  /// start of its node's parent.
  private func offsetInParent(_ point: KeyPoint) -> Int {
    var offset = 0
    if self[point.key].isText {
      offset = point.offset
    } else if let children = self[point.key].children {
      offset = children.prefix(point.offset).reduce(0) { $0 + textContent(of: $1).utf16.count }
    }
    var sibling = previousSibling(of: point.key)
    while let current = sibling {
      offset += textContent(of: current).utf16.count
      sibling = previousSibling(of: current)
    }
    return offset
  }
}

extension Editor {
  /// The node types that only transformers not ported yet make, where
  /// LexicalSwift keeps as typed what Lexical makes one of these of.
  public static let typesMarkdownShortcutsNotPortedYetMake = Set(
    MarkdownTransformer.web.filter { MarkdownTransformer.notPortedYet[$0.name] != nil }.flatMap(\.makes))
}

/// Where a transformer not ported yet matches, which ends the shortcut.
private struct NotPortedYet: Error {}

/// `registerMarkdownShortcuts` from @lexical/markdown, with the web editor's
/// transformers.
extension Update {
  /// The update the listener queues: the shortcut the text before `caret`
  /// finishes, if there is one. Returns whether one ran, which starts an
  /// undo step of its own.
  mutating func runMarkdownShortcut(at caret: KeyPoint) throws -> Bool {
    let anchor = caret.key
    guard canContainTransformableMarkdown(anchor), let parent = state[anchor].parent,
      state[parent].type != SerializedDocumentCodeNode.type
    else { return false }
    let offset = caret.offset
    do {
      return try runElementTransformers(parent, anchor, offset, MarkdownTransformer.element)
        || runMultilineElementTransformers(parent, anchor, offset)
        || runTextMatchTransformers(anchor, offset)
        || runTextFormatTransformers(anchor, offset)
    } catch is NotPortedYet {
      shortcutsDeclinedAsNotPorted += 1
      return false
    }
  }

  /// The listener's Enter handler: a block shortcut finished by Enter at the
  /// end of its text rather than by a space. Returns whether it took Enter.
  mutating func runMarkdownShortcutOnEnter(_ selection: RangeSelection) throws -> Bool {
    guard selection.isCollapsed else { return false }
    let anchor = selection.anchor.key
    let offset = selection.anchor.offset
    guard state[anchor].isText, canContainTransformableMarkdown(anchor), let parent = state[anchor].parent,
      state[parent].type != SerializedDocumentCodeNode.type, offset == state.textSize(of: anchor)
    else { return false }
    do {
      return try runMultilineElementTransformers(parent, anchor, offset, onEnter: true)
        || runElementTransformers(
          parent, anchor, offset, MarkdownTransformer.element.filter(\.triggerOnEnter), onEnter: true)
    } catch is NotPortedYet {
      shortcutsDeclinedAsNotPorted += 1
      return false
    }
  }

  /// `canContainTransformableMarkdown`.
  private func canContainTransformableMarkdown(_ key: NodeKey) -> Bool {
    state[key].isText && !format(of: key).contains(.code)
  }

  // MARK: Blocks

  /// `runElementTransformers`: a block's first text, up to the caret, makes
  /// the block another.
  private mutating func runElementTransformers(
    _ parent: NodeKey, _ anchor: NodeKey, _ offset: Int, _ transformers: [MarkdownTransformer], onEnter: Bool = false
  ) throws -> Bool {
    try runBlockTransformers(parent, anchor, offset, transformers, onEnter: onEnter)
  }

  /// `runMultilineElementTransformers`: as `runElementTransformers`, for the
  /// opening line of a block that runs over several.
  private mutating func runMultilineElementTransformers(
    _ parent: NodeKey, _ anchor: NodeKey, _ offset: Int, onEnter: Bool = false
  ) throws -> Bool {
    try runBlockTransformers(
      parent, anchor, offset, MarkdownTransformer.multilineElement.filter { !$0.isEndRequired }, onEnter: onEnter)
  }

  private mutating func runBlockTransformers(
    _ parent: NodeKey, _ anchor: NodeKey, _ offset: Int, _ transformers: [MarkdownTransformer], onEnter: Bool
  ) throws -> Bool {
    guard startsTopLevelBlock(parent, anchor, offset, onEnter: onEnter) else { return false }
    let text = state[anchor].text
    for transformer in transformers {
      guard let match = transformer.regExp?.firstMatch(in: text), let whole = match.groups[0],
        whole.utf16.count == (onEnter || whole.hasSuffix(" ") ? offset : offset - 1)
      else { continue }
      if declines(transformer, parent) {
        // The web splits the text before its `replace` declines.
        _ = try splitBlockStart(anchor, offset)
        continue
      }
      try requirePorted(transformer)
      let (leading, children) = try splitBlockStart(anchor, offset)
      try replaceBlock(transformer, parent, children, match.groups)
      try remove(leading)
      return true
    }
    return false
  }

  /// Whether the caret ends the start of a block at the root, after a space
  /// unless Enter finishes the shortcut.
  private func startsTopLevelBlock(_ parent: NodeKey, _ anchor: NodeKey, _ offset: Int, onEnter: Bool) -> Bool {
    guard let grandparent = state[parent].parent, state[grandparent].isRootOrShadowRoot,
      state.firstChild(of: parent) == anchor
    else { return false }
    return onEnter || Array(state[anchor].text.utf16)[safe: offset - 1] == Self.space
  }

  /// Splits the shortcut's text off the block's first text, returning it and
  /// what follows it in the block.
  private mutating func splitBlockStart(_ anchor: NodeKey, _ offset: Int) throws -> (NodeKey, [NodeKey]) {
    let following = nextSiblings(of: anchor)
    let parts = try splitText(anchor, at: [offset])
    return (parts.first ?? anchor, Array(parts.dropFirst().prefix(1)) + following)
  }

  /// Ends the shortcut, leaving the text as typed, where the web would run
  /// a transformer LexicalSwift doesn't yet.
  private func requirePorted(_ transformer: MarkdownTransformer) throws {
    if MarkdownTransformer.notPortedYet[transformer.name] != nil { throw NotPortedYet() }
  }

  /// Whether a block transformer's `replace` leaves the block as it is.
  private func declines(_ transformer: MarkdownTransformer, _ parent: NodeKey) -> Bool {
    let type = state[parent].type
    switch transformer.name {
    // `$isUnreplaceableBlock`: typing a shortcut in a quote would drop the
    // quote (facebook/lexical#7407).
    case .heading, .code: return type == SerializedQuoteNode.type
    case .unorderedList, .orderedList, .checkList:
      return type == SerializedQuoteNode.type || type == SerializedHeadingNode.type
    // They make something only of imported markdown.
    case .callout, .admonition, .details, .columns, .blockEquation, .blockEquationFence, .article,
      .placeholderBlock, .footnoteDefinition:
      return true
    default: return false
    }
  }

  /// A block transformer's `replace`.
  private mutating func replaceBlock(
    _ transformer: MarkdownTransformer, _ parent: NodeKey, _ children: [NodeKey], _ groups: [String?]
  ) throws {
    switch transformer.name {
    case .heading:
      guard let hashes = groups[1], let tag = HeadingTag(rawValue: "h\(hashes.utf16.count)") else {
        throw EditorError.invalidState("HEADING matched no heading")
      }
      try replaceBlock(parent, with: createHeading(tag), children)
    case .quote:
      try replaceBlock(parent, with: create(SerializedQuoteNode.type), children)
    case .hr:
      let line = create(SerializedHorizontalRuleNode.type)
      if state.nextSibling(of: parent) != nil {
        try replace(parent, with: line)
      } else {
        try insert(line, before: parent)
      }
      selectNext(line)
    case .unorderedList: try replaceBlock(parent, withListItemOf: .bullet, children, groups)
    case .orderedList: try replaceBlock(parent, withListItemOf: .number, children, groups)
    case .checkList: try replaceBlock(parent, withListItemOf: .check, children, groups)
    default:
      throw EditorError.unsupported("The markdown shortcut \(transformer.name.rawValue)")
    }
  }

  /// `listReplace`: the block becomes an item of the list of `listType`
  /// beside it, or of a new one, nested as deep as the spaces and tabs
  /// before the marker say.
  private mutating func replaceBlock(
    _ parent: NodeKey, withListItemOf listType: ListType, _ children: [NodeKey], _ groups: [String?]
  ) throws {
    let previous = state.previousSibling(of: parent)
    let next = state.nextSibling(of: parent)
    let item = create(SerializedListItemNode.type)
    if listType == .check, case .listItem(var payload) = state[item].payload {
      payload.checked = groups[3]?.lowercased() == "x"
      state.nodes[item]!.payload = .listItem(payload)
    }
    let start = listType == .number ? groups[2].flatMap(Double.init) ?? 1 : 1
    // `match[0].trim()[0]`: the leading whitespace is group 1, which takes
    // all of it as JavaScript's `\s` and `trim` count it.
    let firstMatchChar = groups[0].flatMap { $0.unicodeScalars.dropFirst(groups[1]?.unicodeScalars.count ?? 0).first }
    let marker = listType != .number ? firstMatchChar.flatMap { ListMarker(rawValue: String($0)) } : nil
    let indent = Self.markdownIndent(groups[1] ?? "")
    if let next, self.listType(next) == listType {
      if let first = state.firstChild(of: next) {
        try insert(item, before: first)
      } else {
        try append(next, [item])
      }
      if listType == .number, indent == 0 { modifyList(next) { $0.start = start } }
      try remove(parent)
    } else if let previous, let previousType = self.listType(previous), previousType == listType || indent > 0 {
      try append(previous, [item])
      try remove(parent)
    } else {
      let list = createList(listType, start: start)
      try append(list, [item])
      try replace(parent, with: list)
    }
    try append(item, children)
    selectElement(item, 0, 0)
    if indent > 0 {
      try setIndent(item, indent)
      try retypeNestedList(item, listType, start: start)
    }
    if let marker, let list = state.parent(of: item), isList(list) {
      modifyList(list) { $0.setMarkdownMarker(marker) }
      knowsListMarker = true
    }
  }

  /// `getIndent`: a level for each tab, and for each four spaces.
  private static func markdownIndent(_ whitespace: String) -> Int {
    whitespace.count { $0 == "\t" } + whitespace.count { $0 == " " } / 4
  }

  /// `$retypeNestedList`: `setIndent` nests an item in a copy of the list it
  /// was in, so an item of another type moves out to a list of its own
  /// type, nested on the side of that copy the item was on.
  private mutating func retypeNestedList(_ item: NodeKey, _ listType: ListType, start: Double) throws {
    guard let nested = state.parent(of: item), let nestedType = self.listType(nested), nestedType != listType,
      let wrapper = state.parent(of: nested), isListItem(wrapper)
    else { return }
    let retyped = createList(listType, start: start)
    let isFirst = state.previousSibling(of: item) == nil
    try append(retyped, [item])
    let retypedWrapper = create(SerializedListItemNode.type)
    try append(retypedWrapper, [retyped])
    if isFirst {
      try insert(retypedWrapper, before: wrapper)
    } else {
      try insert(retypedWrapper, after: wrapper)
    }
    if state.childCount(of: nested) == 0 { try remove(wrapper) }
  }

  /// `createBlockNode`: `block` takes `children` and the place of `parent`,
  /// and the caret goes to its start.
  private mutating func replaceBlock(_ parent: NodeKey, with block: NodeKey, _ children: [NodeKey]) throws {
    try append(block, children)
    try replace(parent, with: block)
    selectElement(block, 0, 0)
  }

  // MARK: Text

  /// `runTextMatchTransformers`: the text before the caret, ending in a
  /// transformer's trigger, makes a node. A transformer with no trigger
  /// never runs.
  private mutating func runTextMatchTransformers(_ anchor: NodeKey, _ offset: Int) throws -> Bool {
    let units = Array(state[anchor].text.utf16)
    guard let trigger = units[safe: offset - 1].map({ String(decoding: [$0], as: UTF16.self) }) else { return false }
    let text = String(decoding: units.prefix(offset), as: UTF16.self)
    for transformer in MarkdownTransformer.textMatch where transformer.trigger == trigger {
      guard let regExp = transformer.regExp, regExp.firstMatch(in: text) != nil else { continue }
      try requirePorted(transformer)
      throw EditorError.unsupported("The markdown shortcut \(transformer.name.rawValue)")
    }
    return false
  }

  /// `$runTextFormatTransformers`: a closing tag typed after an opening one
  /// formats the text between them and removes both.
  private mutating func runTextFormatTransformers(_ anchor: NodeKey, _ offset: Int) throws -> Bool {
    let text = Array(state[anchor].text.utf16)
    let closeTagEnd = offset - 1
    guard let closeChar = text[safe: closeTagEnd] else { return false }
    for matcher in MarkdownTransformer.textFormat where matcher.tag.utf16.last == closeChar {
      let tag = Array(matcher.tag.utf16)
      let closeTagStart = closeTagEnd - tag.count + 1
      if tag.count > 1, !text.has(tag, at: closeTagStart) { continue }
      if text[safe: closeTagStart - 1] == Self.space { continue }
      if !matcher.isIntraword, let after = text[safe: closeTagEnd + 1], !Self.isPunctuationOrSpace(after) {
        continue
      }
      let closeNode = anchor
      var openNode = closeNode
      var openTagStart = Self.openTagStart(text, before: closeTagStart, tag)
      var sibling = openNode
      while openTagStart < 0, let previous = state.previousSibling(of: sibling) {
        sibling = previous
        if state[previous].isLineBreak { break }
        guard state[previous].isText, !format(of: previous).contains(.code) else { continue }
        let previousText = Array(state[previous].text.utf16)
        openNode = previous
        openTagStart = Self.openTagStart(previousText, before: previousText.count, tag)
      }
      if openTagStart < 0 { continue }
      if openNode == closeNode, openTagStart + tag.count == closeTagStart { continue }
      let openText = Array(state[openNode].text.utf16)
      if openTagStart > 0, openText[openTagStart - 1] == closeChar { continue }
      if !matcher.isIntraword, let before = openText[safe: openTagStart - 1], !Self.isPunctuationOrSpace(before) {
        continue
      }
      if !matcher.formats.contains(.code), Self.isInsideUnclosedCodeSpan(openText, openTagStart) { continue }

      let closeText = Array(text[..<closeTagStart] + text[(closeTagEnd + 1)...])
      try setText(closeNode, String(decoding: closeText, as: UTF16.self))
      let untagged = openNode == closeNode ? closeText : openText
      try setText(
        openNode,
        String(decoding: untagged[..<openTagStart] + untagged[(openTagStart + tag.count)...], as: UTF16.self))
      let selection = self.selection
      let formatted = makeSelection(
        KeyPoint(key: openNode, offset: openTagStart, type: .text),
        KeyPoint(key: closeNode, offset: closeTagEnd - tag.count * (openNode == closeNode ? 2 : 1) + 1, type: .text))
      for format in matcher.formats {
        try formatText(formatted, format, aligningWith: format.format)
      }
      formatted.anchor.set(formatted.focus.value)
      for format in matcher.formats where formatted.format.contains(format.format) {
        formatted.setFormat(format.toggled(in: formatted.format, aligningWith: nil))
      }
      if let selection { formatted.format = selection.format }
      return true
    }
    return false
  }

  /// `getOpenTagStartIndex`: the last `tag` starting before `end` that no
  /// space follows, or -1.
  private static func openTagStart(_ text: [UTF16.CodeUnit], before end: Int, _ tag: [UTF16.CodeUnit]) -> Int {
    var index = end
    while index >= tag.count {
      let start = index - tag.count
      if text.has(tag, at: start), text[safe: start + tag.count] != space { return start }
      index -= 1
    }
    return -1
  }

  /// `$isInsideUnclosedCodeSpan`: code spans take precedence over other
  /// formats, as CommonMark has it.
  private static func isInsideUnclosedCodeSpan(_ text: [UTF16.CodeUnit], _ offset: Int) -> Bool {
    text.prefix(offset).count { $0 == backtick } % 2 != 0
  }

  /// `PUNCTUATION_OR_SPACE` in @lexical/markdown.
  private static func isPunctuationOrSpace(_ character: UTF16.CodeUnit) -> Bool {
    punctuationOrSpace.firstMatch(in: String(decoding: [character], as: UTF16.self)) != nil
  }

  private static let punctuationOrSpace = JSRegExp("[!-/:-@[-`{-~\\s]", flags: "")
  private static let space = " ".utf16.first!
  private static let backtick = "`".utf16.first!
}

extension Array where Element == UTF16.CodeUnit {
  /// A JavaScript string's `text[index]`, which is undefined out of range.
  subscript(safe index: Int) -> UTF16.CodeUnit? {
    indices.contains(index) ? self[index] : nil
  }

  /// `isEqualSubString`.
  fileprivate func has(_ tag: [UTF16.CodeUnit], at start: Int) -> Bool {
    tag.indices.allSatisfy { self[safe: start + $0] == tag[$0] }
  }
}
