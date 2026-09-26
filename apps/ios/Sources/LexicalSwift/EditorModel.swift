/// The editor-model interface: everything a view needs from a document model,
/// and the seam the reference fixtures and differential fuzzer test at.
public protocol EditorModel: AnyObject {
  /// Replaces the document with a serialized Lexical editor state
  /// (`{"root": …}`) and clears the selection.
  func load(_ state: JSONValue) throws

  /// Applies one command as a single update. A command that throws leaves the
  /// document and selection as they were.
  @discardableResult
  func apply(_ command: EditorCommand) throws -> ChangeSet

  /// The serialized editor state and the selection.
  func snapshot() throws -> Snapshot
}

public struct Snapshot: Codable, Equatable, Sendable {
  public var state: JSONValue
  public var selection: Selection?

  public init(state: JSONValue, selection: Selection?) {
    self.state = state
    self.selection = selection
  }
}

/// A range selection. Points are addressed by path (child indexes from the
/// root) rather than node key, so two implementations can be compared.
public struct Selection: Codable, Equatable, Sendable {
  public var anchor: Point
  public var focus: Point
  /// Text format bits new text takes, as Lexical's `RangeSelection.format`.
  public var format: Int
  public var style: String

  public init(anchor: Point, focus: Point, format: Int, style: String) {
    self.anchor = anchor
    self.focus = focus
    self.format = format
    self.style = style
  }

  public var isCollapsed: Bool { anchor == focus }
}

public struct Point: Codable, Equatable, Hashable, Sendable {
  public enum Kind: String, Codable, Sendable {
    case text
    case element
  }

  public var path: [Int]
  /// UTF-16 code units into a text node, or a child index into an element.
  public var offset: Int
  public var type: Kind

  public init(path: [Int], offset: Int, type: Kind) {
    self.path = path
    self.offset = offset
    self.type = type
  }

  public static func text(_ path: [Int], _ offset: Int) -> Point {
    Point(path: path, offset: offset, type: .text)
  }
}

public enum EditorCommand: Equatable, Sendable {
  /// Places the selection as a user does; the selection's format and style
  /// follow what it lands in.
  case setSelection(anchor: Point, focus: Point)
  case insertText(String)

  public static func caret(_ point: Point) -> EditorCommand {
    .setSelection(anchor: point, focus: point)
  }
}

extension EditorCommand: Codable {
  private enum CodingKeys: String, CodingKey {
    case type, anchor, focus, text
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    switch try container.decode(String.self, forKey: .type) {
    case "setSelection":
      self = .setSelection(
        anchor: try container.decode(Point.self, forKey: .anchor),
        focus: try container.decode(Point.self, forKey: .focus))
    case "insertText":
      self = .insertText(try container.decode(String.self, forKey: .text))
    case let type:
      throw DecodingError.dataCorruptedError(
        forKey: .type, in: container, debugDescription: "Unknown command \(type)")
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .setSelection(let anchor, let focus):
      try container.encode("setSelection", forKey: .type)
      try container.encode(anchor, forKey: .anchor)
      try container.encode(focus, forKey: .focus)
    case .insertText(let text):
      try container.encode("insertText", forKey: .type)
      try container.encode(text, forKey: .text)
    }
  }
}

/// The paths, in the document after an update, of the nodes it created or
/// changed. Removing a node changes its parent.
public struct ChangeSet: Equatable, Sendable {
  public var changed: Set<[Int]>

  public init(changed: Set<[Int]> = []) {
    self.changed = changed
  }
}

extension ChangeSet: Codable {
  private enum CodingKeys: String, CodingKey {
    case changed
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    changed = Set(try container.decode([[Int]].self, forKey: .changed))
  }

  /// Sorted, so a recorded fixture's bytes don't depend on hashing.
  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(changed.sorted { $0.lexicographicallyPrecedes($1) }, forKey: .changed)
  }
}

public enum EditorError: Error, Equatable {
  case noNode(path: [Int])
  case noSelection
  /// Valid input this implementation does not handle yet.
  case unsupported(String)
  case invalidState(String)
}
