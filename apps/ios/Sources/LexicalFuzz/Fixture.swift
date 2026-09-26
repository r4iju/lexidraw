import Foundation
import LexicalSwift

/// `{starting state, script} → {expected state}`, recorded from the JS
/// reference so any implementation can be checked against it without one.
public struct Fixture: Codable, Equatable, Sendable {
  public var start: JSONValue
  public var commands: [EditorCommand]
  /// Indexes of the commands the reference refused (threw on).
  public var refused: [Int]
  public var expected: Snapshot

  public init(start: JSONValue, commands: [EditorCommand], refused: [Int], expected: Snapshot) {
    self.start = start
    self.commands = commands
    self.refused = refused
    self.expected = expected
  }

  public struct Outcome: Equatable, Sendable {
    public var refused: [Int]
    public var snapshot: Snapshot
  }

  public func replay(on model: some EditorModel) throws -> Outcome {
    try model.load(start)
    var refused: [Int] = []
    for (index, command) in commands.enumerated() {
      do { try model.apply(command) } catch { refused.append(index) }
    }
    return Outcome(refused: refused, snapshot: try model.snapshot())
  }

  /// Runs the script on the reference and keeps what it produced.
  public static func record(start: JSONValue, commands: [EditorCommand], on reference: some EditorModel)
    throws -> Fixture
  {
    let draft = Fixture(start: start, commands: commands, refused: [], expected: Snapshot(state: start, selection: nil))
    let outcome = try draft.replay(on: reference)
    return Fixture(start: start, commands: commands, refused: outcome.refused, expected: outcome.snapshot)
  }

  public static func read(from url: URL) throws -> Fixture {
    try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
  }

  /// Writes the fixture into `folder`, named by its content so the same
  /// divergence found twice is one file.
  @discardableResult
  public func write(into folder: URL, prefix: String = "fuzz") throws -> URL {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(self)
    let url = folder.appending(path: "\(prefix)-\(fnv1a(data)).json")
    try (data + Data("\n".utf8)).write(to: url)
    return url
  }
}

private func fnv1a(_ data: Data) -> String {
  var hash: UInt64 = 0xcbf2_9ce4_8422_2325
  for byte in data {
    hash ^= UInt64(byte)
    hash &*= 0x100_0000_01b3
  }
  return String(hash, radix: 16)
}
