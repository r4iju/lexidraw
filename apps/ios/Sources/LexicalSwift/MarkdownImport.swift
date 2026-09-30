/// `$convertFromMarkdownString` from @lexical/markdown with the web editor's
/// transformers, as the GFM table transformer runs it on each cell's text.
///
/// It runs in two steps. `lines` reads each line: the block it makes and
/// its text, formatted. That is all that can throw: `NotPortedYet` where
/// the web would run a transformer LexicalSwift doesn't port yet, and
/// `EditorError` where the web's import throws. `Update.importMarkdown`
/// then makes the nodes, so nothing changes in the document unless all of
/// it imports.
///
/// Strings are worked on in UTF-16 code units, as JavaScript's are.
enum MarkdownImport {
  typealias Text = [UTF16.CodeUnit]

  /// A line of markdown as the import reads it.
  struct Line {
    enum Block {
      case paragraph, horizontalRule, heading(HeadingTag), quote
      /// A list item, with the list transformer's match.
      case listItem(ListType, groups: [String?])
    }

    let block: Block
    /// The line's text past its block's markdown, formatted, and the link
    /// each part is the text of, if any.
    let text: [(text: Text, format: TextFormat, link: Link?)]
    let isEmpty: Bool
  }

  /// A link the LINK transformer makes, which the parts of its text share.
  final class Link {
    let url: String
    let title: String?

    init(url: String, title: String?) {
      self.url = url
      self.title = title
    }
  }

  static func lines(_ markdown: String) throws -> [Line] {
    let lines = normalized(Text(markdown.utf16)).map(string)
    return try lines.indices.map { index in
      try importMultiline(lines, index)
      return try importLine(Text(lines[index].utf16))
    }
  }

  /// `normalizeMarkdown` without merging lines: a line of only whitespace is
  /// empty. It leaves a code block's lines as they are too, but the import
  /// ends at a code block's first line.
  private static func normalized(_ markdown: Text) -> [Text] {
    markdown.split(separator: newline, omittingEmptySubsequences: false).map { raw in
      raw.reversed().drop(while: isWhitespace).isEmpty ? [] : Text(raw)
    }
  }

  /// `$importMultiline`: no multiline element transformer is ported, so one
  /// that takes the line at `index` throws.
  private static func importMultiline(_ lines: [String], _ index: Int) throws {
    for transformer in MarkdownTransformer.multilineElement {
      guard let start = transformer.regExp?.firstMatch(in: lines[index]),
        takes(transformer, lines, index, startIndex: start.index)
      else { continue }
      try requirePorted(transformer.name)
      throw EditorError.unsupported("Importing the markdown \(transformer.name.rawValue)")
    }
  }

  /// Whether `transformer`, its start matching at `startIndex` in the line
  /// at `index`, takes the lines from there instead of leaving them to the
  /// other transformers: as its `handleImportAfterStartMatch` in
  /// @packages/lexical-nodes decides, or else where `$importMultiline` finds
  /// its end.
  private static func takes(_ transformer: MarkdownTransformer, _ lines: [String], _ index: Int, startIndex: Int)
    -> Bool
  {
    let isLine = { (pattern: JSRegExp) in { (line: String) in pattern.firstMatch(in: line) == nil ? 0 : 1 } }
    switch transformer.name {
    case .callout, .code: return true
    case .admonition:
      return closingLine(lines, from: index, opens: isLine(MarkdownTransformer.regExp(of: .admonition)),
        closes: isLine(MarkdownTransformer.admonitionEnd)) != nil
    case .details:
      return closingLine(lines, from: index, opens: MarkdownTransformer.detailsOpen.matchCount,
        closes: MarkdownTransformer.detailsClose.matchCount) != nil
    case .columns:
      // `splitColumns` finds a column in any line that isn't blank.
      guard let end = closingLine(lines, from: index, opens: isLine(MarkdownTransformer.regExp(of: .columns)),
        closes: isLine(MarkdownTransformer.columnsClose))
      else { return false }
      return lines[(index + 1)..<end].contains { !trimmed($0.utf16).isEmpty }
    default:
      guard let end = transformer.regExpEnd else { return true }
      return lines.indices[index...].contains { endIndex in
        guard let match = end.firstMatch(in: lines[endIndex]) else { return false }
        return endIndex != index || match.index != startIndex
      }
    }
  }

