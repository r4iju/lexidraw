import JavaScriptCore
import Synchronization

/// `RangeSelection.deleteCharacter`, `deleteWord` and `deleteLine`, ported
/// from `reference/deletion.ts`, which LexicalSwift is held to.
extension Update {
  enum Granularity: Equatable {
    case character, word
    case lineBoundary(KeyPoint)
  }

  mutating func deleteCharacter(_ selection: RangeSelection, backward isBackward: Bool) throws {
    let wasCollapsed = selection.isCollapsed
    if selection.isCollapsed {
      let anchor = selection.anchor
      let initialCaret = try state.caret(from: anchor, isBackward ? .previous : .next)
      let initialRange = state.extendToRange(initialCaret)
      let (before, after) = state.textSlices(initialRange)
      if [before, after].allSatisfy({ ($0?.distance ?? 0) == 0 }) {
        enum Merge {
          case initial
          case nextBlock(NodeKey)
          case block(caret: Caret, block: NodeKey)
        }
        var merge = Merge.initial
        walk: for caret in state.nodeCarets(initialRange, .shadowRoot) {
          let origin = caret.origin
          let node = state[origin]
          if caret.isChild {
            if node.isInline {
              continue
            } else if node.isShadowRoot {
              throw EditorError.unsupported("Deleting into a shadow root")
            }
            switch merge {
            case .nextBlock(let block), .block(_, let block): merge = .block(caret: caret, block: block)
            case .initial: break
            }
          } else if case .block = merge {
            break walk
          } else if node.isElement {
            if !node.isInline {
              merge = .nextBlock(origin)
            } else if !hasAncestor(initialRange.anchor.origin, origin) {
              break walk
            }
          } else if node.isDecorator {
            throw EditorError.unsupported("Deleting a decorator")
          } else if node.isLineBreak {
            try remove(origin)
            return
          } else {
            break walk
          }
        }
        if case .block(let caret, let block) = merge {
          let origin = caret.origin
          if isEmpty(origin), !isEmpty(block), state.parent(of: origin) == state.parent(of: block) {
            try remove(origin, preservingEmptyParent: true)
            return
          }
          let anchor =
            !isEmpty(origin) && isEmpty(block)
            ? state.rewind(.sibling(block, caret.direction)) : initialRange.anchor
          updateSelection(selection, from: CaretRange(anchor: anchor, focus: caret))
          try removeText(selection)
          return
        }
      }
      try extendForDeletion(selection, backward: isBackward, .character)
      if !selection.isCollapsed {
        updateSelectionForUnicodeCharacter(selection, backward: isBackward)
      } else if isBackward, anchor.offset == 0, try collapseAtStart(selection, from: anchor.key) {
        return
      }
    }
    if !wasCollapsed { try expandToWholeDocument(selection) }
    try removeText(selection)
    if isBackward, !wasCollapsed, selection.isCollapsed, selection.anchor.type == .element,
      selection.anchor.offset == 0
    {
      let node = selection.anchor.key
      if isEmpty(node), state.parent(of: node).map({ state[$0].isRoot }) == true,
        state.previousSibling(of: node) == nil
      {
        _ = try collapseAtStart(selection, from: node)
      }
      try ensureRootHasParagraph()
    }
  }

  mutating func deleteWord(_ selection: RangeSelection, backward isBackward: Bool) throws {
    let wasCollapsed = selection.isCollapsed
    if selection.isCollapsed { try extendForDeletion(selection, backward: isBackward, .word) }
    if selection.isCollapsed {
      try deleteCharacter(selection, backward: isBackward)
    } else {
      if !wasCollapsed { try expandToWholeDocument(selection) }
      try removeText(selection)
    }
  }

