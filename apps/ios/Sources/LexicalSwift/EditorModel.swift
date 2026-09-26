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
  /// Backspace (`backward`) or forward delete, by one character, word or line.
  case deleteCharacter(backward: Bool)
  case deleteWord(backward: Bool)
  case deleteLine(backward: Bool)
  /// Enter.
  case insertParagraph
  /// Shift-Enter.
  case insertLineBreak
  /// Toggles a format on the selected text, or on what a caret types next.
  case formatText(TextFormat)
  case selectAll
  case undo
  case redo
  /// Lets time pass, which decides whether history merges the next edit into
  /// the last.
  case wait(milliseconds: Int)

  public static func caret(_ point: Point) -> EditorCommand {
    .setSelection(anchor: point, focus: point)
  }
}

/// Lexical's `TextFormatType`, named as it names them.
public enum TextFormat: String, Codable, CaseIterable, Sendable {
  case bold, italic, strikethrough, underline, code, `subscript`, superscript, highlight, lowercase,
    uppercase, capitalize
}

extension EditorCommand: Codable {
  private enum CodingKeys: String, CodingKey {
    case type, anchor, focus, text, backward, format, milliseconds
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    func backward() throws -> Bool { try container.decode(Bool.self, forKey: .backward) }
    switch try container.decode(String.self, forKey: .type) {
    case "setSelection":
      self = .setSelection(
        anchor: try container.decode(Point.self, forKey: .anchor),
        focus: try container.decode(Point.self, forKey: .focus))
    case "insertText":
      self = .insertText(try container.decode(String.self, forKey: .text))
    case "deleteCharacter": self = .deleteCharacter(backward: try backward())
    case "deleteWord": self = .deleteWord(backward: try backward())
    case "deleteLine": self = .deleteLine(backward: try backward())
    case "insertParagraph": self = .insertParagraph
    case "insertLineBreak": self = .insertLineBreak
    case "formatText": self = .formatText(try container.decode(TextFormat.self, forKey: .format))
    case "selectAll": self = .selectAll
    case "undo": self = .undo
    case "redo": self = .redo
    case "wait": self = .wait(milliseconds: try container.decode(Int.self, forKey: .milliseconds))
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
    case .deleteCharacter(let backward), .deleteWord(let backward), .deleteLine(let backward):
      try container.encode(name, forKey: .type)
      try container.encode(backward, forKey: .backward)
    case .formatText(let format):
      try container.encode("formatText", forKey: .type)
      try container.encode(format, forKey: .format)
    case .wait(let milliseconds):
      try container.encode("wait", forKey: .type)
      try container.encode(milliseconds, forKey: .milliseconds)
    case .insertParagraph, .insertLineBreak, .selectAll, .undo, .redo:
      try container.encode(name, forKey: .type)
    }
  }

  /// The command's `type` in JSON.
  public var name: String {
    switch self {
    case .setSelection: "setSelection"
    case .insertText: "insertText"
    case .deleteCharacter: "deleteCharacter"
    case .deleteWord: "deleteWord"
    case .deleteLine: "deleteLine"
    case .insertParagraph: "insertParagraph"
    case .insertLineBreak: "insertLineBreak"
    case .formatText: "formatText"
    case .selectAll: "selectAll"
    case .undo: "undo"
    case .redo: "redo"
    case .wait: "wait"
    }
  }
}

/// The paths, in the document after an update, of the nodes it created or
/// changed. Removing a node changes its parent.
public struct ChangeSet: Equatable, Sendable {
  public var changed: Set<[Int]>
  /// Undo and redo put back a whole saved document, so a view redraws all of
  /// it and `changed` is empty.
  public var everything: Bool

  public init(changed: Set<[Int]> = [], everything: Bool = false) {
    self.changed = changed
    self.everything = everything
  }
}

extension ChangeSet: Codable {
  private enum CodingKeys: String, CodingKey {
    case changed, everything
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    changed = Set(try container.decode([[Int]].self, forKey: .changed))
    everything = try container.decodeIfPresent(Bool.self, forKey: .everything) ?? false
  }

  /// Sorted, so a recorded fixture's bytes don't depend on hashing.
  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(changed.sorted { $0.lexicographicallyPrecedes($1) }, forKey: .changed)
    if everything { try container.encode(true, forKey: .everything) }
  }
}

public enum EditorError: Error, Equatable {
  case noNode(path: [Int])
  case noSelection
  /// Valid input this implementation does not handle yet.
  case unsupported(String)
  case invalidState(String)
}
