import LexicalSwift

/// Differential fuzzer: drives the reference and a candidate with the same
/// random scripts, compares refusals and snapshots after every command, and
/// shrinks the first divergence to a minimal fixture recorded from the
/// reference. Deterministic for a given seed.
public struct Fuzzer {
  public struct Finding {
    public var fixture: Fixture
    public var stepsRun: Int
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

  /// Runs up to `steps` commands. Returns the first divergence, shrunk.
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
      for _ in 0..<min(sessionLength, steps - stepsRun) {
        guard let command = generator.command(for: try reference.snapshot()) else { break }
        commands.append(command)
        stepsRun += 1
        let expected = step(reference, command)
        guard !expected.refused, expected.snapshot != nil else {
          throw FuzzerError("The reference refused a generated command: \(command)")
        }
        if step(candidate, command) != expected {
          let (start, commands) = shrink(start: start, commands: commands)
          let fixture = try Fixture.record(start: start, commands: commands, on: reference)
          return Finding(fixture: fixture, stepsRun: stepsRun)
        }
      }
    }
    return nil
  }

  private struct Step: Equatable {
    var refused: Bool
    var snapshot: Snapshot?
  }

  private func step(_ model: any EditorModel, _ command: EditorCommand) -> Step {
    let refused = (try? model.apply(command)) == nil
    return Step(refused: refused, snapshot: try? model.snapshot())
  }

  /// Whether the script makes the candidate diverge, counting only scripts
  /// the generator could have produced: a document the reference loads
  /// unchanged, and commands it accepts. Shrinking otherwise drifts into
  /// load normalization or refusals, which the corpus check and explicit
  /// fixtures cover instead.
  private func diverges(start: JSONValue, commands: [EditorCommand]) -> Bool {
    guard (try? reference.load(start)) != nil, (try? reference.snapshot())?.state == start else {
      return false
    }
    guard (try? candidate.load(start)) != nil else { return true }
    for command in commands {
      guard let before = try? reference.snapshot(), Generator.isValid(command, in: before.state) else {
        return false
      }
      let expected = step(reference, command)
      guard !expected.refused, expected.snapshot != nil else { return false }
      if step(candidate, command) != expected { return true }
    }
    return false
  }

  private func shrink(start: JSONValue, commands: [EditorCommand]) -> (JSONValue, [EditorCommand]) {
    var best = (start: start, commands: commands)
    var improved = true
    while improved {
      improved = false
      for candidate in smaller(than: best) {
        // Removing a node can leave its parent in a shape Lexical would rewrite
        // on load; take Lexical's own version so the document stays canonical.
        guard (try? reference.load(candidate.start)) != nil,
          let start = try? reference.snapshot().state,
          diverges(start: start, commands: candidate.commands)
        else { continue }
        best = (start, candidate.commands)
        improved = true
        break
      }
    }
    return best
  }

  /// One-step reductions of a script, most aggressive first.
  private func smaller(than script: (start: JSONValue, commands: [EditorCommand]))
    -> [(start: JSONValue, commands: [EditorCommand])]
  {
    var result: [(start: JSONValue, commands: [EditorCommand])] = []
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
      guard case .setSelection(let anchor, let focus) = command, anchor == focus, anchor.offset > 0 else {
        continue
      }
      var commands = script.commands
      commands[index] = .caret(Point(path: anchor.path, offset: 0, type: anchor.type))
      result.append((script.start, commands))
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
      guard case .insertText(let text) = command, text.count > 1 else { continue }
      for shorter in text.removingEachCharacter() {
        var commands = script.commands
        commands[index] = .insertText(shorter)
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
      guard point.path.count > depth, point.path[..<depth] == removed[..<depth],
        point.path[depth] > removed[depth]
      else { return point }
      var point = point
      point.path[depth] -= 1
      return point
    }
    guard case .setSelection(let anchor, let focus) = self else { return self }
    return .setSelection(anchor: adjust(anchor), focus: adjust(focus))
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

/// Random documents and commands within what LexicalSwift handles so far.
struct Generator {
  private var random: SplitMix64

  /// Characters chosen to stress UTF-16 offsets: accents, combining marks,
  /// CJK, and emoji that are several code units and several scalars.
  private static let alphabet: [String] = [
    "a", "b", "z", " ", ".", "é", "e\u{301}", "ß", "日", "本", "語", "한", "👍", "👍🏽", "👨‍👩‍👧", "🇯🇵",
  ]
  private static let formats = [0, 1, 2, 3, 8, 16]

  init(seed: UInt64) {
    random = SplitMix64(seed: seed)
  }

  mutating func document() -> JSONValue {
    LexicalJSON.document(
      (0..<Int.random(in: 1...3, using: &random)).map { _ in
        var previousFormat: Int?
        return LexicalJSON.paragraph(
          (0..<Int.random(in: 1...3, using: &random)).map { _ in
            // Adjacent text with the same format would be merged by Lexical.
            let format = Self.formats.filter { $0 != previousFormat }.randomElement(using: &random)!
            previousFormat = format
            return LexicalJSON.text(text(1...5), format: format)
          })
      })
  }

  /// Whether a user could issue `command` against `state`: a caret must sit
  /// in a text node, on a grapheme boundary.
  static func isValid(_ command: EditorCommand, in state: JSONValue) -> Bool {
    guard case .setSelection(let anchor, let focus) = command else { return true }
    return [anchor, focus].allSatisfy { point in
      guard point.type == .text, let text = state.node(at: point.path)?["text"]?.stringValue else {
        return false
      }
      return graphemeBoundaries(of: text).contains(point.offset)
    }
  }

  private static func graphemeBoundaries(of text: String) -> [Int] {
    [0] + text.indices.map { text[..<text.index(after: $0)].utf16.count }
  }

  mutating func command(for snapshot: Snapshot) -> EditorCommand? {
    if snapshot.selection != nil, Int.random(in: 0..<10, using: &random) < 7 {
      return .insertText(text(1...3))
    }
    let texts = snapshot.state.nodePaths().filter { snapshot.state.node(at: $0)?["type"] == "text" }
    guard let path = texts.randomElement(using: &random),
      let text = snapshot.state.node(at: path)?["text"]?.stringValue
    else { return nil }
    return .caret(.text(path, Self.graphemeBoundaries(of: text).randomElement(using: &random)!))
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