  mutating func deleteLine(_ selection: RangeSelection, backward isBackward: Bool, lineBoundary: KeyPoint) throws {
    let wasCollapsed = selection.isCollapsed
    if selection.isCollapsed { try extendForDeletion(selection, backward: isBackward, .lineBoundary(lineBoundary)) }
    if selection.isCollapsed {
      try deleteCharacter(selection, backward: isBackward)
    } else if findParent(from: selection.anchor.key, where: isBlock)
      != findParent(from: selection.focus.key, where: isBlock)
    {
      let anchor = selection.anchor
      selection.focus.set(anchor.value)
      try deleteCharacter(selection, backward: isBackward)
    } else {
      if !wasCollapsed { try expandToWholeDocument(selection) }
      try removeText(selection)
    }
  }

  // MARK: Lexical's helpers

  private mutating func ensureRootHasParagraph() throws {
    let root = EditorState.rootKey
    guard isEmpty(root) else { return }
    let paragraph = create(SerializedParagraphNode.type)
    try append(root, [paragraph])
    selectElement(paragraph)
  }

  /// `$collapseAtStart`: the blocks the caret starts decide what backspace
  /// at their start does.
  private mutating func collapseAtStart(_ selection: RangeSelection, from start: NodeKey) throws -> Bool {
    var current: NodeKey? = start
    while let node = current {
      if state[node].isElement {
        if try collapseElementAtStart(node) { return true }
        if state[node].isRootOrShadowRoot { break }
      }
      if state.previousSibling(of: node) != nil { break }
      current = state.parent(of: node)
    }
    return false
  }

  /// `collapseAtStart` of the root, which keeps the caret where it is, and
  /// of a paragraph, which goes when it holds only blank text.
  private mutating func collapseElementAtStart(_ key: NodeKey) throws -> Bool {
    if state[key].isRoot { return true }
    guard state[key].type == SerializedParagraphNode.type else { return false }
    let isBlank = state.children(of: key).allSatisfy { child in
      state[child].isText && state[child].text.unicodeScalars.allSatisfy(\.isJavaScriptWhitespace)
    }
    guard isBlank else { return false }
    if state.nextSibling(of: key) != nil {
      selectNext(key)
    } else if state.previousSibling(of: key) != nil {
      selectPrevious(key)
    } else {
      return false
    }
    try remove(key)
    return true
  }

  /// `INTERNAL_$expandSelectionToWholeDocument`.
  private func expandToWholeDocument(_ selection: RangeSelection) throws {
    let root = EditorState.rootKey
    guard !isEmpty(root), try isFullySelected(root, selection) else { return }
    selection.anchor.set(root, 0, .element)
    selection.focus.set(root, state.childCount(of: root), .element)
  }

  /// `$isBlockFullySelected`.
  private func isFullySelected(_ block: NodeKey, _ selection: RangeSelection) throws -> Bool {
    let range = state.inDirection(try state.caretRange(from: selection), .next)
    let start = state.normalize(.child(block, .next))
    let end = state.inDirection(state.normalize(.child(block, .previous)), .next)
    return state.compareNext(range.anchor, start) <= 0 && state.compareNext(range.focus, end) >= 0
  }

  /// `$updateCaretSelectionForUnicodeCharacter`: a deletion of more than one
  /// code unit shrinks to one unless it's a surrogate pair or an emoji.
  private func updateSelectionForUnicodeCharacter(_ selection: RangeSelection, backward isBackward: Bool) {
    let (anchor, focus) = (selection.anchor, selection.focus)
    guard anchor.key == focus.key, anchor.type == .text, focus.type == .text else { return }
    let start = min(anchor.offset, focus.offset)
    let end = max(anchor.offset, focus.offset)
    let characterOffset = end - 1
    guard start != characterOffset else { return }
    let units = Array(state[anchor.key].text.utf16)[start..<end]
    let hasSurrogatePair = zip(units, units.dropFirst()).contains {
      UTF16.isLeadSurrogate($0) && UTF16.isTrailSurrogate($1)
    }
    let hasEmoji = String(decoding: units, as: UTF16.self).unicodeScalars.contains(where: \.properties.isEmoji)
    guard !hasSurrogatePair, !hasEmoji else { return }
    if isBackward {
      focus.set(focus.key, characterOffset, focus.type)
    } else {
      anchor.set(anchor.key, characterOffset, anchor.type)
    }
  }