  /// `findClose`: the line where the block opened on `from` closes, skipping
  /// fenced code, where `opens` and `closes` count how many blocks a line
  /// opens and closes.
  private static func closingLine(
    _ lines: [String], from: Int, opens: (String) -> Int, closes: (String) -> Int
  ) -> Int? {
    var depth = 0
    var fence: String?
    for index in lines.indices[from...] {
      let line = lines[index]
      let marker = MarkdownTransformer.fence.firstMatch(in: line)?.groups[1]
      if let open = fence {
        if let marker, marker.utf16.starts(with: open.utf16), trimmed(line.utf16) == Text(marker.utf16) { fence = nil }
        continue
      }
      if let marker, index != from {
        fence = marker
        continue
      }
      depth += opens(line) - closes(line)
      if depth <= 0 { return index }
    }
    return nil
  }

  /// `$importBlocks` up to where it makes nodes: the element transformer
  /// that takes the line, then the text transformers on what it leaves.
  private static func importLine(_ line: Text) throws -> Line {
    let text = Piece(line)
    var block = Line.Block.paragraph
    let lineString = string(line)
    transformers: for transformer in MarkdownTransformer.element {
      guard let match = transformer.regExp?.firstMatch(in: lineString), let whole = match.groups[0] else { continue }
      let matched = Text(whole.utf16)
      text.text = Text(line.dropFirst(matched.count))
      if let listType = transformer.name.listType {
        block = .listItem(listType, groups: match.groups)
        break transformers
      }
      switch transformer.name {
      // Each gives the line back and declines, a table in a cell.
      case .article, .placeholderBlock, .table:
        text.text = matched
        continue transformers
      case .hr: block = .horizontalRule
      case .heading:
        guard let tag = HeadingTag(rawValue: "h\(match.groups[1]?.utf16.count ?? 0)") else {
          throw EditorError.invalidState("HEADING matched no heading")
        }
        block = .heading(tag)
      case .quote: block = .quote
      default:
        try requirePorted(transformer.name)
        throw EditorError.unsupported("Importing the markdown \(transformer.name.rawValue)")
      }
      break transformers
    }
    var pieces = [text]
    try importTextTransformers(text, in: &pieces)
    return Line(block: block, text: pieces.map { ($0.text, $0.format, $0.link) }, isEmpty: line.isEmpty)
  }

  /// Ends the import where the web would run a transformer LexicalSwift
  /// doesn't yet.
  private static func requirePorted(_ name: MarkdownTransformer.Name) throws {
    if MarkdownTransformer.notPortedYet[name] != nil { throw NotPortedYet() }
  }

  // MARK: Text

  /// A text node of a line, in the order `pieces` holds them.
  fileprivate final class Piece {
    var text: Text
    var format: TextFormat
    let link: Link?

    init(_ text: Text, format: TextFormat = [], link: Link? = nil) {
      self.text = text
      self.format = format
      self.link = link
    }

    /// `canContainTransformableMarkdown`.
    var canContainTransformableMarkdown: Bool { !format.contains(.code) }
  }

  /// `splitText`: `piece` keeps its text up to the first offset, and a piece
  /// like it follows for each part after. No part is empty.
  private static func split(_ piece: Piece, at offsets: [Int], in pieces: inout [Piece]) -> [Piece] {
    var parts: [Text] = []
    var part: Text = []
    for (index, unit) in piece.text.enumerated() {
      if !part.isEmpty, offsets.contains(index) {
        parts.append(part)
        part = []
      }
      part.append(unit)
    }
    if !part.isEmpty { parts.append(part) }
    guard let first = parts.first, parts.count > 1 else { return [piece] }
    piece.text = first
    let rest = parts.dropFirst().map { Piece($0, format: piece.format, link: piece.link) }
    let index = pieces.firstIndex { $0 === piece }!
    pieces.insert(contentsOf: rest, at: index + 1)
    return [piece] + rest
  }

