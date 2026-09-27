import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct FuzzerTests {
  /// LexicalSwift with a change to what `apply` does, for a bug to find.
  class LexicalSwiftWith: DeclinesShortcutsNotPortedYet {
    let editor = Editor()
    var shortcutsDeclinedAsNotPorted: Int { editor.shortcutsDeclinedAsNotPorted }
    func load(_ state: JSONValue) throws { try editor.load(state) }
    var isEditable: Bool { editor.isEditable }
    func snapshot() throws -> Snapshot { try editor.snapshot() }
    func selection() throws -> Selection? { try editor.selection() }
    func node(at path: [Int]) throws -> JSONValue { try editor.node(at: path) }
    func childKeys(at path: [Int]) throws -> [String] { try editor.childKeys(at: path) }
    func apply(_ command: EditorCommand) throws -> ChangeSet { try editor.apply(command) }
  }

  /// LexicalSwift with a plausible bug: it loses the last character typed
  /// when that character isn't ASCII.
  final class DropsTypedNonASCII: LexicalSwiftWith {
    override func apply(_ command: EditorCommand) throws -> ChangeSet {
      if case .insertText(let text) = command, let last = text.last, !last.isASCII {
        return try editor.apply(.insertText(String(text.dropLast())))
      }
      return try editor.apply(command)
    }
  }

  @Test func findsADivergenceAndShrinksItToAMinimalFixture() throws {
    var fuzzer = Fuzzer(seed: 7, reference: try Support.referenceEditor(), candidate: DropsTypedNonASCII())

    let finding = try #require(try fuzzer.run(steps: 500))

    let fixture = finding.fixture
    let paragraphs = fixture.start["root"]?["children"]?.arrayValue ?? []
    #expect(paragraphs.count == 1)
    #expect((paragraphs.first?["children"]?.arrayValue?.count ?? 0) <= 1)
    #expect(fixture.commands.count == 2)
    guard case .insertText(let typed) = fixture.commands.last else {
      Issue.record("The shrunk script should end by typing")
      return
    }
    #expect(typed.count == 1 && !typed.first!.isASCII)
    #expect(try fixture.replay(on: DropsTypedNonASCII()).snapshot != fixture.expected)
    #expect(try fixture.replay(on: Editor()).snapshot == fixture.expected)
  }

  /// LexicalSwift that edits correctly but tells a view nothing changed.
  final class ReportsNoChanges: LexicalSwiftWith {
    override func apply(_ command: EditorCommand) throws -> ChangeSet {
      try editor.apply(command)
      return ChangeSet()
    }
  }

  @Test func findsAChangeSetThatDisagrees() throws {
    var fuzzer = Fuzzer(seed: 7, reference: try Support.referenceEditor(), candidate: ReportsNoChanges())

    let fixture = try #require(try fuzzer.run(steps: 500)).fixture

    #expect(fixture.commands.count == 2)
    #expect(try fixture.replay(on: ReportsNoChanges()) != fixture.recorded)
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  /// LexicalSwift that takes a composition as typing, so it misses a
  /// shortcut a composition finishes.
  final class TakesACompositionAsTyping: LexicalSwiftWith {
    override func apply(_ command: EditorCommand) throws -> ChangeSet {
      if case .commitComposition(let text) = command { return try editor.apply(.insertText(text)) }
      return try editor.apply(command)
    }
  }

  @Test func findsAShortcutACompositionFinishes() throws {
    var fuzzer = Fuzzer(seed: 7, reference: try Support.referenceEditor(), candidate: TakesACompositionAsTyping())

    let fixture = try #require(try fuzzer.run(steps: 2000)).fixture

    guard case .commitComposition = fixture.commands.last else {
      Issue.record("The shrunk script should end by committing a composition")
      return
    }
  }

  /// LexicalSwift that takes Enter after a block's shortcut as a new line.
  final class TakesEnterAfterAShortcutAsANewLine: LexicalSwiftWith {
    override func apply(_ command: EditorCommand) throws -> ChangeSet {
      if command == .insertParagraph, let anchor = try editor.selection()?.anchor, anchor.type == .text,
        let text = try editor.node(at: anchor.path)["text"]?.stringValue, try Regex("(#{1,6}|>) ").wholeMatch(in: text) != nil
      {
        return try editor.apply(.insertLineBreak)
      }
      return try editor.apply(command)
    }
  }

  @Test func findsAShortcutEnterFinishes() throws {
    var fuzzer = Fuzzer(
      seed: 2, reference: try Support.referenceEditor(), candidate: TakesEnterAfterAShortcutAsANewLine())

    let fixture = try #require(try fuzzer.run(steps: 2000)).fixture

    #expect(fixture.commands.last == .insertParagraph)
  }

  /// LexicalSwift that notes each indent asked for in an item as deep as
  /// the web's editor indents.
  final class NotesIndentsAtTheCap: LexicalSwiftWith {
    var indentsAtTheCap = 0

    override func apply(_ command: EditorCommand) throws -> ChangeSet {
      if command == .indent || command == .tab(backward: false), let anchor = try editor.selection()?.anchor {
        let state = try editor.snapshot().state
        let lists = anchor.path.indices.filter { state.node(at: Array(anchor.path[...$0]))?["type"] == "list" }
        if lists.count >= 6 { indentsAtTheCap += 1 }
      }
      return try editor.apply(command)
    }
  }

  @Test func indentsItemsAsDeepAsTheWebIndents() throws {
    let candidate = NotesIndentsAtTheCap()
    var fuzzer = Fuzzer(seed: 7, reference: try Support.referenceEditor(), candidate: candidate)

    #expect(try fuzzer.run(steps: 3_000)?.fixture == nil)
    #expect(candidate.indentsAtTheCap > 0)
  }

  /// LexicalSwift that notes the marker of each list it loads, and whether
  /// the list is nested, and each shortcut typed after a tab.
  final class NotesMarkersAndTabbedShortcuts: LexicalSwiftWith {
    struct Marked: Hashable {
      var marker: String
      var nested: Bool
    }
    var marked: Set<Marked> = []
    var tabbedShortcuts = 0
    private var typed = ""

    override func load(_ state: JSONValue) throws {
      func note(_ node: JSONValue, lists: Int) {
        if let marker = node["$"]?["mdListMarker"]?.stringValue {
          marked.insert(Marked(marker: marker, nested: lists > 0))
        }
        let lists = node["type"] == "list" ? lists + 1 : lists
        for child in node["children"]?.arrayValue ?? [] { note(child, lists: lists) }
      }
      note(state["root"] ?? .null, lists: 0)
      try super.load(state)
    }

    override func apply(_ command: EditorCommand) throws -> ChangeSet {
      if case .insertText(let text) = command {
        typed = String((typed + text).suffix(3))
        if typed == "\t- " { tabbedShortcuts += 1 }
      } else {
        typed = ""
      }
      return try super.apply(command)
    }
  }

  @Test func loadsListsMarkedWithEachMarkNestedOrNotAndTypesATabbedShortcut() throws {
    let candidate = NotesMarkersAndTabbedShortcuts()
    var fuzzer = Fuzzer(seed: 7, reference: try Support.referenceEditor(), candidate: candidate)

    #expect(try fuzzer.run(steps: 3_000)?.fixture == nil)
    #expect(
      candidate.marked
        == [.init(marker: "*", nested: false), .init(marker: "+", nested: false), .init(marker: "*", nested: true),
          .init(marker: "+", nested: true)])
    #expect(candidate.tabbedShortcuts > 0)
  }

  /// A model that can't read back any state a command changed, as Lexical
  /// can't read back a table selection over a table a range deleted across
  /// two tables left ragged.
  final class ReadsBackOnlyWhatItLoaded: EditorModel {
    let model: any EditorModel
    var changed = false
    init(_ model: any EditorModel) { self.model = model }
    func load(_ state: JSONValue) throws {
      try model.load(state)
      changed = false
    }
    var isEditable: Bool { model.isEditable }
    func snapshot() throws -> Snapshot {
      if changed { throw EditorError.invalidState("TypeError: Cannot destructure property 'cell'") }
      return try model.snapshot()
    }
    func selection() throws -> Selection? { try model.selection() }
    func node(at path: [Int]) throws -> JSONValue { try model.node(at: path) }
    func childKeys(at path: [Int]) throws -> [String] { try model.childKeys(at: path) }
    func apply(_ command: EditorCommand) throws -> ChangeSet {
      let changes = try model.apply(command)
      changed = true
      return changes
    }
  }

  @Test func aSessionEndsWhereNeitherModelCanReadItsStateBack() throws {
    var fuzzer = Fuzzer(
      seed: 7, reference: ReadsBackOnlyWhatItLoaded(try Support.referenceEditor()),
      candidate: ReadsBackOnlyWhatItLoaded(Editor()))

    #expect(try fuzzer.run(steps: 20) == nil)
    #expect(fuzzer.sessionsEndedUnreadable > 0)
  }

  /// LexicalSwift that refuses what Lexical refuses, but for another reason.
  final class RefusesAsUnsupported: LexicalSwiftWith {
    override func apply(_ command: EditorCommand) throws -> ChangeSet {
      do {
        return try editor.apply(command)
      } catch {
        throw EditorError.unsupported("\(error)")
      }
    }
  }

  @Test func aRefusalForAnotherReasonDisagrees() throws {
    let fixture = try Fixture.record(
      start: document(paragraph(text("a"))), commands: [.caret(.text([3], 0))], on: try Support.referenceEditor())

    #expect(fixture.changes == [.refused(.noNode)])
    #expect(try fixture.replay(on: RefusesAsUnsupported()) != fixture.recorded)
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  /// What counts as a word is ICU's to say, and its rules change between OS
  /// releases: "½" is never a word, and on macOS 26 a word deleted forward
  /// from the start of "7🇯🇵" takes all of it.
  @Test(arguments: ["½ b", "7🇯🇵"])
  func aWordDeleteAgreesWithTheReferenceOnThisOS(_ content: String) throws {
    let commands: [EditorCommand] = [.caret(.text([0, 0], 0)), .deleteWord(backward: false)]
    let fixture = try Fixture.record(
      start: document(paragraph(text(content))), commands: commands, on: try Support.referenceEditor())

    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  @Test func theSameSeedFindsTheSameFixture() throws {
    let reference = try Support.referenceEditor()
    var first = Fuzzer(seed: 11, reference: reference, candidate: DropsTypedNonASCII())
    var second = Fuzzer(seed: 11, reference: reference, candidate: DropsTypedNonASCII())

    #expect(try first.run(steps: 500)?.fixture == second.run(steps: 500)?.fixture)
  }

  @Test func theTypesNotPortedYetAreWhatTheShortcutsNotPortedYetMake() {
    #expect(Fuzzer.notPortedYet == Editor.typesMarkdownShortcutsNotPortedYetMake)
    #expect(Fuzzer.notPortedYet.contains("code"))
  }

  @Test func noTypeLexicalSwiftEditsIsNotPortedYet() {
    #expect(
      Fuzzer.notPortedYet.isDisjoint(
        with: ["root", "paragraph", "heading", "quote", "list", "listitem", "text", "linebreak", "horizontalrule"]))
  }

  /// Typing "``` " makes a code block in Lexical, where LexicalSwift keeps
  /// the text.
  private func typingACodeShortcut() throws -> (fixture: Fixture, candidate: Fixture.Outcome, before: Snapshot) {
    let reference = try Support.referenceEditor()
    let start = document(paragraph())
    let caret = EditorCommand.caret(Point(path: [0], offset: 0, type: .element))
    let before = try Fixture.record(start: start, commands: [caret, .insertText("```")], on: reference).expected
    let fixture = try Fixture.record(
      start: start, commands: [caret, .insertText("```"), .insertText(" ")], on: reference)
    return (fixture, try fixture.replay(on: Editor()), before)
  }

  @Test func aSessionEndsWhereLexicalMakesWhatLexicalSwiftDoesNotEditYet() throws {
    let (fixture, candidate, before) = try typingACodeShortcut()

    #expect(
      Fuzzer.isNotPortedYet(candidate: candidate.changes.last!, referenceBefore: before, referenceAfter: fixture.expected))
  }

  @Test func refusingWhereLexicalMakesWhatLexicalSwiftDoesNotEditYetDisagrees() throws {
    let (fixture, _, before) = try typingACodeShortcut()

    #expect(
      !Fuzzer.isNotPortedYet(
        candidate: .refused(.unsupported), referenceBefore: before, referenceAfter: fixture.expected))
  }

  @Test func doingOtherwiseWhereLexicalMakesNothingNewDisagrees() throws {
    let (_, _, before) = try typingACodeShortcut()

    #expect(
      !Fuzzer.isNotPortedYet(candidate: .applied(ChangeSet(changed: [[0]])), referenceBefore: before, referenceAfter: before))
  }

  /// Typing into a list straight after the list takes the caret, Lexical's
  /// CODE transformer takes the list for the block: its items go into a code
  /// block and lift back out of it into a list, and the emptied code block
  /// goes. No code node is left, but LexicalSwift declined the shortcut, so
  /// the session ends rather than disagreeing (seed 11610).
  @Test func aSessionEndsWhereLexicalSwiftDeclinesAShortcutNotPortedYet() throws {
    let fuzzer = Fuzzer(seed: 0, reference: try Support.referenceEditor(), candidate: Editor())

    let verdict = try fuzzer.verdict(
      start: document(heading("h3"), list(.number, [.item([])])),
      commands: [EditorCommand.caret(Point(path: [0], offset: 0, type: .element)), .insertList(.number)]
        + "``` ".map { EditorCommand.insertText(String($0)) })

    #expect(verdict == .endedNotPortedYet)
  }

  /// LexicalSwift that says it declined a shortcut at every command.
  final class SaysItDeclinesEveryShortcut: LexicalSwiftWith {
    private var commands = 0
    override var shortcutsDeclinedAsNotPorted: Int { commands }
    override func apply(_ command: EditorCommand) throws -> ChangeSet {
      commands += 1
      return try editor.apply(command)
    }
  }

  /// A declined shortcut ends a session only on a step that disagrees.
  @Test func aDeclinedShortcutWhereBothAgreeCarriesOn() throws {
    let fuzzer = Fuzzer(seed: 0, reference: try Support.referenceEditor(), candidate: SaysItDeclinesEveryShortcut())

    let verdict = try fuzzer.verdict(
      start: document(paragraph()),
      commands: [EditorCommand.caret(Point(path: [0], offset: 0, type: .element))]
        + "ab ".map { EditorCommand.insertText(String($0)) })

    #expect(verdict == .agreed)
  }

  /// LexicalSwift that says it declined a shortcut at its first command, and
  /// drops a non-ASCII character typed later.
  final class DeclinesOnceThenDropsTypedNonASCII: LexicalSwiftWith {
    private var declined = 0
    override var shortcutsDeclinedAsNotPorted: Int { declined }
    override func apply(_ command: EditorCommand) throws -> ChangeSet {
      declined = 1
      if case .insertText(let text) = command, let last = text.last, !last.isASCII {
        return try editor.apply(.insertText(String(text.dropLast())))
      }
      return try editor.apply(command)
    }
  }

  /// A shortcut declined on an earlier step doesn't excuse a later step that
  /// disagrees.
  @Test func aDisagreementAfterAnEarlierDeclinedShortcutDiverges() throws {
    let fuzzer = Fuzzer(
      seed: 0, reference: try Support.referenceEditor(), candidate: DeclinesOnceThenDropsTypedNonASCII())

    let verdict = try fuzzer.verdict(
      start: document(paragraph()),
      commands: [EditorCommand.caret(Point(path: [0], offset: 0, type: .element)), .insertText("a"), .insertText("é")])

    #expect(verdict == .diverged)
  }

  /// The differential check proper. Budget and seed come from FUZZ_STEPS and
  /// FUZZ_SEED; every divergence is written as a fixture to commit.
  @Test func lexicalSwiftMatchesTheReference() throws {
    let steps = Support.environment("FUZZ_STEPS").flatMap(Int.init) ?? 2_000
    let seed = Support.environment("FUZZ_SEED").flatMap(UInt64.init) ?? UInt64.random(in: 0...UInt64.max)
    var fuzzer = Fuzzer(seed: seed, reference: try Support.referenceEditor(), candidate: Editor())

    let finding: Fuzzer.Finding?
    do {
      finding = try fuzzer.run(steps: steps)
    } catch {
      Issue.record("Seed \(seed) failed: \(error)")
      return
    }
    if let finding {
      let url = try finding.fixture.write(into: Support.fixturesSource)
      Issue.record("Seed \(seed) diverged after \(finding.stepsRun) steps; shrunk fixture written to \(url.path)")
    } else {
      print(
        "Seed \(seed): \(steps) steps agreed, \(fuzzer.refusals) commands both refused, "
          + "\(fuzzer.sessionsEndedNotPortedYet) sessions ended on a shortcut or node not ported yet, and "
          + "\(fuzzer.sessionsEndedUnreadable) where neither model could read its state back")
    }
  }
}