  /// `$extendSelectionForDeletion`: moves the focus as far as the deletion
  /// reaches.
  private mutating func extendForDeletion(
    _ selection: RangeSelection, backward isBackward: Bool, _ granularity: Granularity
  ) throws {
    if try extendAroundBlocks(selection, backward: isBackward, granularity) { return }
    let anchor = selection.anchor
    let anchorNode = anchor.key
    let anchorOffset = anchor.offset
    let wasCollapsed = selection.isCollapsed
    let landed: KeyPoint
    if case .lineBoundary(let boundary) = granularity {
      landed = boundary
    } else {
      guard let measured = measure(selection.focus, backward: isBackward, byWord: granularity == .word) else { return }
      landed = measured
    }
    if wasCollapsed, granularity == .character, anchor.type == .text {
      let edgeOffset = isBackward ? 0 : state.textSize(of: anchorNode)
      let clampedOffset =
        landed.key == anchor.key && landed.type == .text
        ? landed.offset : anchorOffset != edgeOffset ? edgeOffset : -1
      if clampedOffset >= 0 {
        if clampedOffset != anchorOffset {
          selection.focus.set(anchor.key, clampedOffset, .text)
          selection.dirty = true
        }
        return
      }
    }
    let origin = anchor.value
    let (start, end) = isBackward ? (landed, origin) : (origin, landed)
    let root = state[anchorNode].isRoot ? anchorNode : nearestRootOrShadowRoot(anchorNode)
    try applyRange(selection, start, end)
    selection.dirty = true
    if try !shrinkToRoot(selection, backward: isBackward, root), isBackward {
      swapPoints(selection)
    }
  }

  /// `measure` in `reference/deletion.ts`.
  private func measure(_ point: SelectionPoint, backward isBackward: Bool, byWord: Bool) -> KeyPoint? {
    let element = point.type == .text ? state.parent(of: point.key) : point.key
    guard let element, state[element].isElement else { return nil }
    let children = Array(state.children(of: element))
    guard children.allSatisfy({ state[$0].isText || state[$0].isLineBreak }) else { return nil }
    var starts: [Int] = []
    var text: [UTF16.CodeUnit] = []
    for child in children {
      starts.append(text.count)
      text += state.textContent(of: child).utf16
    }
    let from =
      point.type == .text
      ? (state.index(of: point.key).map { starts[$0] } ?? 0) + point.offset
      : (starts.indices.contains(point.offset) ? starts[point.offset] : text.count)
    let to = landing(String(decoding: text, as: UTF16.self), from, backward: isBackward, byWord: byWord)
    if to == from { return point.value }
    let crossed = isBackward ? to : to - 1
    var at = 0
    while at + 1 < starts.count, starts[at + 1] <= crossed { at += 1 }
    if children.indices.contains(at), state[children[at]].isText {
      return KeyPoint(key: children[at], offset: to - starts[at], type: .text)
    }
    let besideIndex = isBackward ? at - 1 : at + 1
    if children.indices.contains(besideIndex), state[children[besideIndex]].isText {
      let beside = children[besideIndex]
      return KeyPoint(key: beside, offset: isBackward ? state.textSize(of: beside) : 0, type: .text)
    }
    return KeyPoint(key: element, offset: isBackward ? at : at + 1, type: .element)
  }

  private func landing(_ text: String, _ from: Int, backward isBackward: Bool, byWord: Bool) -> Int {
    let units = byWord ? text.wordSegments : text.graphemeSegments
    let ahead = isBackward ? Array(units.filter { $0.start < from }.reversed()) : units.filter { $0.end > from }
    if !byWord {
      guard let unit = ahead.first else { return from }
      return isBackward ? unit.start : unit.end
    }
    var crossed = ahead.prefix { !$0.isWord }.count
    if crossed < ahead.count { crossed += 1 }
    guard crossed > 0 else { return from }
    let last = ahead[crossed - 1]
    return isBackward ? last.start : last.end
  }