  /// `importTextTransformers`: the outermost text format or text match in
  /// `piece` applies, then the same again in what it split off, and escapes
  /// are taken out.
  private static func importTextTransformers(_ piece: Piece, in pieces: inout [Piece]) throws {
    var format = TextFormatMatch.outermost(in: piece.text)
    var match = TextMatch.outermost(in: string(piece.text))
    if let found = format, let textMatch = match {
      if found.isCodeSpan {
        // A code span is never partly taken by a text match.
        if textMatch.start <= found.start, textMatch.end >= found.end { format = nil } else { match = nil }
      } else if (found.start <= textMatch.start && found.end >= textMatch.end) || textMatch.start > found.end {
        match = nil
      } else {
        format = nil
      }
    }
    var next: [Piece?] = []
    if let format {
      let parts: [Piece]
      let transformed: Piece
      if format.start == 0, format.end == piece.text.count {
        (parts, transformed) = ([piece], piece)
      } else if format.start == 0 {
        parts = split(piece, at: [format.end], in: &pieces)
        transformed = parts[0]
      } else {
        parts = split(piece, at: [format.start, format.end], in: &pieces)
        transformed = parts[1]
      }
      transformed.text = format.content
      for type in format.transformer.formats { transformed.format.insert(type.format) }
      let (before, after) = format.start == 0 ? (nil, parts[safe: 1]) : (parts.first, parts[safe: 2])
      next = [after, before, transformed]
    } else if let match {
      switch match.transformer.name {
      case .placeholderInline, .link, .emoji: break
      default:
        try requirePorted(match.transformer.name)
        throw EditorError.unsupported("Importing the markdown \(match.transformer.name.rawValue)")
      }
      let parts =
        match.start == 0
        ? split(piece, at: [match.end], in: &pieces) : split(piece, at: [match.start, match.end], in: &pieces)
      let transformed = match.start == 0 ? parts[0] : parts[1]
      // The placeholder's `replace` leaves it as text.
      let replaced: Piece?
      if match.transformer.name == .link {
        replaced = try replaceLink(transformed, match.groups, in: &pieces)
      } else if match.transformer.name == .emoji, let name = match.groups[1], let emoji = WebEmojiAliases.values[name] {
        let replacement = Piece(Text(emoji.utf16), link: transformed.link)
        let index = pieces.firstIndex { $0 === transformed }!
        pieces[index] = replacement
        replaced = replacement
      } else { replaced = nil }
      next = match.start == 0 ? [parts[safe: 1], nil, replaced] : [parts[safe: 2], parts.first, replaced]
    }
    for case let piece? in next where piece.canContainTransformableMarkdown {
      try importTextTransformers(piece, in: &pieces)
    }
    piece.text = try unescape(piece.text)
  }

  /// LINK's `replace`: `piece` becomes a link holding a text of its own,
  /// which it returns, after the text of an opening bracket that has no
  /// closing one, unless `piece` is already a link's text.
  private static func replaceLink(_ piece: Piece, _ groups: [String?], in pieces: inout [Piece]) throws -> Piece? {
    guard piece.link == nil else { return nil }
    let url = try unescape(Text((groups[2] ?? groups[3] ?? "").utf16))
    let title = try (groups[4] ?? groups[5] ?? groups[6]).map { try unescape(Text($0.utf16)) }
    let linkText = Text((groups[1] ?? "").utf16)
    let (opening, closing) = (linkText.count { $0 == openingBracket }, linkText.count { $0 == closingBracket })
    if opening < closing { return nil }
    var parsed = linkText
    var outside: Text = []
    if opening > closing {
      let parts = linkText.split(separator: openingBracket, omittingEmptySubsequences: false)
      outside = [openingBracket] + parts[0]
      parsed = Text(parts.dropFirst().joined(separator: [openingBracket]))
    }
    let link = Piece(
      parsed, format: piece.format, link: Link(url: string(url), title: title.map { string($0) }))
    let index = pieces.firstIndex { $0 === piece }!
    pieces[index] = link
    if !outside.isEmpty { pieces.insert(Piece(outside, format: piece.format), at: index) }
    return link
  }

