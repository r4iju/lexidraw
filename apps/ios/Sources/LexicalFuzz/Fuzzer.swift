import LexicalSwift

/// Differential fuzzer: drives the reference and a candidate with the same
/// random scripts, compares change sets, refusals and snapshots after every
/// command, and shrinks the first divergence to a minimal fixture recorded
/// from the reference. Deterministic for a given seed.
public struct Fuzzer {
  public struct Finding {
    public var fixture: Fixture
    /// Commands both accepted before the divergence.
    public var stepsRun: Int
  }

  /// Commands both refused, which don't count as steps.
  public private(set) var refusals = 0
  /// Sessions ended as `isNotPortedYet` says.
  public private(set) var sessionsEndedNotPortedYet = 0
  /// Sessions ended where neither model could read its selection back, as
  /// `EditorError.tableSelectionOverAHole` and `.tableSelectionOfAGoneNode`
  /// say, with the same tree.
  public private(set) var sessionsEndedUnreadable = 0

  /// The node types Lexical's markdown shortcuts make that LexicalSwift's
  /// don't yet.
  public static let notPortedYet = Editor.typesMarkdownShortcutsNotPortedYetMake

  /// Whether a step that disagrees ends its session rather than diverging:
  /// LexicalSwift declined a shortcut not ported yet on that step
  /// (`declinedAShortcut`), or Lexical made a node of a type not ported yet.
  /// Nothing after it could agree.
  public static func isNotPortedYet(
    candidate: Fixture.Change, referenceBefore: Snapshot, referenceAfter: Snapshot, declinedAShortcut: Bool = false
  ) -> Bool {
    guard case .applied = candidate else { return false }
    let made = referenceAfter.state.nodeTypes.subtracting(referenceBefore.state.nodeTypes)
    return declinedAShortcut || !made.isDisjoint(with: notPortedYet)
  }

  private let reference: any EditorModel
  private let candidate: any EditorModel
  private var generator: Generator
  /// Commands per generated document before starting a fresh one.
  private let sessionLength = 24

  /// Direction cases opt in so established fault-injection seeds keep their scripts.
  public init(seed: UInt64, reference: some EditorModel, candidate: some EditorModel, writingDirections: Bool = false) {
    self.reference = reference
    self.candidate = candidate
    self.generator = Generator(seed: seed, writingDirections: writingDirections)
  }

  /// Runs until both models have accepted `steps` commands. Returns the
  /// first divergence, shrunk.
  public mutating func run(steps: Int) throws -> Finding? {
    var stepsRun = 0
    while stepsRun < steps {
      let start = generator.document()
      var commands: [EditorCommand] = []
      try reference.load(start)
      guard try reference.snapshot().state == start else {
        throw FuzzerError("The generator wrote a document Lexical normalizes on load")
      }
      try candidate.load(start)
      for _ in 0..<sessionLength where stepsRun < steps {
        // Where the reference can't read its selection back, the step before
        // agreed, so neither model can, and there's nothing to go on from.
        let (snapshot, isSelectionUnreadable) = try Fixture.readBack(reference)
        if isSelectionUnreadable {
          sessionsEndedUnreadable += 1
          break
        }
        guard let command = generator.command(for: snapshot) else { break }
        commands.append(command)
        let verdict = try verdict(command)
        if verdict == .notPortedYet {
          sessionsEndedNotPortedYet += 1
          break
        }
        guard case .agreed(let step) = verdict else {
          let script = try shrink((start, commands))
          let fixture = try Fixture.record(start: script.start, commands: script.commands, on: reference)
          return Finding(fixture: fixture, stepsRun: stepsRun)
        }
        if case .applied(let changes) = step.change {
          if let clipboard = changes.clipboard { generator.clipboard = clipboard }
          stepsRun += 1
        } else {
          refusals += 1
        }
      }
    }
    return nil
  }

  private typealias Script = (start: JSONValue, commands: [EditorCommand])

  private struct Step: Equatable {
    var change: Fixture.Change
    var snapshot: Snapshot
    var isSelectionUnreadable: Bool
  }

