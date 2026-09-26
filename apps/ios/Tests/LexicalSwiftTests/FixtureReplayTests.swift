import Foundation
import LexicalFuzz
import LexicalSwift
import Testing

@Suite struct FixtureReplayTests {
  static let fixtures: [URL] = {
    let folder = Bundle.module.url(forResource: "Fixtures", withExtension: nil)!
    return (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil))?
      .filter { $0.pathExtension == "json" }
      .sorted { $0.lastPathComponent < $1.lastPathComponent } ?? []
  }()

  @Test(arguments: fixtures)
  func lexicalSwiftMatchesTheRecordedReference(_ url: URL) throws {
    let fixture = try Fixture.read(from: url)
    let outcome = try fixture.replay(on: Editor())

    #expect(outcome.refused == fixture.refused)
    #expect(outcome.snapshot == fixture.expected)
  }

  /// Fails after a Lexical upgrade that changed behaviour a fixture pins, so
  /// the fixture is re-recorded and LexicalSwift ported, not left stale.
  @Test(arguments: fixtures)
  func theReferenceStillAgrees(_ url: URL) throws {
    let fixture = try Fixture.read(from: url)
    let outcome = try fixture.replay(on: try Support.referenceEditor())

    #expect(outcome.refused == fixture.refused)
    #expect(outcome.snapshot == fixture.expected)
  }
}