  /// `RangeSelection.applyDOMRange` for the points `measure` gives.
  private func applyRange(_ selection: RangeSelection, _ start: KeyPoint, _ end: KeyPoint) throws {
    let anchor = selection.clone().anchor
    let focus = selection.clone().focus
    anchor.set(start)
    focus.set(end)
    try normalizePointsForBoundaries(anchor, focus)
    selection.anchor.set(anchor.value, onlyIfChanged: true)
    selection.focus.set(focus.value, onlyIfChanged: true)
    normalizeSelection(selection)
  }

  private mutating func shrinkToRoot(_ selection: RangeSelection, backward isBackward: Bool, _ root: NodeKey) throws
    -> Bool
  {
    let nodes = try nodes(in: selection)
    let valid = nodes.filter { hasAncestor($0, root) }
    guard !valid.isEmpty, valid.count != nodes.count, let edge = isBackward ? valid.first : valid.last else {
      return false
    }
    let element = state[edge].isElement ? edge : state.parent(of: edge)!
    if isBackward {
      selectStart(element)
    } else {
      selectEnd(element)
    }
    return true
  }

  private func swapPoints(_ selection: RangeSelection) {
    let anchor = selection.anchor.value
    let focus = selection.focus
    selection.anchor.set(focus.value, onlyIfChanged: true)
    focus.set(anchor, onlyIfChanged: true)
  }

  /// `$modifySelectionAroundDecoratorsAndBlocks` extending a selection: a
  /// focus at the end of a block reaches into the block beside it.
  private func extendAroundBlocks(_ selection: RangeSelection, backward isBackward: Bool, _ granularity: Granularity)
    throws -> Bool
  {
    let initialFocus = try state.caret(from: selection.focus, isBackward ? .previous : .next)
    var focus = initialFocus
    if !state.isExtendableTextCaret(focus), state.nodeAtCaret(focus) == nil {
      for caret in state.nodeCarets(state.extendToRange(initialFocus), .shadowRoot) {
        if caret.isChild {
          if !state[caret.origin].isInline { focus = caret }
        } else if state[caret.origin].isElement {
          continue
        } else if state[caret.origin].isDecorator, !state[caret.origin].isInline {
          focus = caret
        }
        break
      }
    }
    guard focus != initialFocus else { return false }
    setPoint(selection.focus, from: state.normalize(focus))
    return true
  }
}

extension Unicode.Scalar {
  /// Whether JavaScript's `\s` matches it.
  var isJavaScriptWhitespace: Bool {
    switch value {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
    default: false
    }
  }
}

/// A run of text by UTF-16 offsets, and whether it is a word.
typealias Segment = (start: Int, end: Int, isWord: Bool)

extension String {
  var graphemeSegments: [Segment] {
    var segments: [Segment] = []
    var offset = 0
    for character in self {
      segments.append((offset, offset + character.utf16.count, false))
      offset += character.utf16.count
    }
    return segments
  }

  /// `Intl.Segmenter`'s words: ICU's word break iterator says where words
  /// end and which segments are words, as it does for the reference and for
  /// WebKit on the same OS. Its rules change between OS releases, and
  /// JavaScriptCore is the only public API on Apple platforms that exposes
  /// them.
  var wordSegments: [Segment] {
    let segments = Self.segmentWords.withLock { $0.call(withArguments: [self]).toArray() as? [[Int]] } ?? []
    return segments.map { ($0[0], $0[1], $0[2] == 1) }
  }

  private static let segmentWords = Mutex(
    JSContext().evaluateScript(
      """
      const segmenter = new Intl.Segmenter("en", { granularity: "word" });
      (text) => Array.from(segmenter.segment(text), ({ index, segment, isWordLike }) =>
        [index, index + segment.length, isWordLike ? 1 : 0]);
      """
    )!
  )
}