  private func step(_ model: any EditorModel, _ command: EditorCommand) throws -> Step {
    let change = try Fixture.Change(applying: command, to: model)
    let (snapshot, isSelectionUnreadable) = try Fixture.readBack(model)
    return Step(change: change, snapshot: snapshot, isSelectionUnreadable: isSelectionUnreadable)
  }

  private enum Verdict: Equatable {
    case agreed(Step)
    case notPortedYet
    case diverged
  }

  /// Applies `command` to both models, and says whether they agreed.
  private func verdict(_ command: EditorCommand) throws -> Verdict {
    let before = try? reference.snapshot()
    let declinedBefore = shortcutsDeclined
    let candidateStep = try step(candidate, command)
    let declinedAShortcut = shortcutsDeclined > declinedBefore
    let referenceStep = try step(reference, command)
    if candidateStep == referenceStep { return .agreed(referenceStep) }
    if let before,
      Self.isNotPortedYet(
        candidate: candidateStep.change, referenceBefore: before, referenceAfter: referenceStep.snapshot,
        declinedAShortcut: declinedAShortcut)
    {
      return .notPortedYet
    }
    return .diverged
  }

  private var shortcutsDeclined: Int {
    (candidate as? any DeclinesShortcutsNotPortedYet)?.shortcutsDeclinedAsNotPorted ?? 0
  }

  /// What a script comes to.
  public enum ScriptVerdict: Equatable, Sendable {
    case agreed
    /// Its session ends where LexicalSwift doesn't port something yet.
    case endedNotPortedYet
    case diverged
  }

  /// What the fuzzer makes of a script, step by step as `run` does, or nil
  /// where the generator couldn't have produced it: only a document the
  /// reference loads unchanged, and commands valid in it that the reference
  /// accepts, count, so a shrunk fixture stays inside what the fuzzer tests.
  public func verdict(start: JSONValue, commands: [EditorCommand]) throws -> ScriptVerdict? {
    guard (try? reference.load(start)) != nil, (try? reference.snapshot())?.state == start else { return nil }
    guard (try? candidate.load(start)) != nil else { return .diverged }
    for command in commands {
      guard let before = try? reference.snapshot(), Generator.isValid(command, in: before) else { return nil }
      switch try verdict(command) {
      case .agreed: continue
      case .notPortedYet: return .endedNotPortedYet
      case .diverged: return .diverged
      }
    }
    return .agreed
  }

  private func diverges(_ script: Script) throws -> Bool {
    try verdict(start: script.start, commands: script.commands) == .diverged
  }

  private func shrink(_ script: Script) throws -> Script {
    var best = script
    var improved = true
    while improved {
      improved = false
      for candidate in smaller(than: best) {
        // Removing a node can leave its parent in a shape Lexical would rewrite
        // on load; take Lexical's own version so the document stays canonical.
        // That version can be the document the node came from, and taking it
        // would take the same script over and over.
        guard (try? reference.load(candidate.start)) != nil,
          let start = try? reference.snapshot().state,
          start != best.start || candidate.commands != best.commands,
          try diverges((start, candidate.commands))
        else { continue }
        best = (start, candidate.commands)
        improved = true
        break
      }
    }
    return best
  }

