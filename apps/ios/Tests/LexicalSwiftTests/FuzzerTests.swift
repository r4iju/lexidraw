import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct FuzzerTests {
  /// LexicalSwift with a plausible bug: it loses the last character typed
  /// when that character isn't ASCII.
  final class DropsTypedNonASCII: EditorModel {
    let editor = Editor()
    func load(_ state: JSONValue) throws { try editor.load(state) }
    func snapshot() throws -> Snapshot { try editor.snapshot() }
    func apply(_ command: EditorCommand) throws -> ChangeSet {
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
  final class ReportsNoChanges: EditorModel {
    let editor = Editor()
    func load(_ state: JSONValue) throws { try editor.load(state) }
    func snapshot() throws -> Snapshot { try editor.snapshot() }
    func apply(_ command: EditorCommand) throws -> ChangeSet {
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

  /// LexicalSwift that refuses what Lexical refuses, but for another reason.
  final class RefusesAsUnsupported: EditorModel {
    let editor = Editor()
    func load(_ state: JSONValue) throws { try editor.load(state) }
    func snapshot() throws -> Snapshot { try editor.snapshot() }
    func apply(_ command: EditorCommand) throws -> ChangeSet {
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

  @Test func theSameSeedFindsTheSameFixture() throws {
    let reference = try Support.referenceEditor()
    var first = Fuzzer(seed: 11, reference: reference, candidate: DropsTypedNonASCII())
    var second = Fuzzer(seed: 11, reference: reference, candidate: DropsTypedNonASCII())

    #expect(try first.run(steps: 500)?.fixture == second.run(steps: 500)?.fixture)
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
      print("Seed \(seed): \(steps) steps agreed, and \(fuzzer.refusals) commands both refused")
    }
  }
}
