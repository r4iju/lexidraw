import Foundation
import LexicalSwift

/// `{starting state, script} → {expected state}`, recorded from the JS
/// reference so any implementation can be checked against it without one.
public struct Fixture: Codable, Equatable, Sendable {
  public var start: JSONValue
  public var commands: [EditorCommand]
  public var changes: [Change]
  public var expected: Snapshot

  public init(start: JSONValue, commands: [EditorCommand], changes: [Change], expected: Snapshot) {
    self.start = start
    self.commands = commands
    self.changes = changes
    self.expected = expected
  }

  /// What a command changed, or the kind of error it was refused with.
  public enum Change: Equatable, Sendable {
    case applied(ChangeSet)
    case refused(EditorError.Kind)

    /// Applies `command`. An error that isn't an `EditorError` is thrown on,
    /// as a model's bug rather than its answer.
    public init(applying command: EditorCommand, to model: some EditorModel) throws {
      do {
        self = .applied(try model.apply(command))
      } catch let error as EditorError {
        self = .refused(error.kind)
      }
    }
  }

  public struct Outcome: Equatable, Sendable {
    public var changes: [Change]
    public var snapshot: Snapshot
  }

  public var recorded: Outcome { Outcome(changes: changes, snapshot: expected) }

  public func replay(on model: some EditorModel) throws -> Outcome {
    try model.load(start)
    let changes = try commands.map { try Change(applying: $0, to: model) }
    return Outcome(changes: changes, snapshot: try model.snapshot())
  }

  /// Runs the script on the reference and keeps what it produced.
  public static func record(start: JSONValue, commands: [EditorCommand], on reference: some EditorModel)
    throws -> Fixture
  {
    let draft = Fixture(start: start, commands: commands, changes: [], expected: Snapshot(state: start, selection: nil))
    let outcome = try draft.replay(on: reference)
    return Fixture(start: start, commands: commands, changes: outcome.changes, expected: outcome.snapshot)
  }

  public static func read(from url: URL) throws -> Fixture {
    try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
  }

  /// Writes the fixture into `folder`, named by its content so the same
  /// divergence found twice is one file.
  @discardableResult
  public func write(into folder: URL) throws -> URL {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(self)
    let url = folder.appending(path: "fuzz-\(fnv1a(data)).json")
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

extension Fixture.Change: Codable {
  private enum CodingKeys: String, CodingKey {
    case refused
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if let kind = try container.decodeIfPresent(EditorError.Kind.self, forKey: .refused) {
      self = .refused(kind)
    } else {
      self = .applied(try ChangeSet(from: decoder))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    switch self {
    case .applied(let changes):
      try changes.encode(to: encoder)
    case .refused(let kind):
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(kind, forKey: .refused)
    }
  }
}
