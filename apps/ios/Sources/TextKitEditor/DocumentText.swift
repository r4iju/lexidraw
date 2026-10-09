import CSSValues
import EditorModelInterface
import Foundation

// For `.link`.
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// A document as one text for TextKit: each block at the root on its own
/// line, kept in step with a model by what each update says it changed.
/// Offsets are UTF-16 code units, as the model's and `NSTextStorage`'s are.
///
/// A line break is U+2028, which breaks the line without ending the block,
/// and a node with no text of its own is one U+FFFC. Blocks nested in a
/// block, such as list items, table rows and cells, are set apart by a
/// newline inside it. Each list item's line says which item it is
/// (`.listItem`) and each indented block's lines how far in it is
/// (`.elementIndent`), the newline ending them included, for the layout to
/// show.
///
/// Each edit reports the blocks it replaced as splices, in order, for views
/// that keep something per block. The blocks a splice's `new` names are as
/// they are after the whole edit, which only the first splice renumbers.
public final class DocumentText {
  /// The attributes for text of `format` in a block of `blockType`, which
  /// for a heading is its tag.
  public typealias Style = (_ blockType: String, _ format: TextFormat) -> [NSAttributedString.Key: Any]
  /// The attributes of the one character that stands in for `node` in place
  /// of its text, or nil to show its text. `isBlock` says whether the node is
  /// a block at the root.
  public typealias StandIn = (_ node: JSONValue, _ isBlock: Bool) -> [NSAttributedString.Key: Any]?

  public struct Splice: Equatable, Sendable {
    public var old: Range<Int>
    public var new: Range<Int>

    public init(old: Range<Int>, new: Range<Int>) {
      self.old = old
      self.new = new
    }
  }

  /// A list item, for the layout to put its marker or checkbox beside it.
  struct ListItem: Hashable, Sendable {
    /// The item's path from the block at the root it is in.
    var path: [Int]
    /// The lists around the item, outermost first.
    var lists: [EditorCommand.ListType]
    var value: Int
    var checked: Bool
  }

  /// How a block at the root is laid out.
  public enum BlockKind: Equatable, Sendable {
    case text
    case table(Table)
    case embedded(type: String)
  }

  /// What a table's layout takes from its nodes.
  public struct Table: Equatable, Sendable {
    public struct Cell: Equatable, Sendable {
      /// The cell's text in the block.
      public var range: NSRange
      public var colSpan = 1
      public var rowSpan = 1
      /// A header cell, which Lexical writes as `th`.
      public var isHeader = false
      /// The colour the cell is filled with, as CSS gives it.
      public var backgroundColor: String?
      /// The width the cell is set to, in CSS pixels.
      public var width: Double?
      public var verticalAlign = VerticalAlign.top
    }

    /// Where a cell's text sits in the height of its rows: at the top, as
    /// `document.css` has it, unless the cell sets the middle or the
    /// bottom, which `TableCellNode` writes as its `vertical-align`.
    public enum VerticalAlign: String, Equatable, Sendable {
      case top, middle, bottom
    }

    /// Each row's cells, in the row's order.
    public var rows: [[Cell]]
    /// The widths the columns are set to, in CSS pixels, or nil where they
    /// fit their text.
    public var columnWidths: [Double]?
    /// Every second body row is shaded, as `rowStriping` sets it.
    public var rowStriping = false
    /// The first column stays put as the table scrolls, as a
    /// `frozenColumnCount` above 0 sets it on the web.
    public var freezesFirstColumn = false
  }

  private struct MentionPresentation {
    var style: String
    var tag: String
    var innerTag: String
    var effective: InlineCSS
  }
  private var mentions: [String: MentionPresentation] = [:]
  private var mentionsByBlock: [String: Set<String>] = [:]
  private func forgetMentions(in block: String) {
    for key in mentionsByBlock.removeValue(forKey: block) ?? [] { mentions[key] = nil }
  }

  private func liveMentionCSS(_ node: JSONValue, path: [Int], block: String) -> String {
    guard let index = path.last, let keys = try? model.childKeys(at: Array(path.dropLast())), keys.indices.contains(index) else { return WebSocialStyle.mentionCSS }
    let key = keys[index]
    mentionsByBlock[block, default: []].insert(key)
    let format = TextFormat(rawValue: node["format"]?.intValue ?? 0)
    // TextNode.updateDOM recreates the outer element when its tag changes.
    let tag = [(TextFormat.code, "code"), (.highlight, "mark"), (.subscript, "sub"), (.superscript, "sup"), (.bold, "strong"), (.italic, "em")]
      .first { format.contains($0.0) }?.1 ?? "span"
    let innerTag = format.contains(.bold) ? "strong" : format.contains(.italic) ? "em" : "span"
    let style = node["style"]?.stringValue ?? ""
    var presentation = mentions[key] ?? MentionPresentation(style: style, tag: tag, innerTag: innerTag, effective: InlineCSS(WebSocialStyle.mentionCSS))
    if presentation.tag != tag {
      presentation = MentionPresentation(style: style, tag: tag, innerTag: innerTag, effective: InlineCSS(WebSocialStyle.mentionCSS))
    } else if ["code", "mark", "sub", "sup"].contains(tag), presentation.innerTag != innerTag {
      // The upstream inner-element replacement returns before patching CSS.
      presentation.style = style
    } else if presentation.style != style {
      let previous = InlineCSS(presentation.style), next = InlineCSS(style)
      for property in previous.propertyNames where next[property] == nil { presentation.effective[property] = nil }
      for property in next.propertyNames {
        guard let value = next[property] else { continue }
        if ["color", "background-color"].contains(property), CSSColor(value) == nil { continue }
        presentation.effective[property] = value
      }
      presentation.style = style
    }
    presentation.innerTag = innerTag
    mentions[key] = presentation
    return presentation.effective.serialized
  }