  /// `unescapeText`: a backslash before ASCII punctuation goes, and a
  /// decimal character reference is its character.
  private static func unescape(_ text: Text) throws -> Text {
    var unescaped: Text = []
    var index = 0
    while index < text.count {
      if text[index] == backslash, let next = text[safe: index + 1], isASCIIPunctuation(next) {
        unescaped.append(next)
        index += 2
      } else {
        unescaped.append(text[index])
        index += 1
      }
    }
    var result: Text = []
    index = 0
    while index < unescaped.count {
      if unescaped[index] == ampersand, unescaped[safe: index + 1] == hash {
        let digits = unescaped[(index + 2)...].prefix { (zero...nine).contains($0) }
        let end = index + 2 + digits.count
        if !digits.isEmpty, unescaped[safe: end] == semicolon {
          result += try characterReference(digits)
          index = end + 1
          continue
        }
      }
      result.append(unescaped[index])
      index += 1
    }
    return result
  }

  /// `String.fromCodePoint(Number(digits))`, which throws past Unicode's
  /// last code point. A lone surrogate stays one.
  private static func characterReference(_ digits: ArraySlice<UTF16.CodeUnit>) throws -> Text {
    let significant = digits.drop { $0 == zero }
    let value = significant.count > 7 ? Int.max : significant.reduce(0) { $0 * 10 + Int($1 - zero) }
    guard value <= 0x10FFFF else { throw EditorError.invalidState("RangeError: Invalid code point \(value)") }
    guard value > 0xFFFF else { return [UTF16.CodeUnit(value)] }
    let offset = value - 0x10000
    return [UTF16.CodeUnit(0xD800 + (offset >> 10)), UTF16.CodeUnit(0xDC00 + (offset & 0x3FF))]
  }

  // MARK: Characters

  static func string(_ text: some Collection<UTF16.CodeUnit>) -> String { String(decoding: text, as: UTF16.self) }

  /// JavaScript's `\s`: its whitespace and line terminators.
  static func isWhitespace(_ unit: UTF16.CodeUnit) -> Bool {
    switch unit {
    case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
    default: false
    }
  }

  /// What `unescapeText` unescapes.
  static func isASCIIPunctuation(_ unit: UTF16.CodeUnit) -> Bool {
    switch unit {
    case 0x21...0x2F, 0x3A...0x40, 0x5B...0x60, 0x7B...0x7E: true
    default: false
    }
  }

  /// `PUNCTUATION` in @lexical/markdown, which leaves out the backslash.
  static func isPunctuation(_ unit: UTF16.CodeUnit) -> Bool {
    unit != backslash && isASCIIPunctuation(unit)
  }

  /// JavaScript's `trim`.
  static func trimmed(_ text: some BidirectionalCollection<UTF16.CodeUnit>) -> Text {
    Text(text.drop(while: isWhitespace).reversed().drop(while: isWhitespace).reversed())
  }

  static let newline = "\n".utf16.first!
  static let tab = "\t".utf16.first!
  static let space = " ".utf16.first!
  static let backslash = "\\".utf16.first!
  private static let ampersand = "&".utf16.first!
  private static let openingBracket = "[".utf16.first!
  private static let closingBracket = "]".utf16.first!
  private static let hash = "#".utf16.first!
  private static let semicolon = ";".utf16.first!
  private static let zero = "0".utf16.first!
  private static let nine = "9".utf16.first!
}

// MARK: - Text formats

