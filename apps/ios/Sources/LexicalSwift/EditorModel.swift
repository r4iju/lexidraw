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
  /// The format new text takes, as Lexical's `RangeSelection.format`.
  public var format: TextFormat
  public var style: String

  public init(anchor: Point, focus: Point, format: TextFormat, style: String) {
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
  case formatText(TextFormatType)
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

/// Lexical's `TextFormatType`: a text format by the name Lexical gives it.
public enum TextFormatType: String, Codable, CaseIterable, Sendable {
  case bold, italic, strikethrough, underline, code, `subscript`, superscript, highlight, lowercase,
    uppercase, capitalize

  /// Lexical's `TEXT_TYPE_TO_FORMAT`.
  public var format: TextFormat {
    switch self {
    case .bold: .bold
    case .italic: .italic
    case .strikethrough: .strikethrough
    case .underline: .underline
    case .code: .code
    case .subscript: .subscript
    case .superscript: .superscript
    case .highlight: .highlight
    case .lowercase: .lowercase
    case .uppercase: .uppercase
    case .capitalize: .capitalize
    }
  }
}

/// The text formats a text node or selection has, as the bits Lexical keeps
/// in `format`.
public struct TextFormat: OptionSet, Codable, Hashable, Sendable {
  public let rawValue: Int

  public init(rawValue: Int) {
    self.rawValue = rawValue
  }

  public static let bold = TextFormat(rawValue: 1 << 0)
  public static let italic = TextFormat(rawValue: 1 << 1)
  public static let strikethrough = TextFormat(rawValue: 1 << 2)
  public static let underline = TextFormat(rawValue: 1 << 3)
  public static let code = TextFormat(rawValue: 1 << 4)
  public static let `subscript` = TextFormat(rawValue: 1 << 5)
  public static let superscript = TextFormat(rawValue: 1 << 6)
  public static let highlight = TextFormat(rawValue: 1 << 7)
  public static let lowercase = TextFormat(rawValue: 1 << 8)
  public static let uppercase = TextFormat(rawValue: 1 << 9)
  public static let capitalize = TextFormat(rawValue: 1 << 10)
  /// Lexical's `IS_ALL_FORMATTING`.
  public static let all = TextFormat(TextFormatType.allCases.map(\.format))
}

extension EditorCommand: Codable {
  private enum CodingKeys: String, CodingKey {
    case type, anchor, focus, text, backward, format, milliseconds
  }

  /// The command's `type` in JSON.
  private enum Kind: String, Codable {
    case setSelection, insertText, deleteCharacter, deleteWord, deleteLine, insertParagraph, insertLineBreak,
      formatText, selectAll, undo, redo, wait
  }

  private var kind: Kind {
    switch self {
    case .setSelection: .setSelection
    case .insertText: .insertText
    case .deleteCharacter: .deleteCharacter
    case .deleteWord: .deleteWord
    case .deleteLine: .deleteLine
    case .insertParagraph: .insertParagraph
    case .insertLineBreak: .insertLineBreak
    case .formatText: .formatText
    case .selectAll: .selectAll
    case .undo: .undo
    case .redo: .redo
    case .wait: .wait
    }
  }

  public var name: String { kind.rawValue }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    func backward() throws -> Bool { try container.decode(Bool.self, forKey: .backward) }
    switch try container.decode(Kind.self, forKey: .type) {
    case .setSelection:
      self = .setSelection(
        anchor: try container.decode(Point.self, forKey: .anchor),
        focus: try container.decode(Point.self, forKey: .focus))
    case .insertText: self = .insertText(try container.decode(String.self, forKey: .text))
    case .deleteCharacter: self = .deleteCharacter(backward: try backward())
    case .deleteWord: self = .deleteWord(backward: try backward())
    case .deleteLine: self = .deleteLine(backward: try backward())
    case .insertParagraph: self = .insertParagraph
    case .insertLineBreak: self = .insertLineBreak
    case .formatText: self = .formatText(try container.decode(TextFormatType.self, forKey: .format))
    case .selectAll: self = .selectAll
    case .undo: self = .undo
    case .redo: self = .redo
    case .wait: self = .wait(milliseconds: try container.decode(Int.self, forKey: .milliseconds))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(kind, forKey: .type)
    switch self {
    case .setSelection(let anchor, let focus):
      try container.encode(anchor, forKey: .anchor)
      try container.encode(focus, forKey: .focus)
    case .insertText(let text):
      try container.encode(text, forKey: .text)
    case .deleteCharacter(let backward), .deleteWord(let backward), .deleteLine(let backward):
      try container.encode(backward, forKey: .backward)
    case .formatText(let format):
      try container.encode(format, forKey: .format)
    case .wait(let milliseconds):
      try container.encode(milliseconds, forKey: .milliseconds)
    case .insertParagraph, .insertLineBreak, .selectAll, .undo, .redo:
      break
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