  /// One-step reductions of a script, most aggressive first.
  private func smaller(than script: Script) -> [Script] {
    var result: [Script] = []
    for index in script.commands.indices.reversed() {
      var commands = script.commands
      commands.remove(at: index)
      result.append((script.start, commands))
    }
    let paths = script.start.nodePaths().filter { !$0.isEmpty }
    // A whole block first, so a table goes in one step rather than a node at
    // a time.
    let depths = Set(paths.map(\.count)).sorted()
    for path in depths.flatMap({ depth in paths.reversed().filter { $0.count == depth } }) {
      let commands = script.commands.map { $0.adjustingPaths(forRemovalOf: path) }
      result.append((script.start.updatingNode(at: path) { _ in nil }, commands))
    }
    for (index, command) in script.commands.enumerated() {
      guard case .setSelection(let anchor, let focus) = command else { continue }
      let simpler =
        anchor == focus
        ? [Point(path: anchor.path, offset: 0, type: anchor.type)].filter { $0 != anchor }.map(EditorCommand.caret)
        : [.caret(anchor), .caret(focus)]
      for replacement in simpler {
        var commands = script.commands
        commands[index] = replacement
        result.append((script.start, commands))
      }
    }
    for path in paths {
      guard let text = script.start.node(at: path)?["text"]?.stringValue else { continue }
      for shorter in text.removingEachCharacter() {
        let start = script.start.updatingNode(at: path) { node in
          guard case .object(var fields) = node else { return node }
          fields["text"] = .string(shorter)
          return .object(fields)
        }
        result.append((start, script.commands))
      }
    }
    for (index, command) in script.commands.enumerated() {
      let text: String
      let typing: (String) -> EditorCommand
      switch command {
      case .insertText(let inserted): (text, typing) = (inserted, EditorCommand.insertText)
      case .commitComposition(let committed): (text, typing) = (committed, EditorCommand.commitComposition)
      default: continue
      }
      guard text.count > 1 else { continue }
      for shorter in text.removingEachCharacter() {
        var commands = script.commands
        commands[index] = typing(shorter)
        result.append((script.start, commands))
      }
    }
    return result
  }
}

extension EditorCommand {
  /// The command with its paths re-pointed after the node at `removed` is
  /// deleted from the document the command runs against.
  fileprivate func adjustingPaths(forRemovalOf removed: [Int]) -> EditorCommand {
    func adjust(_ point: Point) -> Point {
      let depth = removed.count - 1
      if point.type == .element, point.path == Array(removed.dropLast()), point.offset > removed[depth] {
        return Point(path: point.path, offset: point.offset - 1, type: .element)
      }
      guard point.path.count > depth, point.path[..<depth] == removed[..<depth],
        point.path[depth] > removed[depth]
      else { return point }
      var point = point
      point.path[depth] -= 1
      return point
    }
    switch self {
    case .setSelection(let anchor, let focus): return .setSelection(anchor: adjust(anchor), focus: adjust(focus))
    case .deleteLine(let backward, let lineBoundary): return .deleteLine(backward: backward, lineBoundary: adjust(lineBoundary))
    case .toggleChecked(let path): return .toggleChecked(path: adjust(Point(path: path, offset: 0, type: .text)).path)
    case .arrow(let key, let extend, let native, let atCellEdge, let parentRTL, let anchorRTL):
      return .arrow(key, extend: extend, native: adjust(native), atCellEdge: atCellEdge, parentRTL: parentRTL, anchorRTL: anchorRTL)
    default: return self
    }
  }
}

extension String {
  fileprivate func removingEachCharacter() -> [String] {
    indices.map { index in
      var copy = self
      copy.remove(at: index)
      return copy
    }
  }
}

/// Random documents of paragraphs, headings, quotes, lists and horizontal
/// rules, with text, tabs, line breaks and links, and tables of paragraphs
/// with merged cells, and random editing commands a user could issue against
/// them.
struct Generator {
  private var random: SplitMix64
  private let writingDirections: Bool
  /// What the last copy or cut put on the clipboard, for a paste in the same
  /// document or a later one.
  var clipboard: Clipboard?