extension MarkdownImport {
  /// `findOutermostTextFormatTransformer`: the outermost code span or
  /// emphasis in a text, as CommonMark's delimiter runs pair.
  fileprivate struct TextFormatMatch {
    let start: Int
    let end: Int
    let transformer: MarkdownTransformer
    let content: Text
    var isCodeSpan: Bool { transformer.tag == "`" }

    /// `transformersByTag`: the text format transformers by tag, in the
    /// order the web lists them, a later one of a tag taking its place.
    static let byTag: [(tag: Text, transformer: MarkdownTransformer)] = MarkdownTransformer.textFormat.reduce(into: []) {
      byTag, transformer in
      let tag = Text(transformer.tag.utf16)
      if let index = byTag.firstIndex(where: { $0.tag == tag }) {
        byTag[index].transformer = transformer
      } else {
        byTag.append((tag, transformer))
      }
    }

    static func outermost(in text: Text) -> TextFormatMatch? {
      let code = byTag.first { $0.tag == [backtick] }?.transformer
      let spans = code == nil ? [] : codeSpans(in: text)
      var delimiters = self.delimiters(in: text, excluding: spans.map { $0.start..<$0.end })
      let emphasis = delimiters.isEmpty ? nil : processEmphasis(text, &delimiters)
      let codeMatch = spans.first.flatMap { span in
        code.map { TextFormatMatch(start: span.start, end: span.end, transformer: $0, content: span.content) }
      }
      guard let emphasis else { return codeMatch }
      guard let codeMatch else { return emphasis }
      return emphasis.start <= codeMatch.start && emphasis.end >= codeMatch.end ? emphasis : codeMatch
    }

    /// `scanCodeSpans`: a run of backticks opens a span that the next run
    /// as long closes, unless a backslash escapes it.
    private static func codeSpans(in text: Text) -> [(start: Int, end: Int, content: Text)] {
      var runs: [(index: Int, length: Int)] = []
      var index = 0
      while index < text.count {
        guard text[index] == backtick else {
          index += 1
          continue
        }
        var length = 1
        while text[safe: index + length] == backtick { length += 1 }
        runs.append((index, length))
        index += length
      }
      var spans: [(start: Int, end: Int, content: Text)] = []
      var open = 0
      while open < runs.count {
        let opener = runs[open]
        guard !isEscaped(text, opener.index),
          let close = runs.indices.dropFirst(open + 1).first(where: { runs[$0].length == opener.length })
        else {
          open += 1
          continue
        }
        let closer = runs[close]
        var content = Text(text[(opener.index + opener.length)..<closer.index])
        if content.count >= 2, content.first == space, content.last == space, content.contains(where: { $0 != space }) {
          content = Text(content.dropFirst().dropLast())
        }
        spans.append((opener.index, closer.index + closer.length, content))
        open = close + 1
      }
      return spans
    }

    private struct Delimiter {
      var index: Int
      let character: UTF16.CodeUnit
      var length: Int
      let canOpen: Bool
      let canClose: Bool
      var isActive = true
    }

    /// `scanDelimiters`: the runs of a format's first character that can
    /// open or close emphasis, outside code spans and unescaped.
    private static func delimiters(in text: Text, excluding spans: [Range<Int>]) -> [Delimiter] {
      let characters = Set(byTag.compactMap(\.tag.first).filter { $0 != backtick })
      var delimiters: [Delimiter] = []
      var index = 0
      while index < text.count {
        let character = text[index]
        guard characters.contains(character), !isEscaped(text, index), !spans.contains(where: { $0.contains(index) })
        else {
          index += 1
          continue
        }
        var length = 1
        while text[safe: index + length] == character { length += 1 }
        let canOpen = canEmphasis(character, text, index, length, isOpen: true)
        let canClose = canEmphasis(character, text, index, length, isOpen: false)
        if canOpen || canClose {
          delimiters.append(Delimiter(index: index, character: character, length: length, canOpen: canOpen, canClose: canClose))
        }
        index += length
      }
      return delimiters
    }

    /// `processEmphasis`: pairs each closer with the nearest opener it can
    /// close, as CommonMark's algorithm does, and returns the pair that
    /// starts first, the longest of those.
    private static func processEmphasis(_ text: Text, _ delimiters: inout [Delimiter]) -> TextFormatMatch? {
      struct BottomKey: Hashable {
        let character: UTF16.CodeUnit
        let canOpen: Bool
        let lengthModThree: Int
      }
      var openersBottom: [BottomKey: Int] = [:]
      var current = 0
      var result: TextFormatMatch?
      while current < delimiters.count {
        let closer = delimiters[current]
        guard closer.isActive, closer.canClose, closer.length != 0 else {
          current += 1
          continue
        }
        let bottomKey = BottomKey(character: closer.character, canOpen: closer.canOpen, lengthModThree: closer.length % 3)
        var found = false
        for openIndex in stride(from: current - 1, to: openersBottom[bottomKey] ?? -1, by: -1) {
          let opener = delimiters[openIndex]
          guard opener.isActive, opener.canOpen, opener.length != 0, opener.character == closer.character else {
            continue
          }
          // The rule of 3, on what's left of each run.
          if opener.canClose || closer.canOpen {
            let sum = opener.length + closer.length
            if sum % 3 == 0, opener.length % 3 != 0, closer.length % 3 != 0 { continue }
          }
          let maxLength = min(opener.length, closer.length)
          guard
            let matched = byTag.filter({ $0.tag.first == opener.character && $0.tag.count <= maxLength })
              .max(by: { $0.tag.count < $1.tag.count })
          else { continue }
          found = true
          let length = matched.tag.count
          let match = TextFormatMatch(
            start: opener.index + (opener.length - length), end: closer.index + length,
            transformer: matched.transformer, content: Text(text[(opener.index + opener.length)..<closer.index]))
          if let previous = result {
            if match.start < previous.start || (match.start == previous.start && match.end > previous.end) {
              result = match
            }
          } else {
            result = match
          }
          for index in (openIndex + 1)..<current { delimiters[index].isActive = false }
          delimiters[openIndex].length -= length
          delimiters[current].length -= length
          delimiters[openIndex].isActive = delimiters[openIndex].length > 0
          if delimiters[current].length > 0 {
            delimiters[current].index += length
          } else {
            delimiters[current].isActive = false
            current += 1
          }
          break
        }
        if !found {
          openersBottom[bottomKey] = current - 1
          if !closer.canOpen { delimiters[current].isActive = false }
          current += 1
        }
      }
      return result
    }

    /// `canEmphasis`: `_` inside a word neither opens nor closes.
    private static func canEmphasis(
      _ character: UTF16.CodeUnit, _ text: Text, _ index: Int, _ length: Int, isOpen: Bool
    ) -> Bool {
      guard isFlanking(text, index, length, isLeft: isOpen) else { return false }
      guard character == underscore else { return true }
      if !isFlanking(text, index, length, isLeft: !isOpen) { return true }
      let adjacent = isOpen ? text[safe: index - 1] : text[safe: index + length]
      return adjacent.map(isPunctuation) ?? false
    }

    /// `isFlanking`: a left-flanking run has something other than
    /// whitespace after it, and after punctuation only where whitespace or
    /// punctuation is before it; a right-flanking one the other way round.
    private static func isFlanking(_ text: Text, _ index: Int, _ length: Int, isLeft: Bool) -> Bool {
      let before = text[safe: index - 1]
      let after = text[safe: index + length]
      let (primary, secondary) = isLeft ? (after, before) : (before, after)
      guard let primary, !isWhitespace(primary) else { return false }
      guard isPunctuation(primary) else { return true }
      return secondary.map { isWhitespace($0) || isPunctuation($0) } ?? true
    }

    /// Whether an odd run of backslashes is before `index`.
    private static func isEscaped(_ text: Text, _ index: Int) -> Bool {
      text[..<index].reversed().prefix { $0 == backslash }.count % 2 == 1
    }

    private static let backtick = "`".utf16.first!
    private static let underscore = "_".utf16.first!
  }

