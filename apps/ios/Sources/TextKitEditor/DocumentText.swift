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
  }

  private let model: any EditorModel
  private let style: Style
  private let standIn: StandIn?
  var nativeAttachment: ((JSONValue, [Int]) -> NSTextAttachment?)?
  private var blocks: [Block] = []
  /// Where each block starts, and the text's length last.
  private var starts: [Int] = [0]
  /// Set while an edit of the text's own has merged blocks, which only a
  /// fresh render can tell apart again.
  private var merged = false

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
    guard node["type"] == "paragraph", let children = node["children"]?.arrayValue, children.count == 1,
      let type = children[0]["type"]?.stringValue,
      type == "excalidraw" || (type != "inline-image" && MediaPayload(children[0]) != nil) else { return nil }
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
    let keys = try model.childKeys(at: [])
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
    if merged { return try reload(storage) }
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
    for index in indexes {
      let node = try model.nodeForPresentation(at: [index])
      let blockType = (node["type"] == "heading" ? node["tag"] : node["type"])?.stringValue ?? ""
      var renderer = Renderer(style: style, standIn: standIn, blockType: blockType,
        nativeAttachment: { [nativeAttachment] child, path in
          Self.decoratorInParagraph(node) == nil ? nativeAttachment?(child, [index] + path) : nil
        })
      renderer.add(node, at: [])
      let block = renderer.text
      rendered.append(
        Block(
          key: key(index), type: blockType, length: block.length, spans: renderer.spans,
          kind: Self.kind(of: node, spans: renderer.spans), lines: renderer.lines))
      block.append(NSAttributedString(string: "\n", attributes: style(blockType, [])))
      for line in renderer.lines { block.addAttribute(line.key, value: line.value.base, range: NSRange(line.range)) }
      Self.applyFontGeometry(renderer, to: block, base: style(blockType, []))
      text.append(block)
    }
    return (text, rendered)
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

  private static func kind(of node: JSONValue, spans: [[Int]: Span]) -> BlockKind {
    if let embedded = decoratorInParagraph(node), let type = embedded["type"]?.stringValue { return .embedded(type: type) }
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
          columnWidths: node["colWidths"]?.arrayValue?.compactMap(\.numberValue)))
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
    /// The lists around the node being added.
    private var lists: [EditorCommand.ListType] = []
    /// Where the text being added links to, as a link element's does unless
    /// it's an autolink undone.
    private var link: URL?

    init(style: @escaping Style, standIn: StandIn?, blockType: String, nativeAttachment: ((JSONValue, [Int]) -> NSTextAttachment?)?) {
      self.style = style
      self.standIn = standIn
      self.blockType = blockType
      self.nativeAttachment = nativeAttachment
    }

    /// Inline elements, which sit in a line of text rather than on their own.
    private static let inlineElements: Set<String> = ["link", "autolink", "mark"]

    mutating func add(_ node: JSONValue, at path: [Int]) {
      let start = text.length
      if !path.isEmpty, let attachment = nativeAttachment?(node, path) {
        #if canImport(UIKit)
        (attachment as? MediaAttachment)?.captionStyle = style
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
        spans[path] = Span(start: start, end: text.length, kind: .element(childCount: children.count))
        if Self.isBlock(node), node["direction"]?.stringValue != nil || node["format"]?.stringValue?.isEmpty == false {
          let paragraph = (style(blockType, [])[.paragraphStyle] as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle ?? NSMutableParagraphStyle()
          let direction = node["direction"]?.stringValue
          if let direction { paragraph.baseWritingDirection = direction == "rtl" ? .rightToLeft : .leftToRight }
          switch node["type"] == "table" || node["type"] == "tablerow" ? nil : node["format"]?.stringValue {
          case "left": paragraph.alignment = .left
          case "center": paragraph.alignment = .center
          case "right": paragraph.alignment = .right
          case "justify": paragraph.alignment = .justified
          case "start": paragraph.alignment = direction == "rtl" ? .right : .left
          case "end": paragraph.alignment = direction == "rtl" ? .left : .right

          default: break
          }
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
        append(string, format: TextFormat(rawValue: node["format"]?.intValue ?? 0), css: node["style"]?.stringValue ?? "")
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
      guard let indent = node["indent"]?.intValue, indent > 0 else { return nil }
      return (.elementIndent, indent)
    }

    private static func isBlock(_ node: JSONValue) -> Bool {
      node["children"] != nil && !inlineElements.contains(node["type"]?.stringValue ?? "")
    }

    private mutating func append(_ string: String, format: TextFormat, css: String = "") {
      var attributes = style(blockType, format)
      if !css.isEmpty, let rawSize = InlineCSS(css)["font-size"], rawSize.hasSuffix("px"),
        let size = Double(rawSize.dropLast(2)), size.isFinite, size > 0 {
        resizedRanges.append(text.length..<(text.length + string.utf16.count))
        #if canImport(UIKit)
        if let font = attributes[.font] as? UIFont { attributes[.font] = font.withSize(size) }
        #else
        if let font = attributes[.font] as? NSFont { attributes[.font] = NSFont(descriptor: font.fontDescriptor, size: size) }
        #endif
      }
      if let link { attributes[.link] = link }
      text.append(NSAttributedString(string: string, attributes: attributes))
    }
  }
}

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

extension NSAttributedString.Key {
  /// A `DocumentText.ListItem`, on the line of the item it describes.
  static let listItem = NSAttributedString.Key("TextKitEditor.listItem")
  /// How many levels in a block is indented, on its lines.
  static let elementIndent = NSAttributedString.Key("TextKitEditor.elementIndent")
}