  /// Characters chosen to stress UTF-16 offsets and word boundaries: accents,
  /// combining marks, CJK, emoji that are several code units and several
  /// scalars, and punctuation and spaces between words; Japanese words,
  /// which ICU segments with a dictionary as no space marks where they end;
  /// and what markdown shortcuts are typed with.
  private static let alphabet: [String] = [
    "a", "b", "z", " ", " ", ".", "_", "7", "1", "é", "e\u{301}", "ß", "日", "本", "語", "한", "👍", "👍🏽",
    "👨‍👩‍👧", "🇯🇵", "日本語", "東京", "話す", "を", "は", "ひらがな", "カタカナ", "#", ">", "*", "~", "=", "`", "-", "[", "]", "(",
    ")", "\\", "&", ";", "|",
  ]
  private static let formats: [TextFormat] = [
    [], .bold, .italic, [.bold, .italic], .underline, .code, .subscript, .superscript,
  ]
  private static let styles = ["", "", "", "color: red;"]
  private static let headingTags = ["h1", "h2", "h3", "h4", "h5", "h6"]
  /// Markdown shortcuts, and some that aren't quite, to type a key at a
  /// time, as they have to be to go off while typing; at once, which a
  /// composition finishes and Enter finishes a block's.
  private static let shortcuts = [
    "# ", "### ", "###### ", "####### ", "> ", "--- ", "*** ", "___ ", "*a*", "**a**", "***a***", "_a_", "__a__",
    "~~a~~", "==a==", "`a`", "`**a**", "*a *", "a_b_", "- ", "* ", "+ ", "1. ", "7. ", "    - ", "        1. ", "[ ] ",
    "[x] ", "- [ ] ", "\t- ", "``` ", "[a](b)", "[a]()", "[[a](b)", "[a](<b c> \"t\")", "[a](https://x.io)",
    "![a](b)", "[a](b\\))", "[a](\\a)", "[a](&#33;)", "[a](\\&#33;)", "[a](&#128077)", "[a](b \"\\\"t\")",
    "|a| ", "|a|b| ", "|---| ", "|:---:|---:| ",
  ]
  /// The rest of a shortcut being typed.
  private var typing: [EditorCommand] = []
  /// Text the web's autolink matchers link, and the URL each links it to.
  private static let autoLinks: [(text: String, url: String)] = [
    ("www.a.io", "https://www.a.io"), ("me@b.io", "mailto:me@b.io"), ("https://c.io/d?e=f", "https://c.io/d?e=f"),
  ]
  /// URLs for a link, ones the web's link editor rewrites, and what it
  /// refuses.
  private static let urls: [String] = [
    "https://a.io", "https://x.io", "https://", "nope", "HTTPS://Example.com", "ftp://x", "https://münchen.de",
  ]
  /// What plain text from another app breaks into lines, tabs and links at.
  private static let pastedParts = ["\n", "\r\n", "\r", "\t", " ", "https://x.io"] + autoLinks.map(\.text)

  init(seed: UInt64, writingDirections: Bool) {
    self.writingDirections = writingDirections
    random = SplitMix64(seed: seed)
  }

  mutating func document() -> JSONValue {
    var blocks: [JSONValue] = []
    for _ in 0..<Int.random(in: 1...3, using: &random) {
      if Int.random(in: 0..<3, using: &random) == 0 {
        blocks.append(table())
        continue
      }
      // Lexical joins a list to the list of its type after it.
      let previousType = blocks.last?["listType"]?.stringValue.flatMap(ListType.init(rawValue:))
      blocks.append(block(unlike: previousType))
    }
    return LexicalJSON.document(blocks)
  }

  private mutating func block(unlike previousType: ListType?) -> JSONValue {
    switch Int.random(in: 0..<9, using: &random) {
    case 0: LexicalJSON.heading(Self.headingTags.randomElement(using: &random)!, inlineNodes())
    case 1: LexicalJSON.quote(inlineNodes())
    case 2: LexicalJSON.horizontalRule
    case 3...5: list(unlike: previousType)
    default: paragraph()
    }
  }

  /// A table as the web's menu leaves one: up to three rows and columns,
  /// perhaps a merged block of cells, and perhaps a width per column.
  private mutating func table() -> JSONValue {
    let rowCount = Int.random(in: 1...3, using: &random)
    let columnCount = Int.random(in: 1...3, using: &random)
    var merged: (row: Int, column: Int, rowSpan: Int, colSpan: Int)?
    if Int.random(in: 0..<2, using: &random) == 0 {
      let row = Int.random(in: 0..<rowCount, using: &random)
      let column = Int.random(in: 0..<columnCount, using: &random)
      merged = (
        row, column, Int.random(in: 1...(rowCount - row), using: &random),
        Int.random(in: 1...(columnCount - column), using: &random)
      )
    }
    let rows: [JSONValue] = (0..<rowCount).map { row in
      let cells: [JSONValue] = (0..<columnCount).compactMap { column in
        var span = (row: 1, column: 1)
        if let merged, (merged.row..<merged.row + merged.rowSpan).contains(row),
          (merged.column..<merged.column + merged.colSpan).contains(column)
        {
          guard row == merged.row, column == merged.column else { return nil }
          span = (merged.rowSpan, merged.colSpan)
        }
        let blocks = (0..<Int.random(in: 1...2, using: &random)).map { _ in paragraph() }
        return LexicalJSON.element(
          "tablecell", blocks,
          [
            "backgroundColor": ([nil, "#eee"] as [JSONValue]).randomElement(using: &random)!, "colSpan": .number(Double(span.column)),
            "headerState": .number(Double(Int.random(in: 0...3, using: &random))), "rowSpan": .number(Double(span.row)),
          ])
      }
      return LexicalJSON.element("tablerow", cells)
    }
    let widths: JSONObject =
      Int.random(in: 0..<2, using: &random) == 0
      ? [:]
      : ["colWidths": .array((0..<columnCount).map { _ in ([80, 92.5, 120] as [JSONValue]).randomElement(using: &random)! })]
    return LexicalJSON.element("table", rows, widths)
  }