  /// `findOutermostTextMatchTransformer`: of the text matches' import
  /// patterns, the match that starts first and isn't inside another.
  fileprivate struct TextMatch {
    let start: Int
    let end: Int
    let transformer: MarkdownTransformer
    let groups: [String?]

    static func outermost(in text: String) -> TextMatch? {
      var found: TextMatch?
      for transformer in MarkdownTransformer.textMatch {
        guard let match = transformer.importRegExp?.firstMatch(in: text), let whole = match.groups[0] else { continue }
        let start = match.index
        let end = start + whole.utf16.count
        if let previous = found, !(start < previous.start && (end > previous.end || end <= previous.start)) { continue }
        found = TextMatch(start: start, end: end, transformer: transformer, groups: match.groups)
      }
      return found
    }
  }
}

// MARK: - Making the nodes

extension Update {
  /// `$importMarkdownNodes`, the rest of `$importBlocks` included: the
  /// blocks of `lines` appended to `container`, a line that makes none
  /// joining the block before it.
  mutating func importMarkdown(_ lines: [MarkdownImport.Line], into container: NodeKey) throws {
    var mode = ListReplaceMode.import(columns: [])
    for line in lines {
      let paragraph = create(SerializedParagraphNode.type)
      let text = try inlineNodes(line.text)
      try append(paragraph, text)
      try append(container, [paragraph])
      switch line.block {
      case .paragraph: break
      case .horizontalRule: try replace(paragraph, with: create(SerializedHorizontalRuleNode.type))
      case .heading(let tag):
        let heading = createHeading(tag)
        try append(heading, text)
        try replace(paragraph, with: heading)
      case .quote:
        if let previous = state.previousSibling(of: paragraph), state[previous].type == SerializedQuoteNode.type {
          try append(previous, [try markdownLineBreak(ending: previous)] + text)
          try remove(paragraph)
        } else {
          let quote = create(SerializedQuoteNode.type)
          try append(quote, text)
          try replace(paragraph, with: quote)
        }
      case .listItem(let listType, let groups):
        try listReplace(paragraph, listType, text, groups, &mode)
      }
      guard state.parent(of: paragraph) != nil, !line.isEmpty, let previous = state.previousSibling(of: paragraph),
        let target = lineJoinTarget(previous), !state.textContent(of: target).isEmpty
      else { continue }
      try append(target, [try markdownLineBreak(ending: target)] + Array(state.children(of: paragraph)))
      try remove(paragraph)
    }
    for child in state.children(of: container) {
      if isEmptyMarkdownParagraph(child), state.childCount(of: container) > 1 {
        try remove(child)
        continue
      }
      guard state[child].isElement else { continue }
      for text in textNodes(in: child) { try splitTabs(text) }
    }
  }

