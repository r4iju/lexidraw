import EditorModelInterface
import Foundation

/// A document as one text for TextKit: each block at the root on its own
/// line, kept in step with a model by what each update says it changed.
/// Offsets are UTF-16 code units, as the model's and `NSTextStorage`'s are.
///
/// A line break is U+2028, which breaks the line without ending the block,
/// and a node with no text of its own is one U+FFFC. Blocks nested in a
/// block, such as list items, table rows and cells, are set apart by a
/// newline inside it.
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
  /// a block at the root; `texts` renders any node's text.
  public typealias StandIn = (
    _ node: JSONValue, _ isBlock: Bool, _ texts: (JSONValue) -> NSAttributedString
  ) -> [NSAttributedString.Key: Any]?

  public struct Splice: Equatable, Sendable {
    public var old: Range<Int>
    public var new: Range<Int>

    public init(old: Range<Int>, new: Range<Int>) {
      self.old = old
      self.new = new
    }
  }

  /// How a block at the root is laid out.
  public enum BlockKind: Equatable, Sendable {
    case text
    /// Each row's cells, as ranges in the block.
    case table(cells: [[NSRange]])
    /// A node with no text of its own, shown as one character.
    case embedded(type: String)
  }

  private let model: any EditorModel
  private let style: Style
  private let standIn: StandIn?
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

  /// The text's length, the newline ending the last block included.
  public var length: Int { starts.last ?? 0 }

  public var blockCount: Int { blocks.count }

  /// The block's text, without the newline that ends it.
  public func range(ofBlock index: Int) -> NSRange {
    NSRange(location: starts[index], length: blocks[index].length)
  }

  public func kind(ofBlock index: Int) -> BlockKind { blocks[index].kind }

  /// The index of the block `offset` is in, the newline ending it included.
  public func blockIndex(at offset: Int) -> Int {
    var low = 0
    var high = blocks.count - 1
    while low < high {
      let middle = (low + high + 1) / 2
      if starts[middle] <= offset { low = middle } else { high = middle - 1 }
    }
    return low
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
    var edited: [[NSRange]]?
    if case .table(let cells) = block.kind, last == first {
      let local = NSRange(location: range.location - starts[first], length: range.length)
      edited = Self.cells(cells, replacing: local, withLength: text.length)
    }
    if let edited {
      block.kind = .table(cells: edited)
    } else if last > first || block.kind != .text {
      block.kind = .text
      block.spans = [:]
      merged = true
    }
    blocks.replaceSubrange(first...last, with: [block])
    measure()
    return [Splice(old: first..<(last + 1), new: first..<(first + 1))]
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
      return Point(path: [], offset: local == 0 ? blockIndex : blockIndex + 1, type: .element)
    }
    let children = (0..<childCount).filter { (spans[path + [$0]]?.end ?? .max) <= local }
    return Point(path: [blockIndex] + path, offset: children.count, type: .element)
  }

  /// The attributes text of `format` typed at `offset` takes, which depend
  /// on the block it goes into.
  public func attributes(at offset: Int, format: TextFormat) -> [NSAttributedString.Key: Any] {
    style(blocks.isEmpty ? "paragraph" : blocks[blockIndex(at: offset)].type, format)
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
      let node = try model.node(at: [index])
      let blockType = (node["type"] == "heading" ? node["tag"] : node["type"])?.stringValue ?? ""
      var renderer = Renderer(style: style, standIn: standIn, blockType: blockType)
      renderer.add(node, at: [])
      let block = renderer.text
      rendered.append(
        Block(
          key: key(index), type: blockType, length: block.length, spans: renderer.spans,
          kind: Self.kind(of: node, spans: renderer.spans)))
      block.append(NSAttributedString(string: "\n", attributes: style(blockType, [])))
      text.append(block)
    }
    return (text, rendered)
  }

  /// A table's cells after `range` of it is replaced with text `length`
  /// long, or nil where the edit takes in more than one cell.
  private static func cells(_ cells: [[NSRange]], replacing range: NSRange, withLength length: Int) -> [[NSRange]]? {
    var inOneCell = false
    let edited = cells.map { row in
      row.map { cell -> NSRange in
        if NSMaxRange(cell) < range.location { return cell }
        if cell.location > NSMaxRange(range) { return NSRange(location: cell.location + length - range.length, length: cell.length) }
        guard cell.location <= range.location, NSMaxRange(range) <= NSMaxRange(cell) else { return cell }
        inOneCell = true
        return NSRange(location: cell.location, length: cell.length + length - range.length)
      }
    }
    return inOneCell ? edited : nil
  }

  private static func kind(of node: JSONValue, spans: [[Int]: Span]) -> BlockKind {
    switch spans[[]]?.kind {
    case .character: return .embedded(type: node["type"]?.stringValue ?? "")
    case .element(let rowCount) where node["type"] == "table":
      return .table(
        cells: (0..<rowCount).map { row in
          guard case .element(let cellCount) = spans[[row]]?.kind else { return [] }
          return (0..<cellCount).compactMap { spans[[row, $0]].map { NSRange(location: $0.start, length: $0.end - $0.start) } }
        })
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
    var text = NSMutableAttributedString()
    var spans: [[Int]: Span] = [:]

    /// Inline elements, which sit in a line of text rather than on their own.
    private static let inlineElements: Set<String> = ["link", "autolink", "mark"]

    mutating func add(_ node: JSONValue, at path: [Int]) {
      let start = text.length
      if let standIn, let attributes = standIn(node, path.isEmpty, texts) {
        text.append(NSAttributedString(string: "\u{FFFC}", attributes: style(blockType, []).merging(attributes) { $1 }))
        spans[path] = Span(start: start, end: text.length, kind: .character)
        return
      }
      if let children = node["children"]?.arrayValue {
        for (index, child) in children.enumerated() {
          if index > 0, Self.isBlock(child) || Self.isBlock(children[index - 1]) {
            append("\n", format: [])
          }
          add(child, at: path + [index])
        }
        spans[path] = Span(start: start, end: text.length, kind: .element(childCount: children.count))
        return
      }
      let kind: Span.Kind
      if node["type"] == "linebreak" {
        append("\u{2028}", format: [])
        kind = .character
      } else if let string = node["text"]?.stringValue {
        append(string, format: TextFormat(rawValue: node["format"]?.intValue ?? 0))
        kind = .text
      } else {
        append("\u{FFFC}", format: [])
        kind = .character
      }
      spans[path] = Span(start: start, end: text.length, kind: kind)
    }

    /// `node`'s text as it would be rendered here.
    private func texts(_ node: JSONValue) -> NSAttributedString {
      var renderer = Renderer(style: style, standIn: standIn, blockType: blockType)
      renderer.add(node, at: [])
      return renderer.text
    }

    private static func isBlock(_ node: JSONValue) -> Bool {
      node["children"] != nil && !inlineElements.contains(node["type"]?.stringValue ?? "")
    }

    private mutating func append(_ string: String, format: TextFormat) {
      text.append(NSAttributedString(string: string, attributes: style(blockType, format)))
    }
  }
}