  private mutating func paragraph() -> JSONValue {
    LexicalJSON.paragraph(
      inlineNodes(), textFormat: Self.formats.randomElement(using: &random)!,
      textStyle: Self.styles.randomElement(using: &random)!,
      indent: [0, 0, 0, 1, 2].randomElement(using: &random)!)
  }

  /// A list of up to three entries, where an item may be followed by a list
  /// nested in an item of its own, down to three lists deep; or now and then
  /// a chain of an item and a nested list, five to eight lists deep, around
  /// the depth past which the web's editor won't indent. Now and then a
  /// list, nested or not, is marked with the `*` or `+` it was typed with.
  private mutating func list(unlike excluded: ListType? = nil) -> JSONValue {
    let listType = ListType.allCases.filter { $0 != excluded }.randomElement(using: &random)!
    let start = listType == .number && Int.random(in: 0..<4, using: &random) == 0 ? 3 : 1
    let chain = Int.random(in: 0..<4, using: &random) == 0
    let deepest = chain ? Int.random(in: 5...8, using: &random) : 3
    return LexicalJSON.list(
      listType, listEntries(depth: 1, deepest: deepest, chain: chain), start: start, marker: marker(for: listType))
  }

  private mutating func marker(for listType: ListType) -> ListMarker? {
    guard listType != .number, Int.random(in: 0..<4, using: &random) == 0 else { return nil }
    return ListMarker.allCases.filter { $0 != .default }.randomElement(using: &random)
  }

  private mutating func listEntries(depth: Int, deepest: Int, chain: Bool) -> [LexicalJSON.ListEntry] {
    var entries: [LexicalJSON.ListEntry] = []
    for _ in 0..<(chain && depth < deepest ? 2 : Int.random(in: 1...3, using: &random)) {
      if depth < deepest, case .item? = entries.last, chain || Int.random(in: 0..<3, using: &random) == 0 {
        let listType = ListType.allCases.randomElement(using: &random)!
        let nested = listEntries(depth: depth + 1, deepest: deepest, chain: chain)
        entries.append(.nested(listType, nested, marker: marker(for: listType)))
      } else {
        entries.append(.item(inlineNodes(), checked: Bool.random(using: &random)))
      }
    }
    return entries
  }

  private mutating func inlineNodes() -> [JSONValue] {
    var children: [JSONValue] = []
    var previous: (format: TextFormat, style: String)?
    for _ in 0..<Int.random(in: 0...4, using: &random) {
      let isAfterLink = ["link", "autolink"].contains(children.last?["type"]?.stringValue)
      switch Int.random(in: 0..<10, using: &random) {
      case 0, 1:
        children.append(LexicalJSON.lineBreak)
        previous = nil
        continue
      case 2:
        children.append(
          LexicalJSON.tab(
            format: Self.formats.randomElement(using: &random)!, style: Self.styles.randomElement(using: &random)!))
        previous = nil
        continue
      // Lexical joins a link to one of the same URL beside it.
      case 3 where !isAfterLink:
        children.append(LexicalJSON.link(Self.urls.randomElement(using: &random)!, texts(1...2)))
        previous = nil
        continue
      // An autolink stays linked only where a separator or nothing is beside it.
      case 4 where !isAfterLink:
        if case .object(var last)? = children.last, let text = last["text"]?.stringValue, last["type"] == "text" {
          last["text"] = .string(text + " ")
          children[children.count - 1] = .object(last)
        }
        let link = Self.autoLinks.randomElement(using: &random)!
        children.append(
          LexicalJSON.autoLink(
            link.url, [LexicalJSON.text(link.text, format: Self.formats.randomElement(using: &random)!)],
            isUnlinked: Int.random(in: 0..<4, using: &random) == 0))
        previous = nil
        continue
      default: break
      }
      // Adjacent text alike would be merged by Lexical.
      var format: TextFormat
      var style: String
      repeat {
        format = Self.formats.randomElement(using: &random)!
        style = Self.styles.randomElement(using: &random)!
      } while previous.map { $0 == (format, style) } == true
      previous = (format, style)
      let text = text(1...5)
      children.append(
        LexicalJSON.text(children.last?["type"] == "autolink" ? " " + text : text, format: format, style: style))
    }
    return children
  }