  /// The texts of a line, those of one link in it.
  private mutating func inlineNodes(_ text: [(text: MarkdownImport.Text, format: TextFormat, link: MarkdownImport.Link?)])
    throws -> [NodeKey]
  {
    var nodes: [NodeKey] = []
    var last: (link: MarkdownImport.Link, key: NodeKey)?
    for part in text {
      let node = createText(MarkdownImport.string(part.text), format: part.format)
      guard let link = part.link else {
        nodes.append(node)
        continue
      }
      if let last, last.link === link {
        try append(last.key, [node])
        continue
      }
      let key = createLink(link.url, rel: .null, target: .null, title: link.title.map(Nullable.value) ?? .null)
      try append(key, [node])
      nodes.append(key)
      last = (link, key)
    }
    return nodes
  }

  /// What a line that makes no block joins: a paragraph or quote before it,
  /// or the item a list before it ends in.
  private func lineJoinTarget(_ previous: NodeKey) -> NodeKey? {
    switch state[previous].type {
    case SerializedParagraphNode.type, SerializedQuoteNode.type: return previous
    case SerializedListNode.type:
      return lastDescendant(of: previous).flatMap { findParent(from: $0, where: isListItem) }
    default: return nil
    }
  }

  /// `$createMarkdownLineBreakNode`: a line break after `block`'s text,
  /// taking a hard break's marker off the end of it to keep.
  private mutating func markdownLineBreak(ending block: NodeKey) throws -> NodeKey {
    var marker: String?
    let children = Array(state.children(of: block))
    if let last = children.last, state[last].isText {
      let text = Array(state[last].text.utf16)
      if let (kept, found) = Self.hardLineBreak(text) {
        try setText(last, MarkdownImport.string(kept))
        marker = MarkdownImport.string(found)
      } else if text.count >= 2, text.allSatisfy({ $0 == MarkdownImport.space }),
        hasContentOnLine(children.dropLast())
      {
        try setText(last, "")
        marker = MarkdownImport.string(text)
      }
    }
    guard let marker else { return create(SerializedLineBreakNode.type) }
    let json: JSONValue = [
      "type": .string(SerializedLineBreakNode.type), "version": 1, "$": ["mdHardLineBreak": .string(marker)],
    ]
    return create(.lineBreak(try SerializedLineBreakNode(json: json)), type: SerializedLineBreakNode.type, children: nil)
  }