  private let model: any EditorModel
  /// Element families supplied as native panels rather than flattened text.
  public var embeddedElementTypes: Set<String> = []
  var inheritedElementFormatting: [JSONValue] = []
  public var floatingEmbeddedTypes: Set<String> = []
  private var floatingByBlock: [String: [(key: String, node: JSONValue)]] = [:]
  var floatingNodes: [(key: String, node: JSONValue)] { floatingByBlock.values.flatMap { $0 } }
  private let style: Style
  private let standIn: StandIn?
  var nativeAttachment: ((JSONValue, [Int]) -> NSTextAttachment?)?
  private var blocks: [Block] = []
  /// Where each block starts, and the text's length last.
  private var starts: [Int] = [0]
  /// Set while an edit of the text's own has merged blocks, which only a
  /// fresh render can tell apart again.
  private var merged = false
  var externalResolvedCommentIDs: Set<String>?
  var externalFootnoteNumbers: [String: Int]?
  var rendersRootFootnotes = true
  var commentResolution: Set<String> { externalResolvedCommentIDs ?? resolvedCommentIDs }
  var referenceNumbers: [String: Int] { externalFootnoteNumbers ?? footnoteNumbers }
  var activeCommentIDs: Set<String> = []
  private var resolvedCommentIDs: Set<String> = []
  private var commentMetadataBlocks: Set<Int> = []
  private var footnoteNumbers: [String: Int] = [:]
  private var footnoteDefinitionNumbers: [Int: Int] = [:]
  private var hasFootnotes = false
  private var footnoteIndexDirty = true
  var footnoteSectionTitle = WebFootnoteStyle.titles[""]!

  public init(model: any EditorModel, style: @escaping Style, standIn: StandIn? = nil) {
    self.model = model
    self.style = style
    self.standIn = standIn
  }