  /// Whether a user could issue `command` against `state`: a point in text
  /// sits on a grapheme boundary, and a point in a paragraph sits where no
  /// text is beside it to take it.
  static func isValid(_ command: EditorCommand, in snapshot: Snapshot) -> Bool {
    switch command {
    case .setSelection(let anchor, let focus):
      [anchor, focus].allSatisfy { points(in: snapshot.state).contains($0) }
    case .deleteLine(let backward, let lineBoundary):
      snapshot.selection == nil || lineBoundary == Self.lineBoundary(in: snapshot, backward: backward)
    case .toggleChecked(let path):
      checkboxes(in: snapshot.state).contains(path)
    case .arrow(_, _, let native, _, _, _):
      points(in: snapshot.state).contains(native)
    default:
      true
    }
  }

  /// Where the focus's line starts or ends, taken to be where its block
  /// does, as in a view too wide to wrap it.
  static func lineBoundary(in snapshot: Snapshot, backward: Bool) -> Point {
    guard let focus = snapshot.selection?.focus else { return Point(path: [], offset: 0, type: .element) }
    let path = focus.type == .element ? focus.path : focus.path.dropLast()
    guard let block = snapshot.state.node(at: Array(path)), isLine(block),
      let children = block["children"]?.arrayValue
    else { return focus }
    let index = backward ? 0 : children.count - 1
    guard children.indices.contains(index), let text = children[index]["text"]?.stringValue else {
      return Point(path: Array(path), offset: backward ? 0 : children.count, type: .element)
    }
    return .text(path + [index], backward ? 0 : text.utf16.count)
  }

  /// A block a caret can be in: a paragraph, heading or quote, or a list
  /// item holding content rather than a nested list.
  private static func isLine(_ node: JSONValue) -> Bool {
    ["paragraph", "heading", "quote"].contains(node["type"]?.stringValue)
      || (node["type"] == "listitem" && node["children"]?.arrayValue?.first?["type"] != "list")
  }

  /// Every point a user could put a selection's end at, beside a table
  /// at the top level among them.
  private static func points(in state: JSONValue) -> [Point] {
    let blocks = (state["root"]?["children"]?.arrayValue ?? []).map { $0["type"] == "table" }
    let besideTables = (0...blocks.count).filter { offset in
      (offset > 0 && blocks[offset - 1]) || (offset < blocks.count && blocks[offset])
    }.map { Point(path: [], offset: $0, type: .element) }
    return besideTables + state.nodePaths().flatMap { path -> [Point] in
      guard let node = state.node(at: path) else { return [] }
      switch node["type"]?.stringValue {
      case "text", "tab":
        return graphemeBoundaries(of: node["text"]?.stringValue ?? "").map { .text(path, $0) }
      case _ where isLine(node):
        let isText = (node["children"]?.arrayValue ?? []).map { $0["type"] == "text" || $0["type"] == "tab" }
        return (0...isText.count).filter { offset in
          (offset == 0 || !isText[offset - 1]) && (offset == isText.count || !isText[offset])
        }.map { Point(path: path, offset: $0, type: .element) }
      default:
        return []
      }
    }
  }

