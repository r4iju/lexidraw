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
  /// Sessions ended where LexicalSwift declined a shortcut it doesn't port
  /// yet and disagreed, or where Lexical made a node it doesn't edit yet.
  public private(set) var sessionsEndedNotPortedYet = 0

  /// The node types Lexical's markdown shortcuts make that LexicalSwift's
  /// don't yet.
  public static let notPortedYet = Editor.typesMarkdownShortcutsNotPortedYetMake

  /// Whether a step ends its session rather than disagreeing: LexicalSwift
  /// took what was typed as text where it declined a shortcut not ported
  /// yet (`declinedAShortcut`), or where Lexical made a node of a type not
  /// ported yet. Nothing after it could agree.
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

  public init(seed: UInt64, reference: some EditorModel, candidate: some EditorModel) {
    self.reference = reference
    self.candidate = candidate
    self.generator = Generator(seed: seed)
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
        guard let command = generator.command(for: try reference.snapshot()) else { break }
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
        if case .applied = step.change {
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
    var snapshot: Snapshot?
  }

  private func step(_ model: any EditorModel, _ command: EditorCommand) throws -> Step {
    Step(change: try Fixture.Change(applying: command, to: model), snapshot: try? model.snapshot())
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
    if let before, let after = referenceStep.snapshot,
      Self.isNotPortedYet(
        candidate: candidateStep.change, referenceBefore: before, referenceAfter: after,
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
        guard (try? reference.load(candidate.start)) != nil,
          let start = try? reference.snapshot().state,
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
    for path in paths.reversed() {
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
/// rules, with text, tabs and line breaks, and random editing commands a
/// user could issue against them.
struct Generator {
  private var random: SplitMix64

  /// Characters chosen to stress UTF-16 offsets and word boundaries: accents,
  /// combining marks, CJK, emoji that are several code units and several
  /// scalars, and punctuation and spaces between words; Japanese words,
  /// which ICU segments with a dictionary as no space marks where they end;
  /// and what markdown shortcuts are typed with.
  private static let alphabet: [String] = [
    "a", "b", "z", " ", " ", ".", "_", "7", "1", "é", "e\u{301}", "ß", "日", "本", "語", "한", "👍", "👍🏽",
    "👨‍👩‍👧", "🇯🇵", "日本語", "東京", "話す", "を", "は", "ひらがな", "カタカナ", "#", ">", "*", "~", "=", "`", "-", "[", "]",
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
    "[x] ", "- [ ] ", "``` ",
  ]
  /// The rest of a shortcut being typed.
  private var typing: [EditorCommand] = []

  init(seed: UInt64) {
    random = SplitMix64(seed: seed)
  }

  mutating func document() -> JSONValue {
    var blocks: [JSONValue] = []
    for _ in 0..<Int.random(in: 1...3, using: &random) {
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
  /// list is marked with the `*` or `+` it was typed with.
  private mutating func list(unlike excluded: ListType? = nil) -> JSONValue {
    let listType = ListType.allCases.filter { $0 != excluded }.randomElement(using: &random)!
    let start = listType == .number && Int.random(in: 0..<4, using: &random) == 0 ? 3 : 1
    let chain = Int.random(in: 0..<4, using: &random) == 0
    let deepest = chain ? Int.random(in: 5...8, using: &random) : 3
    let marker = listType != .number && Int.random(in: 0..<4, using: &random) == 0 ? ListMarker.asterisk : nil
    return LexicalJSON.list(
      listType, listEntries(depth: 1, deepest: deepest, chain: chain), start: start, marker: marker)
  }

  private mutating func listEntries(depth: Int, deepest: Int, chain: Bool) -> [LexicalJSON.ListEntry] {
    var entries: [LexicalJSON.ListEntry] = []
    for _ in 0..<(chain && depth < deepest ? 2 : Int.random(in: 1...3, using: &random)) {
      if depth < deepest, case .item? = entries.last, chain || Int.random(in: 0..<3, using: &random) == 0 {
        let listType = ListType.allCases.randomElement(using: &random)!
        entries.append(.nested(listType, listEntries(depth: depth + 1, deepest: deepest, chain: chain)))
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
      switch Int.random(in: 0..<8, using: &random) {
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
      children.append(LexicalJSON.text(text(1...5), format: format, style: style))
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

  /// Every point a user could put a selection's end at.
  private static func points(in state: JSONValue) -> [Point] {
    state.nodePaths().flatMap { path -> [Point] in
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
    let roll = Int.random(in: 0..<100, using: &random)
    let backward = Int.random(in: 0..<3, using: &random) > 0
    switch roll {
    // With nothing selected, as after undoing back to the loaded document, a
    // user puts the selection somewhere before doing anything else.
    case _ where snapshot.selection == nil, 57..<72:
      let points = Self.points(in: snapshot.state)
      guard let anchor = points.randomElement(using: &random) else { return .selectAll }
      let isRange = Int.random(in: 0..<3, using: &random) == 0
      return .setSelection(anchor: anchor, focus: isRange ? points.randomElement(using: &random)! : anchor)
    case ..<10: return .insertText(text(1...3))
    case ..<18:
      let shortcut = Self.shortcuts.randomElement(using: &random)!
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
    case ..<28: return .deleteCharacter(backward: backward)
    case ..<32: return .deleteWord(backward: backward)
    case ..<35: return .deleteLine(backward: backward, lineBoundary: Self.lineBoundary(in: snapshot, backward: backward))
    case ..<41: return .insertParagraph
    case ..<45: return .insertLineBreak
    case ..<50: return .formatText(TextFormatType.allCases.randomElement(using: &random)!)
    case ..<52: return .setBlockType(BlockType.allCases.randomElement(using: &random)!)
    case ..<54: return .selectAll
    case ..<57: return .wait(milliseconds: [500, 1000, 2000].randomElement(using: &random)!)
    case ..<76: return .insertList(EditorCommand.ListType.allCases.randomElement(using: &random)!)
    case ..<78: return .removeList
    case ..<80: return .indent
    case ..<82: return .outdent
    case ..<86: return .tab(backward: Int.random(in: 0..<3, using: &random) == 0)
    case ..<88:
      guard let box = Self.checkboxes(in: snapshot.state).randomElement(using: &random) else { return .undo }
      return .toggleChecked(path: box)
    case ..<96: return .undo
    default: return .redo
    }
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

/// A candidate that counts the markdown shortcuts it declined because it
/// doesn't port their transformers yet.
public protocol DeclinesShortcutsNotPortedYet: EditorModel {
  var shortcutsDeclinedAsNotPorted: Int { get }
}

extension Editor: DeclinesShortcutsNotPortedYet {}
