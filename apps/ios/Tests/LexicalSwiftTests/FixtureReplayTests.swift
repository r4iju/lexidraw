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
    let outcome = try fixture.replay(on: Editor(editorContext: fixture.editorContext ?? .document))

    #expect(outcome == fixture.recorded)
  }

  /// Fails after a Lexical upgrade that changed behaviour a fixture pins, so
  /// the fixture is re-recorded and LexicalSwift ported, not left stale.
  @Test(arguments: fixtures)
  func theReferenceStillAgrees(_ url: URL) throws {
    let fixture = try Fixture.read(from: url)
    let outcome = try fixture.replay(on: try Support.referenceEditor(editorContext: fixture.editorContext ?? .document))

    #expect(outcome == fixture.recorded)
  }
}