  /// For each rule at the top level, a caret at the edge of the block beside
  /// it and the arrow from there toward it, the platform leaving the caret
  /// where it is.
  private static func stepsOntoRules(in state: JSONValue) -> [(caret: Point, key: EditorCommand)] {
    let blocks = state["root"]?["children"]?.arrayValue ?? []
    let points = points(in: state)
    return blocks.indices.filter { blocks[$0]["type"] == "horizontalrule" }.flatMap { rule in
      var steps: [(caret: Point, key: EditorCommand)] = []
      if let end = points.last(where: { $0.path.first == rule - 1 }) {
        steps.append((end, .arrow(.down, extend: false, native: end, atCellEdge: false)))
      }
      if let start = points.first(where: { $0.path.first == rule + 1 }) {
        steps.append((start, .arrow(.up, extend: false, native: start, atCellEdge: false)))
      }
      return steps
    }
  }

  /// The items of checklists that show a box to tap: those holding content.
  private static func checkboxes(in state: JSONValue) -> [[Int]] {
    state.nodePaths().filter { path in
      guard let node = state.node(at: path), node["type"] == "listitem", isLine(node),
        let list = state.node(at: path.dropLast())
      else { return false }
      return list["listType"] == "check"
    }
  }

  private static func graphemeBoundaries(of text: String) -> [Int] {
    [0] + text.indices.map { text[..<text.index(after: $0)].utf16.count }
  }

  mutating func command(for snapshot: Snapshot) -> EditorCommand? {
    if !typing.isEmpty { return typing.removeFirst() }
    let roll = Int.random(in: 0..<(writingDirections ? 128 : 125), using: &random)
    let backward = Int.random(in: 0..<3, using: &random) > 0
    switch roll {
    // With nothing selected, as after undoing back to the loaded document, a
    // user puts the selection somewhere before doing anything else.
    case _ where snapshot.selection == nil, 63..<75:
      let points = Self.points(in: snapshot.state)
      guard let anchor = points.randomElement(using: &random) else { return .selectAll }
      let isRange = Int.random(in: 0..<3, using: &random) == 0
      return .setSelection(anchor: anchor, focus: isRange ? points.randomElement(using: &random)! : anchor)
    case ..<9: return .insertText(text(1...3))
    case ..<16:
      let shortcut =
        Int.random(in: 0..<4, using: &random) == 0
        ? MarkdownRows.row(using: &random) + " " : Self.shortcuts.randomElement(using: &random)!
      typing =
        switch Int.random(in: 0..<4, using: &random) {
        case 0: [.insertText(shortcut), .insertParagraph]
        case 1: [.commitComposition(shortcut)]
        default: shortcut.map { .insertText(String($0)) }
        }
      let blockStarts = Self.points(in: snapshot.state).filter { $0.offset == 0 }
      if Bool.random(using: &random), let start = blockStarts.randomElement(using: &random) {
        return .setSelection(anchor: start, focus: start)
      }
      return typing.removeFirst()
    case ..<23: return .deleteCharacter(backward: backward)
    case ..<26: return .deleteWord(backward: backward)
    case ..<28: return .deleteLine(backward: backward, lineBoundary: Self.lineBoundary(in: snapshot, backward: backward))
    case ..<32: return .insertParagraph
    case ..<35: return .insertLineBreak
    case ..<39: return .formatText(TextFormatType.allCases.randomElement(using: &random)!)
    case ..<41: return .setBlockType(BlockType.allCases.randomElement(using: &random)!)
    case ..<42: return .selectAll
    case ..<44: return .wait(milliseconds: [500, 1000, 2000].randomElement(using: &random)!)
    case ..<47: return .insertList(EditorCommand.ListType.allCases.randomElement(using: &random)!)
    case ..<48: return .removeList
    case ..<50: return .indent
    case ..<51: return .outdent
    case ..<54: return .tab(backward: Int.random(in: 0..<3, using: &random) == 0)
    case ..<56:
      guard let box = Self.checkboxes(in: snapshot.state).randomElement(using: &random) else { return .undo }
      return .toggleChecked(path: box)
    case ..<58: return .toggleLink(url: Int.random(in: 0..<4, using: &random) == 0 ? nil : Self.urls.randomElement(using: &random)!)
    case ..<59: return .editLink(url: Self.urls.randomElement(using: &random)!)
    case ..<61: return .copy
    case ..<63: return .cut
    case ..<83: return .paste(pasted())
    case ..<94: return .undo
    case ..<100: return .redo
    case ..<101:
      return .insertTable(rows: Int.random(in: 1...3, using: &random), columns: Int.random(in: 1...3, using: &random))
    case ..<103: return .insertTableRow(after: backward)
    case ..<105: return .insertTableColumn(after: backward)
    case ..<106: return .deleteTableRow
    case ..<107: return .deleteTableColumn
    // An arrow from the block beside a rule that selects the rule whole,
    // which random points and arrows seldom line up, or else a rule pasted
    // as the web copies one.
    case ..<111:
      guard let (caret, key) = Self.stepsOntoRules(in: snapshot.state).randomElement(using: &random) else {
        return .paste(
          Clipboard(
            plainText: "\n", lexical: LexicalClipboardPayload(namespace: editorNamespace, nodes: [LexicalJSON.horizontalRule])))
      }
      typing = [key]
      return .setSelection(anchor: caret, focus: caret)
    case ..<119:
      let native = Self.points(in: snapshot.state).randomElement(using: &random) ?? Point(path: [], offset: 0, type: .element)
      return .arrow(
        ArrowKey.allCases.randomElement(using: &random)!, extend: Int.random(in: 0..<3, using: &random) == 0,
        native: native, atCellEdge: Bool.random(using: &random), parentRTL: writingDirections && Bool.random(using: &random))
    case ..<120: return .mergeTableCells
    case ..<121: return .unmergeTableCell
    case ..<122: return .deleteTable
    case ..<123: return .toggleTableRowHeader
    case ..<124: return .toggleTableColumnHeader
    case ..<125: return .setTableCellBackground(color: ["#123456", "rgb(10, 20, 30)", ""].randomElement(using: &random)!)
    default: return .setWritingDirection(EditorCommand.WritingDirection.allCases.randomElement(using: &random)!)
    }
  }