  private static func applyFontGeometry(_ renderer: Renderer, to text: NSMutableAttributedString, base: [NSAttributedString.Key: Any]) {
    guard !renderer.resizedRanges.isEmpty else { return }
    #if canImport(UIKit)
    let naturalHeight = (base[.font] as? UIFont)?.lineHeight ?? 0
    #else
    let naturalHeight = (base[.font] as? NSFont).map { NSLayoutManager().defaultLineHeight(for: $0) } ?? 0
    #endif
    let cssHeight = (base[.paragraphStyle] as? NSParagraphStyle)?.minimumLineHeight ?? 0
    guard naturalHeight > 0, cssHeight > 0 else { return }
    let string = text.string as NSString
    var paragraphs = Set<NSRange>()
    for range in renderer.resizedRanges { paragraphs.insert(string.paragraphRange(for: NSRange(range))) }
    for range in paragraphs {
      let paragraph = (text.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
      // Keep the CSS ratio while each line's largest font sets its height.
      paragraph.minimumLineHeight = 0
      paragraph.maximumLineHeight = 0
      paragraph.lineHeightMultiple = cssHeight / naturalHeight
      text.addAttribute(.paragraphStyle, value: paragraph, range: range)
    }
  }

  /// A CSS line box grows to hold an inline image, where a paragraph's fixed
  /// line height would clip it and overlap the lines around it, so a
  /// paragraph with an attachment taller than its lines keeps their height
  /// only as their least.
  private static func fitAttachmentLines(in text: NSMutableAttributedString) {
    let string = text.string as NSString
    var paragraphs = Set<NSRange>()
    text.enumerateAttribute(.attachment, in: NSRange(location: 0, length: text.length)) { value, range, _ in
      guard let attachment = value as? NSTextAttachment,
        let style = text.attribute(.paragraphStyle, at: range.location, effectiveRange: nil) as? NSParagraphStyle,
        style.maximumLineHeight > 0, attachment.bounds.height > style.maximumLineHeight else { return }
      paragraphs.insert(string.paragraphRange(for: range))
    }
    for paragraph in paragraphs {
      text.enumerateAttribute(.paragraphStyle, in: paragraph) { value, range, _ in
        guard let style = (value as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle else { return }
        style.maximumLineHeight = 0
        text.addAttribute(.paragraphStyle, value: style, range: range)
      }
    }
  }

  /// Uses the document's own rich-text mapping for a nested media caption.
  static func caption(_ state: JSONValue, style: @escaping Style) -> NSAttributedString {
    guard let root = state["root"] else { return NSAttributedString() }
    var renderer = Renderer(style: style, standIn: nil, blockType: "paragraph", nativeAttachment: nil)
    renderer.add(root, at: [])
    let text = renderer.text
    text.append(NSAttributedString(string: "\n", attributes: style("paragraph", [])))
    for line in renderer.lines {
      let lower = max(0, line.range.lowerBound)
      let upper = min(text.length, line.range.upperBound)
      if upper > lower { text.addAttribute(line.key, value: line.value.base, range: NSRange(location: lower, length: upper - lower)) }
    }
    Self.applyFontGeometry(renderer, to: text, base: style("paragraph", []))
    if text.length > 0 { text.deleteCharacters(in: NSRange(location: text.length - 1, length: 1)) }
    return text
  }

  /// The text's length, the newline ending the last block included.
  public var length: Int { starts.last ?? 0 }

  public var blockCount: Int { blocks.count }

  /// The block's text, without the newline that ends it.
  public func range(ofBlock index: Int) -> NSRange {
    NSRange(location: starts[index], length: blocks[index].length)
  }

  public func kind(ofBlock index: Int) -> BlockKind { blocks[index].kind }

  func embeddedNode(at index: Int) -> (key: String, node: JSONValue)? {
    guard blocks.indices.contains(index), let node = try? model.nodeForPresentation(at: [index]) else { return nil }
    if let embedded = Self.decoratorInParagraph(node), let keys = try? model.childKeys(at: [index]), let key = keys.first {
      return (key, embedded)
    }
    return (blocks[index].key, node)
  }

  func payload(ofBlock index: Int) -> JSONValue? { embeddedNode(at: index)?.node }

  private static func decoratorInParagraph(_ node: JSONValue) -> JSONValue? {
    guard node["type"] == "paragraph", let children = node["children"]?.arrayValue, !children.isEmpty else { return nil }
    if children.allSatisfy({ $0["type"] == "comment" || $0["type"] == "thread" }) { return children[0] }
    guard children.count == 1,
      let type = children[0]["type"]?.stringValue,
      type == "comment" || type == "thread" || type == "excalidraw" || type == "poll" || type == "sticky" || type == "mermaid" || type == "chart" || (type == "equation" && children[0]["inline"] != true) || MediaPayload(children[0]) != nil else { return nil }
    return children[0]
  }

  /// The block's type, which for a heading is its tag.
  public func type(ofBlock index: Int) -> String { blocks[index].type }

  /// The index of the block `offset` is in, the newline ending it included.
  public func blockIndex(at offset: Int) -> Int {
    blocks.indices.lastIndex(bisecting: { starts[$0] <= offset })
  }

  /// Renders the whole document into `storage`, replacing what it held.
  @discardableResult public func reload(_ storage: NSMutableAttributedString) throws -> [Splice] {
    let old = blocks.count
    footnoteIndexDirty = true
    floatingByBlock.removeAll(keepingCapacity: true)
    let keys = try model.childKeys(at: [])
    let present = Set(keys)
    for block in blocks where !present.contains(block.key) { forgetMentions(in: block.key) }
    let (text, rendered) = try render(keys.indices) { keys[$0] }
    blocks = rendered
    merged = false
    storage.setAttributedString(text)
    measure()
    return [Splice(old: 0..<old, new: 0..<blocks.count)]
  }

  /// Brings `storage`, which holds what this last rendered, up to date with
  /// an update the model reported as `change`.
  @discardableResult public func update(_ storage: NSMutableAttributedString, after change: ChangeSet) throws
    -> [Splice]
  {
    let changedBlocks = Set(change.changed.compactMap(\.first))
    let includesFootnote = changedBlocks.contains { index in
      guard let node = try? model.nodeForPresentation(at: [index]) else { return false }
      return node["type"] == "footnote-definition" || Self.containsFootnote(node)
    }
    let rootChanged = change.changed.contains([])
    if rootChanged || !changedBlocks.isDisjoint(with: commentMetadataBlocks) || changedBlocks.contains(where: { index in
      guard let node = try? model.nodeForPresentation(at: [index]) else { return false }
      return !Self.commentThreads(in: node).isEmpty
    }) {
      let keys = try model.childKeys(at: [])
      let oldKeys = Set(blocks.map(\.key))
      let metadataKeys = Set(commentMetadataBlocks.compactMap { blocks.indices.contains($0) ? blocks[$0].key : nil })
      var candidates = changedBlocks
      for (index, key) in keys.enumerated() where metadataKeys.contains(key) || !oldKeys.contains(key) { candidates.insert(index) }
      var metadata: Set<Int> = []
      var resolved: Set<String> = []
      var seen: Set<String> = []
      for index in candidates.sorted() where keys.indices.contains(index) {
        let threads = Self.commentThreads(in: try model.nodeForPresentation(at: [index]))
        if !threads.isEmpty { metadata.insert(index) }
        for (id, isResolved) in threads where seen.insert(id).inserted {
          if isResolved { resolved.insert(id) }
        }
      }
      if resolved != resolvedCommentIDs { return try reload(storage) }
      commentMetadataBlocks = metadata
    }
    if merged || (hasFootnotes && change.changed.contains([])) || (!hasFootnotes && includesFootnote) { return try reload(storage) }
    if change.changed.contains([]) { footnoteIndexDirty = true }
    var splices: [Splice] = []
    var stale = Set(change.changed.compactMap(\.first))
    if change.changed.contains([]) {
      let keys = try model.childKeys(at: [])
      let old = blocks.map(\.key)
      var prefix = 0
      while prefix < min(old.count, keys.count), old[prefix] == keys[prefix] { prefix += 1 }
      var suffix = 0
      while suffix < min(old.count, keys.count) - prefix, old[old.count - 1 - suffix] == keys[keys.count - 1 - suffix] {
        suffix += 1
      }
      let present = Set(keys)
      for index in prefix..<(old.count - suffix) {
        floatingByBlock[old[index]] = nil
        if !present.contains(old[index]) { forgetMentions(in: old[index]) }
      }
      let replaced = prefix..<(keys.count - suffix)
      let (text, rendered) = try render(replaced) { keys[$0] }
      storage.replaceCharacters(
        in: NSRange(location: starts[prefix], length: starts[old.count - suffix] - starts[prefix]), with: text)
      blocks.replaceSubrange(prefix..<(old.count - suffix), with: rendered)
      measure()
      stale.subtract(replaced)
      splices.append(Splice(old: prefix..<(old.count - suffix), new: replaced))
    }
    for index in stale.sorted() {
      let key = blocks[index].key
      let (text, rendered) = try render(index..<(index + 1)) { _ in key }
      storage.replaceCharacters(in: NSRange(location: starts[index], length: starts[index + 1] - starts[index]), with: text)
      blocks[index] = rendered[0]
      measure()
      splices.append(Splice(old: index..<(index + 1), new: index..<(index + 1)))
    }
    return splices
  }

  /// Replaces `range` of `storage` with `text`, as a composition does before
  /// the model hears of it. An edit within a table cell keeps the table;
  /// any other edit of a block that isn't text, or across blocks, lays the
  /// blocks out as one text until the next update renders afresh.
  public func replace(_ storage: NSMutableAttributedString, in range: NSRange, with text: NSAttributedString)
    -> [Splice]
  {
    let first = blockIndex(at: range.location)
    let last = blockIndex(at: NSMaxRange(range))
    storage.replaceCharacters(in: range, with: text)
    var block = blocks[first]
    block.length = starts[last] + blocks[last].length - starts[first] + text.length - range.length
    var edited: Table?
    if case .table(let table) = block.kind, last == first {
      let local = NSRange(location: range.location - starts[first], length: range.length)
      edited = Self.table(table, replacing: local, withLength: text.length)
    }
    if let edited {
      block.kind = .table(edited)
    } else if last > first || block.kind != .text {
      block.kind = .text
      block.spans = [:]
      merged = true
    }
    blocks.replaceSubrange(first...last, with: [block])
    measure()
    return [Splice(old: first..<(last + 1), new: first..<(first + 1))]
  }

  func embeddedPath(at offset: Int) -> [Int]? {
    guard !blocks.isEmpty else { return nil }
    let index = blockIndex(at: offset)
    let local = offset - starts[index]
    return blocks[index].spans.first { _, span in
      if case .character = span.kind { return span.start <= local && local < span.end }
      return false
    }.map { [index] + $0.key }
  }

  /// Where `point` is in the text, or nil where the document has no such
  /// point.
  public func offset(of point: Point) -> Int? {
    guard let blockIndex = point.path.first else {
      guard (0...blocks.count).contains(point.offset), point.type == .element else { return nil }
      return point.offset < blocks.count ? starts[point.offset] : starts[blocks.count] - 1
    }
    guard blocks.indices.contains(blockIndex) else { return nil }
    let block = blocks[blockIndex]
    let path = Array(point.path.dropFirst())
    guard let span = block.spans[path] else { return nil }
    let start = starts[blockIndex]
    switch point.type {
    case .text:
      guard case .text = span.kind, point.offset <= span.end - span.start else { return nil }
      return start + span.start + point.offset
    case .element:
      guard case .element(let childCount) = span.kind, point.offset <= childCount else { return nil }
      if point.offset == childCount { return start + span.end }
      return block.spans[path + [point.offset]].map { start + $0.start }
    }
  }

  /// The text of the node at `path`, or nil where the document has no such
  /// node or it is the root.
  public func range(of path: [Int]) -> NSRange? {
    guard let blockIndex = path.first, blocks.indices.contains(blockIndex),
      let span = blocks[blockIndex].spans[Array(path.dropFirst())]
    else { return nil }
    return NSRange(location: starts[blockIndex] + span.start, length: span.end - span.start)
  }

  /// The point a browser resolves a caret at `offset` to: in the text before
  /// it where there is one, else in the text after it, else between the
  /// children of the innermost element around it.
  public func point(at offset: Int) -> Point {
    let offset = min(max(offset, 0), max(length - 1, 0))
    guard !blocks.isEmpty else { return Point(path: [], offset: 0, type: .element) }
    let blockIndex = blockIndex(at: offset)
    let local = offset - starts[blockIndex]
    let spans = blocks[blockIndex].spans
    let texts = spans.filter { if case .text = $0.value.kind { true } else { false } }
    if let (path, span) = texts.first(where: { $0.value.start < local && local <= $0.value.end })
      ?? texts.first(where: { $0.value.start == local })
    {
      return Point(path: [blockIndex] + path, offset: local - span.start, type: .text)
    }
    let around = spans.compactMap { path, span -> (path: [Int], childCount: Int)? in
      guard case .element(let childCount) = span.kind, span.start <= local, local <= span.end else { return nil }
      return (path, childCount)
    }
    guard let (path, childCount) = around.max(by: { $0.path.count < $1.path.count }) else {
      // A decorator's trailing spacer has no caret of its own. Resolve
      // it to the next block's innermost point, as that block's start does.
      if local != 0, blockIndex + 1 < blocks.count { return point(at: starts[blockIndex + 1]) }
      return Point(path: [], offset: local == 0 ? blockIndex : blockIndex + 1, type: .element)
    }
    let children = (0..<childCount).filter { (spans[path + [$0]]?.end ?? .max) <= local }
    return Point(path: [blockIndex] + path, offset: children.count, type: .element)
  }

  /// The attributes text of `format` typed at `offset` takes, which depend
  /// on the block it goes into.
  public func attributes(at offset: Int, format: TextFormat) -> [NSAttributedString.Key: Any] {
    guard !blocks.isEmpty else { return style("paragraph", format) }
    let index = blockIndex(at: offset)
    var attributes = style(blocks[index].type, format)
    for line in blocks[index].lines where line.range.contains(offset - starts[index]) {
      attributes[line.key] = line.value.base
    }
    return attributes
  }

  private func measure() {
    starts = [0]
    starts.reserveCapacity(blocks.count + 1)
    for block in blocks { starts.append(starts[starts.count - 1] + block.length + 1) }
  }

  /// The blocks at `indexes`, each followed by its newline.
  private func render(_ indexes: Range<Int>, key: (Int) -> String) throws -> (NSAttributedString, [Block]) {
    let text = NSMutableAttributedString()
    var rendered: [Block] = []
    var rootNodes: [Int: JSONValue] = [:]
    if footnoteIndexDirty {
      footnoteDefinitionNumbers = [:]
      footnoteNumbers = [:]
      hasFootnotes = false
      resolvedCommentIDs = []; commentMetadataBlocks = []
      var seenThreads: Set<String> = []
      for index in try model.childKeys(at: []).indices {
        let node = try model.nodeForPresentation(at: [index])
        rootNodes[index] = node
        let threads = Self.commentThreads(in: node)
        if !threads.isEmpty { commentMetadataBlocks.insert(index) }
        for (id, resolved) in threads where seenThreads.insert(id).inserted {
          if resolved { resolvedCommentIDs.insert(id) }
        }
        if rendersRootFootnotes, node["type"] == "footnote-definition" {
          footnoteDefinitionNumbers[index] = footnoteDefinitionNumbers.count + 1
          if let label = node["label"]?.stringValue, footnoteNumbers[label] == nil { footnoteNumbers[label] = footnoteNumbers.count + 1 }
        }
        hasFootnotes = hasFootnotes || node["type"] == "footnote-definition" || Self.containsFootnote(node)
      }
      footnoteIndexDirty = false
    }
    for index in indexes {
      let blockKey = key(index)
      let oldMentions = mentionsByBlock[blockKey] ?? []
      mentionsByBlock[blockKey] = []
      let node = try rootNodes[index] ?? model.nodeForPresentation(at: [index])
      var floating: [(key: String, node: JSONValue)] = []
      func collectFloating(_ value: JSONValue, at path: [Int]) throws {
        if floatingEmbeddedTypes.contains(value["type"]?.stringValue ?? ""), let last = path.last {
          let childKeys = try model.childKeys(at: Array(path.dropLast()))
          if childKeys.indices.contains(last) { floating.append((childKeys[last], value)) }
          return
        }
        for (child, value) in (value["children"]?.arrayValue ?? []).enumerated() {
          try collectFloating(value, at: path + [child])
        }
      }
      if !floatingEmbeddedTypes.isEmpty { try collectFloating(node, at: [index]) }
      floatingByBlock[key(index)] = floating.isEmpty ? nil : floating
      let blockType = (node["type"] == "heading" ? node["tag"] : node["type"])?.stringValue ?? ""
      let blockStyle = rendersRootFootnotes && node["type"] == "footnote-definition" ? Self.footnoteStyle(style) : style
      var renderer = Renderer(
        style: blockStyle, standIn: standIn, blockType: blockType,
        nativeAttachment: { [nativeAttachment, floatingEmbeddedTypes] child, path in
          if floatingEmbeddedTypes.contains(child["type"]?.stringValue ?? "") {
            let attachment = NSTextAttachment()
            attachment.bounds = .zero
            return attachment
          }
          return Self.decoratorInParagraph(node) == nil ? nativeAttachment?(child, [index] + path) : nil
        })
      for context in inheritedElementFormatting { renderer.inheritElementFormatting(context, context: true) }
      renderer.mentionCSS = { [self] value, path in liveMentionCSS(value, path: [index] + path, block: blockKey) }
      renderer.activeCommentIDs = activeCommentIDs
      renderer.resolvedCommentIDs = commentResolution
      renderer.footnoteNumbers = referenceNumbers
      if embeddedElementTypes.contains(blockType) {
        renderer.text.append(NSAttributedString(string: "\u{FFFC}", attributes: blockStyle(blockType, [])))
        renderer.spans[[]] = Span(start: 0, end: 1, kind: .character)
      } else {
        renderer.add(node, at: [])
      }
      for removed in oldMentions.subtracting(mentionsByBlock[blockKey] ?? []) { mentions[removed] = nil }
      let block = renderer.text
      rendered.append(
        Block(
          key: key(index), type: blockType, length: block.length, spans: renderer.spans,
          kind: Self.kind(of: node, spans: renderer.spans, floating: floatingEmbeddedTypes), lines: renderer.lines))
      block.append(NSAttributedString(string: "\n", attributes: blockStyle(blockType, [])))
      if let number = footnoteDefinitionNumbers[index] {
        var attributes: [NSAttributedString.Key: Any] = [.footnoteDefinitionNumber: number, .footnoteDefinitionLabel: node["label"]?.stringValue ?? ""]
        attributes[.footnoteBaseFont] = blockStyle(blockType, [])[.font]
        block.addAttributes(attributes, range: NSRange(location: 0, length: block.length))
      }
      for line in renderer.lines { block.addAttribute(line.key, value: line.value.base, range: NSRange(line.range)) }
      if renderer.contextPadding != ContextPadding() {
        block.addAttribute(.ancestorElementPadding, value: renderer.contextPadding, range: NSRange(location: 0, length: block.length))
      }
      Self.applyFontGeometry(renderer, to: block, base: blockStyle(blockType, []))
      Self.fitAttachmentLines(in: block)
      if footnoteDefinitionNumbers[index] != nil, index > 0,
        (rootNodes[index - 1] ?? (try? model.nodeForPresentation(at: [index - 1])))?["type"] != "footnote-definition" {
        let range = (block.string as NSString).paragraphRange(for: NSRange(location: 0, length: 0))
        let paragraph = (block.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
        #if canImport(UIKit)
        let size = (block.attribute(.footnoteBaseFont, at: 0, effectiveRange: nil) as? UIFont)?.pointSize ?? 17 * WebFootnoteStyle.definitionFontScale
        #else
        let size = (block.attribute(.footnoteBaseFont, at: 0, effectiveRange: nil) as? NSFont)?.pointSize ?? 17 * WebFootnoteStyle.definitionFontScale
        #endif
        paragraph.paragraphSpacingBefore = size * WebFootnoteStyle.sectionPadding
        block.addAttribute(.paragraphStyle, value: paragraph, range: range)
        block.addAttribute(.footnoteSectionTitle, value: footnoteSectionTitle, range: NSRange(location: 0, length: block.length))
      }
      text.append(block)
    }
    return (text, rendered)
  }

  private static func footnoteStyle(_ style: @escaping Style) -> Style {
    { block, format in
      var attributes = style(block, format)
      #if canImport(UIKit)
      if let font = attributes[.font] as? UIFont { attributes[.font] = font.withSize(font.pointSize * WebFootnoteStyle.definitionFontScale) }
      let font = attributes[.font] as? UIFont
      #else
      if let font = attributes[.font] as? NSFont { attributes[.font] = NSFont(descriptor: font.fontDescriptor, size: font.pointSize * WebFootnoteStyle.definitionFontScale) }
      let font = attributes[.font] as? NSFont
      #endif
      if let font {
        let paragraph = (attributes[.paragraphStyle] as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
        paragraph.paragraphSpacing = 0
        paragraph.minimumLineHeight = font.pointSize * WebFootnoteStyle.definitionLineHeight
        paragraph.maximumLineHeight = paragraph.minimumLineHeight
        paragraph.headIndent = font.pointSize * WebFootnoteStyle.definitionIndent
        paragraph.firstLineHeadIndent = paragraph.headIndent
        attributes[.paragraphStyle] = paragraph
      }
      return attributes
    }
  }

  private static func commentThreads(in node: JSONValue) -> [(String, Bool)] {
    let own: [(String, Bool)] = node["type"] == "thread" && node["thread"]?["id"]?.stringValue != nil
      ? [(node["thread"]!["id"]!.stringValue!, node["thread"]?["resolved"] == true)] : []
    return own + (node["children"]?.arrayValue ?? []).flatMap(commentThreads)
  }

  private static func containsFootnote(_ node: JSONValue) -> Bool {
    node["type"] == "footnote-reference" || (node["children"]?.arrayValue?.contains(where: containsFootnote) ?? false)
  }

  /// A table after `range` of it is replaced with text `length` long, or
  /// nil where the edit takes in more than one cell.
  private static func table(_ table: Table, replacing range: NSRange, withLength length: Int) -> Table? {
    var inOneCell = false
    var edited = table
    edited.rows = table.rows.map { row in
      row.map { cell in
        var cell = cell
        let text = cell.range
        if NSMaxRange(text) < range.location { return cell }
        if text.location > NSMaxRange(range) {
          cell.range.location += length - range.length
          return cell
        }
        guard text.location <= range.location, NSMaxRange(range) <= NSMaxRange(text) else { return cell }
        inOneCell = true
        cell.range.length += length - range.length
        return cell
      }
    }
    return inOneCell ? edited : nil
  }

  private static func kind(of node: JSONValue, spans: [[Int]: Span], floating: Set<String>) -> BlockKind {
    if let wrapped = decoratorInParagraph(node), let type = wrapped["type"]?.stringValue, !floating.contains(type) {
      return .embedded(type: type)
    }
    if node["type"] == "code" { return .embedded(type: "code") }
    switch spans[[]]?.kind {
    case .character: return .embedded(type: node["type"]?.stringValue ?? "")
    case .element(let rowCount) where node["type"] == "table":
      let rows = node["children"]?.arrayValue ?? []
      return .table(
        Table(
          rows: (0..<rowCount).map { row in
            guard case .element(let cellCount) = spans[[row]]?.kind else { return [] }
            let cells = rows[row]["children"]?.arrayValue ?? []
            return (0..<cellCount).compactMap { index in
              spans[[row, index]].map { span in
                let cell = cells[index]
                return Table.Cell(
                  range: NSRange(location: span.start, length: span.end - span.start),
                  colSpan: max(cell["colSpan"]?.intValue ?? 1, 1), rowSpan: max(cell["rowSpan"]?.intValue ?? 1, 1),
                  isHeader: (cell["headerState"]?.intValue ?? 0) != 0,
                  backgroundColor: cell["backgroundColor"]?.stringValue, width: cell["width"]?.numberValue,
                  verticalAlign: cell["verticalAlign"]?.stringValue.flatMap(Table.VerticalAlign.init) ?? .top)
              }
            }
          },
          columnWidths: node["colWidths"]?.arrayValue?.compactMap(\.numberValue),
          rowStriping: node["rowStriping"]?.boolValue ?? false,
          freezesFirstColumn: (node["frozenColumnCount"]?.numberValue ?? 0) > 0))
    default: return .text
    }
  }

  private struct Block {
    var key: String
    var type: String
    /// Without the newline that ends it.
    var length: Int
    /// Where each node in the block is, by its path from the block.
    var spans: [[Int]: Span]
    var kind: BlockKind
    /// What the lines of its items and indented blocks say, outermost first.
    var lines: [Line] = []
  }

  /// An attribute of whole lines: from a node's start to the newline after
  /// it, which an empty node's line is only.
  private struct Line {
    var range: Range<Int>
    var key: NSAttributedString.Key
    var value: AnyHashable
  }

  private struct Span {
    var start: Int
    var end: Int
    var kind: Kind

    enum Kind {
      case text
      case element(childCount: Int)
      /// A line break, or a node with no text of its own.
      case character
    }
  }

  private struct Renderer {
    let style: Style
    let standIn: StandIn?
    let blockType: String
    let nativeAttachment: ((JSONValue, [Int]) -> NSTextAttachment?)?
    var text = NSMutableAttributedString()
    var spans: [[Int]: Span] = [:]
    var lines: [Line] = []
    var resizedRanges: [Range<Int>] = []
    var activeCommentIDs: Set<String> = []
    var resolvedCommentIDs: Set<String> = []
    var footnoteNumbers: [String: Int] = [:]
    /// The lists around the node being added.
    private var lists: [EditorCommand.ListType] = []
    /// Where the text being added links to, as a link element's does unless
    /// it's an autolink undone.
    private var link: URL?
    private var inheritedParagraph: NSParagraphStyle?
    private var inheritedLogicalAlignment: String?
    var contextPadding = ContextPadding()

    init(style: @escaping Style, standIn: StandIn?, blockType: String, nativeAttachment: ((JSONValue, [Int]) -> NSTextAttachment?)?) {
      self.style = style
      self.standIn = standIn
      self.blockType = blockType
      self.nativeAttachment = nativeAttachment
    }

    mutating func inheritElementFormatting(_ node: JSONValue, context: Bool = false) {
      let format = node["format"]?.stringValue
      if node["type"] != "table", node["type"] != "tablerow", let format, !format.isEmpty {
        inheritedLogicalAlignment = format
      }
      if node["direction"]?.stringValue != nil || node["format"]?.stringValue?.isEmpty == false {
        let paragraph = (inheritedParagraph ?? style(blockType, [])[.paragraphStyle] as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
        let direction = node["direction"]?.stringValue
        if let direction { paragraph.baseWritingDirection = direction == "rtl" ? .rightToLeft : .leftToRight }
        switch inheritedLogicalAlignment {
        case "left": paragraph.alignment = .left
        case "center": paragraph.alignment = .center
        case "right": paragraph.alignment = .right
        case "justify": paragraph.alignment = .justified
        case "start": paragraph.alignment = paragraph.baseWritingDirection == .rightToLeft ? .right : .left
        case "end": paragraph.alignment = paragraph.baseWritingDirection == .rightToLeft ? .left : .right
        default: break
        }
        inheritedParagraph = paragraph
      }
      if context, let indent = node["indent"]?.numberValue, indent.isFinite {
        if inheritedParagraph?.baseWritingDirection == .rightToLeft { contextPadding.right += max(0, indent) }
        else { contextPadding.left += max(0, indent) }
      }
    }

    /// Inline elements, which sit in a line of text rather than on their own.
    var mentionCSS: ((JSONValue, [Int]) -> String)?

    private static let inlineElements: Set<String> = ["link", "autolink", "mark", "comment", "thread"]

    mutating func add(_ node: JSONValue, at path: [Int]) {
      let start = text.length
      let outerParagraph = inheritedParagraph, outerAlignment = inheritedLogicalAlignment
      defer { inheritedParagraph = outerParagraph; inheritedLogicalAlignment = outerAlignment }
      if Self.isBlock(node) { inheritElementFormatting(node) }
      if node["type"] == "comment" || node["type"] == "thread" {
        #if canImport(UIKit)
        let attachment = HiddenCommentAttachment()
        #else
        let attachment = NSTextAttachment()
        attachment.attachmentCell = nil
        #endif
        text.append(NSAttributedString(string: "\u{FFFC}", attributes: style(blockType, []).merging([.attachment: attachment]) { $1 }))
        spans[path] = Span(start: start, end: text.length, kind: .character)
        return
      }
      if node["type"] == "footnote-reference", let label = node["label"]?.stringValue {
        let marker = footnoteNumbers[label].map(String.init) ?? "\(label)?"
        var attributes = style(blockType, [.superscript])
        attributes[.footnoteReference] = label
        #if canImport(UIKit)
        attributes[.foregroundColor] = ThemeColor.primary.color
        if let font = attributes[.font] as? UIFont {
          attributes[.font] = UIFont(descriptor: font.fontDescriptor.addingAttributes([.traits: [UIFontDescriptor.TraitKey.weight: Typesetting.weight(Int(WebFootnoteStyle.referenceWeight))]]), size: font.pointSize)
        }
        #endif
        attributes[.attachment] = FootnoteReferenceAttachment(marker: marker, attributes: attributes)
        text.append(NSAttributedString(string: "\u{FFFC}", attributes: attributes))
        spans[path] = Span(start: start, end: text.length, kind: .character)
        return
      }
      if !path.isEmpty, let attachment = nativeAttachment?(node, path) {
        #if canImport(UIKit)
        (attachment as? MediaAttachment)?.captionStyle = style
        if let font = style(blockType, [])[.font] as? UIFont {
          (attachment as? any LazyTextAttachment)?.use(fontSize: Double(font.pointSize))
        }
        #endif
        text.append(NSAttributedString(string: "\u{FFFC}", attributes: style(blockType, []).merging([.attachment: attachment]) { $1 }))
        spans[path] = Span(start: start, end: text.length, kind: .character)
        return
      }
      if let standIn, let attributes = standIn(node, path.isEmpty) {
        #if canImport(UIKit)
        (attributes[.attachment] as? MediaAttachment)?.captionStyle = style
        #endif
        text.append(NSAttributedString(string: "\u{FFFC}", attributes: style(blockType, []).merging(attributes) { $1 }))
        spans[path] = Span(start: start, end: text.length, kind: .character)
        return
      }
      if let children = node["children"]?.arrayValue {
        let listType = node["type"] == "list" ? node["listType"]?.stringValue.flatMap(EditorCommand.ListType.init) : nil
        if let listType { lists.append(listType) }
        let lineCount = lines.count
        let outerLink = link
        defer { link = outerLink }
        if Self.inlineElements.contains(node["type"]?.stringValue ?? ""), node["isUnlinked"] != true,
          let url = node["url"]?.stringValue
        {
          link = URL(string: url)
        }
        for (index, child) in children.enumerated() {
          if index > 0, Self.isBlock(child) || Self.isBlock(children[index - 1]) {
            append("\n", format: [])
          }
          add(child, at: path + [index])
        }
        if listType != nil { lists.removeLast() }
        if node["type"] == "mark", let ids = node["ids"]?.arrayValue?.compactMap(\.stringValue), text.length > start {
          let highlight = CommentHighlight(ids: ids, resolved: ids.allSatisfy(resolvedCommentIDs.contains),
            active: ids.contains(where: activeCommentIDs.contains))
          var runs: [(NSRange, [CommentHighlight])] = []
          text.enumerateAttribute(.commentHighlights, in: NSRange(location: start, length: text.length - start)) { value, range, _ in
            runs.append((range, value as? [CommentHighlight] ?? []))
          }
          for (range, nested) in runs {
            text.addAttribute(.commentHighlights, value: [highlight] + nested, range: range)
            if nested.isEmpty {
              text.addAttributes([.commentIDs: ids, .commentResolved: highlight.resolved, .commentActive: highlight.active], range: range)
            }
          }
        }
        spans[path] = Span(start: start, end: text.length, kind: .element(childCount: children.count))
        if Self.isBlock(node), let paragraph = inheritedParagraph {
          lines.insert(Line(range: start..<(text.length + 1), key: .paragraphStyle, value: paragraph), at: lineCount)
        }
        if let line = line(for: node, at: path) {
          lines.insert(Line(range: start..<(text.length + 1), key: line.key, value: line.value), at: lineCount)
        }
        return
      }
      let kind: Span.Kind
      if node["type"] == "linebreak" {
        append("\u{2028}", format: [])
        kind = .character
      } else if let string = node["text"]?.stringValue {
        append(string, format: TextFormat(rawValue: node["format"]?.intValue ?? 0), css: node["type"] == "mention" ? mentionCSS?(node, path) ?? WebSocialStyle.mentionCSS : node["style"]?.stringValue ?? "",
          entity: node["type"]?.stringValue)
        kind = .text
      } else {
        append("\u{FFFC}", format: [])
        kind = .character
      }
      spans[path] = Span(start: start, end: text.length, kind: kind)
    }

    /// What the lines of `node` say: which item it is, where it is an item
    /// of its own text rather than of a nested list, or how far in it is.
    private func line(for node: JSONValue, at path: [Int]) -> (key: NSAttributedString.Key, value: AnyHashable)? {
      if node["type"] == "listitem" {
        let children = node["children"]?.arrayValue ?? []
        guard !children.contains(where: { $0["type"] == "list" }) else { return nil }
        let item = ListItem(
          path: path, lists: lists, value: node["value"]?.intValue ?? 1, checked: node["checked"]?.boolValue ?? false)
        return (.listItem, item)
      }
      guard let indent = node["indent"]?.numberValue, indent > 0 else { return nil }
      return (.elementIndent, indent)
    }

    private static func isBlock(_ node: JSONValue) -> Bool {
      node["children"] != nil && !inlineElements.contains(node["type"]?.stringValue ?? "")
    }

    /// `entity` comes before `css`, as a node's inline style outranks its
    /// theme class on the web.
    private mutating func append(_ string: String, format: TextFormat, css: String = "", entity type: String? = nil) {
      var attributes = style(blockType, format)
      #if canImport(UIKit)
      if let type, let entity = WebSocialStyle.entityText[type] {
        attributes[.foregroundColor] = entityColors[type]
        if let weight = entity.weight, let font = attributes[.font] as? UIFont,
          !font.fontDescriptor.symbolicTraits.contains(.traitBold) {
          attributes[.font] = UIFont(descriptor: font.fontDescriptor.addingAttributes([
            .traits: [UIFontDescriptor.TraitKey.weight: Typesetting.weight(weight).rawValue]
          ]), size: font.pointSize)
        }
      }
      #endif
      if !css.isEmpty {
        let inline = InlineCSS(css)
        for (property, key) in [("color", NSAttributedString.Key.foregroundColor), ("background-color", .backgroundColor)] {
          if let value = inline[property], let color = CSSColor(value) {
            #if canImport(UIKit)
            attributes[key] = UIColor(css: color)
            #else
            attributes[key] = NSColor(deviceRed: color.red, green: color.green, blue: color.blue, alpha: color.alpha)
            #endif
          }
        }
        if let rawSize = inline["font-size"], rawSize.hasSuffix("px"),
          let size = Double(rawSize.dropLast(2)), size.isFinite, size > 0 {
          resizedRanges.append(text.length..<(text.length + string.utf16.count))
          #if canImport(UIKit)
          if let font = attributes[.font] as? UIFont { attributes[.font] = font.withSize(size) }
          #else
          if let font = attributes[.font] as? NSFont { attributes[.font] = NSFont(descriptor: font.fontDescriptor, size: size) }
          #endif
        }
      }
      if let link { attributes[.link] = link }
      text.append(NSAttributedString(string: string, attributes: attributes))
    }
  }
}

/// The colour and weight the web theme gives a text entity node, as
/// WebSocialStyle reads them for hashtags and keywords.
struct EntityTextStyle: Sendable {
  var color: ThemeColor
  var weight: Int?
}

#if canImport(UIKit)
/// Made once: a dynamic colour equals only itself, and an edited run has to
/// equal the one a fresh render gives.
private let entityColors = WebSocialStyle.entityText.mapValues(\.color.color)
#endif

extension Range<Int> {
  /// The last index where `holds` does, for a test that holds up to some
  /// index and not after it; the first index where it holds for none.
  func lastIndex(bisecting holds: (Int) -> Bool) -> Int {
    var low = lowerBound
    var high = upperBound - 1
    while low < high {
      let middle = (low + high + 1) / 2
      if holds(middle) { low = middle } else { high = middle - 1 }
    }
    return low
  }
}

struct ContextPadding: Hashable {
  var left: Double = 0
  var right: Double = 0
}

extension NSAttributedString.Key {
  static let ancestorElementPadding = NSAttributedString.Key("TextKitEditor.ancestorElementPadding")
  static let commentIDs = NSAttributedString.Key("TextKitEditor.commentIDs")
  static let commentHighlights = NSAttributedString.Key("TextKitEditor.commentHighlights")
  static let commentResolved = NSAttributedString.Key("TextKitEditor.commentResolved")
  static let commentActive = NSAttributedString.Key("TextKitEditor.commentActive")
  static let footnoteReference = NSAttributedString.Key("TextKitEditor.footnoteReference")
  static let footnoteDefinitionNumber = NSAttributedString.Key("TextKitEditor.footnoteDefinitionNumber")
  static let footnoteBaseFont = NSAttributedString.Key("TextKitEditor.footnoteBaseFont")
  static let footnoteSectionTitle = NSAttributedString.Key("TextKitEditor.footnoteSectionTitle")
  static let footnoteDefinitionLabel = NSAttributedString.Key("TextKitEditor.footnoteDefinitionLabel")
  /// A `DocumentText.ListItem`, on the line of the item it describes.
  static let listItem = NSAttributedString.Key("TextKitEditor.listItem")
  /// How many levels in a block is indented, on its lines.
  static let elementIndent = NSAttributedString.Key("TextKitEditor.elementIndent")
}