  /// `parseMarkdownHardLineBreak`: a line ending in an unescaped backslash,
  /// or in two spaces or more after something else, without its marker.
  private static func hardLineBreak(_ line: MarkdownImport.Text) -> (MarkdownImport.Text, MarkdownImport.Text)? {
    if line.last == MarkdownImport.backslash {
      let backslashes = line.reversed().prefix { $0 == MarkdownImport.backslash }.count
      return backslashes % 2 == 1 ? (MarkdownImport.Text(line.dropLast()), [MarkdownImport.backslash]) : nil
    }
    let spaces = line.reversed().prefix { $0 == MarkdownImport.space }.count
    guard spaces >= 2, let last = line.dropLast(spaces).last, !MarkdownImport.isWhitespace(last) else { return nil }
    return (MarkdownImport.Text(line.dropLast(spaces)), MarkdownImport.Text(line.suffix(spaces)))
  }

  /// `hasNonWhitespaceContentOnLine`: whether anything but whitespace comes
  /// after the last line break in `nodes`.
  private func hasContentOnLine(_ nodes: ArraySlice<NodeKey>) -> Bool {
    for node in nodes.reversed() {
      if state[node].isLineBreak { return false }
      if state.textContent(of: node).utf16.contains(where: { !MarkdownImport.isWhitespace($0) }) { return true }
    }
    return false
  }

  /// `isEmptyParagraph` in @lexical/markdown: a paragraph holding nothing,
  /// or one text of up to three whitespace characters.
  func isEmptyMarkdownParagraph(_ key: NodeKey) -> Bool {
    guard state[key].type == SerializedParagraphNode.type else { return false }
    let children = state.children(of: key)
    guard let first = children.first else { return true }
    let text = state[first].text.utf16
    return children.count == 1 && state[first].isText && text.count <= 3 && text.allSatisfy(MarkdownImport.isWhitespace)
  }

  /// `getAllTextNodes`.
  private func textNodes(in key: NodeKey) -> [NodeKey] {
    state.children(of: key).flatMap { child in
      state[child].isText ? [child] : state[child].isElement ? textNodes(in: child) : []
    }
  }

  /// `$normalizeMarkdownTextNode`: a text holding tabs becomes texts like
  /// it between tab nodes.
  private mutating func splitTabs(_ key: NodeKey) throws {
    guard state[key].type == SerializedTextNode.type else { return }
    let text = Array(state[key].text.utf16)
    guard text.contains(MarkdownImport.tab) else { return }
    let format = format(of: key)
    let style = style(of: key)
    let nodes = text.split(separator: MarkdownImport.tab, omittingEmptySubsequences: false).enumerated().flatMap {
      index, piece in
      (index == 0 ? [] : [create(SerializedTabNode.type)])
        + (piece.isEmpty ? [] : [createText(MarkdownImport.string(piece), format: format, style: style)])
    }
    for node in nodes { try insert(node, before: key) }
    try remove(key)
  }
}

extension SerializedLineBreakNode {
  /// Whether all the line break holds that LexicalSwift doesn't read is the
  /// hard break marker @lexical/markdown keeps in its NodeState as
  /// `mdHardLineBreak`, which reads only a backslash or two spaces or more.
  var holdsOnlyAMarkdownHardLineBreak: Bool {
    guard unknownFields.count == 1, case .object(let nodeState)? = unknownFields["$"], nodeState.count == 1,
      case .string(let marker)? = nodeState["mdHardLineBreak"]
    else { return false }
    return marker == "\\" || (marker.count >= 2 && marker.allSatisfy { $0 == " " })
  }
}