  /// What the last copy or cut put on the clipboard, or text from another
  /// app. HTML uses the independent DOM oracle in HTMLPasteTests.
  private mutating func pasted() -> Clipboard {
    if let clipboard, Bool.random(using: &random) { return clipboard }
    let text = (0..<Int.random(in: 1...4, using: &random)).map { _ in
      Bool.random(using: &random) ? self.text(1...3) : Self.pastedParts.randomElement(using: &random)!
    }.joined()
    return Clipboard(plainText: text)
  }

  /// Adjacent text of different formats, which Lexical keeps apart.
  private mutating func texts(_ count: ClosedRange<Int>) -> [JSONValue] {
    var formats: [TextFormat] = []
    for _ in 0..<Int.random(in: count, using: &random) {
      var format: TextFormat
      repeat { format = Self.formats.randomElement(using: &random)! } while format == formats.last
      formats.append(format)
    }
    return formats.map { LexicalJSON.text(text(1...5), format: $0) }
  }

  private mutating func text(_ length: ClosedRange<Int>) -> String {
    (0..<Int.random(in: length, using: &random)).map { _ in
      Self.alphabet.randomElement(using: &random)!
    }.joined()
  }
}

struct SplitMix64: RandomNumberGenerator {
  private var state: UInt64

  init(seed: UInt64) {
    state = seed
  }

  mutating func next() -> UInt64 {
    state &+= 0x9e37_79b9_7f4a_7c15
    var z = state
    z = (z ^ (z >> 30)) &* 0xbf58_476d_1ce4_e5b9
    z = (z ^ (z >> 27)) &* 0x94d0_49bb_1331_11eb
    return z ^ (z >> 31)
  }
}

public struct FuzzerError: Error, CustomStringConvertible {
  public let description: String
  init(_ description: String) { self.description = description }
}

/// A candidate that counts its declined shortcuts, as
/// `Editor.shortcutsDeclinedAsNotPorted` does.
public protocol DeclinesShortcutsNotPortedYet: EditorModel {
  var shortcutsDeclinedAsNotPorted: Int { get }
}

extension Editor: DeclinesShortcutsNotPortedYet {}
