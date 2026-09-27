/// The editor-model interface: everything a view needs from a document model,
/// and the seam the reference fixtures and differential fuzzer test at.
public protocol EditorModel: AnyObject {
  /// Replaces the document with a serialized Lexical editor state
  /// (`{"root": …}`) and clears the selection.
  func load(_ state: JSONValue) throws

  /// Whether the model can edit the document loaded. One that can't refuses
  /// every command that would change it as `EditorError.unsupported`.
  var isEditable: Bool { get }

  /// Applies one command as a single update. A command that throws leaves the
  /// document and selection as they were.
  @discardableResult
  func apply(_ command: EditorCommand) throws -> ChangeSet

  /// The serialized editor state and the selection.
  func snapshot() throws -> Snapshot

  /// The selection alone, without serializing the document.
  func selection() throws -> Selection?

  /// The node at `path`, with everything under it, as the state saves it.
  func node(at path: [Int]) throws -> JSONValue

  /// Names for the children of the element at `path`. A child keeps its name
  /// for as long as it stays in the document, wherever it moves, so a view can
  /// tell which children an update added, removed or kept. Names mean nothing
  /// across models.
  func childKeys(at path: [Int]) throws -> [String]
}

public struct Snapshot: Codable, Equatable, Sendable {
  public var state: JSONValue
  public var selection: Selection?

  public init(state: JSONValue, selection: Selection?) {
    self.state = state
    self.selection = selection
  }
}

/// A range selection, or a table selection: Lexical's `TableSelection`,
/// the rectangle of cells between the anchor's cell and the focus's. Points
/// are addressed by path (child indexes from the root) rather than node key,
/// so two implementations can be compared.
public struct Selection: Codable, Equatable, Sendable {
  public var anchor: Point
  public var focus: Point
  /// The format new text takes, as Lexical's `RangeSelection.format`.
  public var format: TextFormat
  public var style: String
  /// The table whose cells a table selection selects; nil for a range. Its
  /// anchor and focus are then the start of a cell each, and it has no
  /// format or style.
  public var table: [Int]?

  public init(anchor: Point, focus: Point, format: TextFormat, style: String, table: [Int]? = nil) {
    self.anchor = anchor
    self.focus = focus
    self.format = format
    self.style = style
    self.table = table
  }

  /// Whether it's a caret. A table selection never is, even of one cell.
  public var isCollapsed: Bool { table == nil && anchor == focus }
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
  /// Ends a composition: its text, typed as one update Lexical tags as a
  /// composition's end.
  case commitComposition(String)
  /// Backspace (`backward`) or forward delete, by one character, word or line.
  case deleteCharacter(backward: Bool)
  case deleteWord(backward: Bool)
  /// `lineBoundary` is where the view lays out the start of the caret's line,
  /// or its end going forward.
  case deleteLine(backward: Bool, lineBoundary: Point)
  /// Enter.
  case insertParagraph
  /// Shift-Enter.
  case insertLineBreak
  /// Toggles a format on the selected text, or on what a caret types next.
  case formatText(TextFormatType)
  /// Makes every block the selection touches a paragraph, heading or quote,
  /// as the web toolbar's block menu does.
  case setBlockType(BlockType)
  /// Turns the selected blocks into a list, or a list of another type.
  case insertList(ListType)
  /// Turns the selected lists back into paragraphs.
  case removeList
  /// The formatting bar's indent and outdent.
  case indent
  case outdent
  /// Tab, or Shift-Tab where `backward`.
  case tab(backward: Bool)
  /// A tap on a checklist item's box, at `path`.
  case toggleChecked(path: [Int])
  case selectAll
  /// Lexical's `TOGGLE_LINK_COMMAND`, as the web editor's link plugins take
  /// it: links the selection to `url`, or unlinks it where `url` is nil.
  case toggleLink(url: String?)
  /// The web's link editor saving `url` for the link the selection is in.
  case editLink(url: String)
  /// Copies the selection; the change set holds what it put on the clipboard.
  case copy
  /// Copies the selection and deletes it.
  case cut
  /// Pastes as the web's rich-text editor does: Lexical nodes copied from a
  /// document, or else the plain text.
  case paste(Clipboard)
  /// The web's insert-table dialog: a table after the caret's block, with a
  /// header row, and the caret in its first cell.
  case insertTable(rows: Int, columns: Int)
  /// The web's table menu, on the rows or columns the selection is in.
  case insertTableRow(after: Bool)
  case insertTableColumn(after: Bool)
  case deleteTableRow
  case deleteTableColumn
  case undo
  case redo
  /// Lets time pass, which decides whether history merges the next edit into
  /// the last.
  case wait(milliseconds: Int)

  public static func caret(_ point: Point) -> EditorCommand {
    .setSelection(anchor: point, focus: point)
  }

  /// Lexical's `ListType`.
  public enum ListType: String, Codable, CaseIterable, Sendable {
    case bullet, number, check
  }
}

/// What a block of text is: a paragraph, a heading by its tag, or a quote.
public enum BlockType: String, Codable, CaseIterable, Sendable {
  case paragraph, h1, h2, h3, h4, h5, h6, quote
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
    case type, anchor, focus, text, backward, lineBoundary, format, blockType, listType, path, milliseconds, url, clipboard,
      rows, columns, after
  }

  /// The command's `type` in JSON.
  private enum Kind: String, Codable {
    case setSelection, insertText, commitComposition, deleteCharacter, deleteWord, deleteLine, insertParagraph, insertLineBreak,
      formatText, setBlockType, insertList, removeList, indent, outdent, tab, toggleChecked, selectAll, toggleLink, editLink,
      copy, cut, paste, insertTable, insertTableRow, insertTableColumn, deleteTableRow, deleteTableColumn, undo, redo, wait
  }

  private var kind: Kind {
    switch self {
    case .setSelection: .setSelection
    case .insertText: .insertText
    case .commitComposition: .commitComposition
    case .deleteCharacter: .deleteCharacter
    case .deleteWord: .deleteWord
    case .deleteLine: .deleteLine
    case .insertParagraph: .insertParagraph
    case .insertLineBreak: .insertLineBreak
    case .formatText: .formatText
    case .setBlockType: .setBlockType
    case .insertList: .insertList
    case .removeList: .removeList
    case .indent: .indent
    case .outdent: .outdent
    case .tab: .tab
    case .toggleChecked: .toggleChecked
    case .selectAll: .selectAll
    case .toggleLink: .toggleLink
    case .editLink: .editLink
    case .copy: .copy
    case .cut: .cut
    case .paste: .paste
    case .insertTable: .insertTable
    case .insertTableRow: .insertTableRow
    case .insertTableColumn: .insertTableColumn
    case .deleteTableRow: .deleteTableRow
    case .deleteTableColumn: .deleteTableColumn
    case .undo: .undo
    case .redo: .redo
    case .wait: .wait
    }
  }

  public var name: String { kind.rawValue }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    func backward() throws -> Bool { try container.decode(Bool.self, forKey: .backward) }
    func after() throws -> Bool { try container.decode(Bool.self, forKey: .after) }
    switch try container.decode(Kind.self, forKey: .type) {
    case .setSelection:
      self = .setSelection(
        anchor: try container.decode(Point.self, forKey: .anchor),
        focus: try container.decode(Point.self, forKey: .focus))
    case .insertText: self = .insertText(try container.decode(String.self, forKey: .text))
    case .commitComposition: self = .commitComposition(try container.decode(String.self, forKey: .text))
    case .deleteCharacter: self = .deleteCharacter(backward: try backward())
    case .deleteWord: self = .deleteWord(backward: try backward())
    case .deleteLine:
      self = .deleteLine(
        backward: try backward(), lineBoundary: try container.decode(Point.self, forKey: .lineBoundary))
    case .insertParagraph: self = .insertParagraph
    case .insertLineBreak: self = .insertLineBreak
    case .formatText: self = .formatText(try container.decode(TextFormatType.self, forKey: .format))
    case .setBlockType: self = .setBlockType(try container.decode(BlockType.self, forKey: .blockType))
    case .insertList: self = .insertList(try container.decode(ListType.self, forKey: .listType))
    case .removeList: self = .removeList
    case .indent: self = .indent
    case .outdent: self = .outdent
    case .tab: self = .tab(backward: try backward())
    case .toggleChecked: self = .toggleChecked(path: try container.decode([Int].self, forKey: .path))
    case .selectAll: self = .selectAll
    case .toggleLink: self = .toggleLink(url: try container.decodeIfPresent(String.self, forKey: .url))
    case .editLink: self = .editLink(url: try container.decode(String.self, forKey: .url))
    case .copy: self = .copy
    case .cut: self = .cut
    case .paste: self = .paste(try container.decode(Clipboard.self, forKey: .clipboard))
    case .insertTable:
      self = .insertTable(
        rows: try container.decode(Int.self, forKey: .rows), columns: try container.decode(Int.self, forKey: .columns))
    case .insertTableRow: self = .insertTableRow(after: try after())
    case .insertTableColumn: self = .insertTableColumn(after: try after())
    case .deleteTableRow: self = .deleteTableRow
    case .deleteTableColumn: self = .deleteTableColumn
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
    case .insertText(let text), .commitComposition(let text):
      try container.encode(text, forKey: .text)
    case .deleteCharacter(let backward), .deleteWord(let backward), .tab(let backward):
      try container.encode(backward, forKey: .backward)
    case .deleteLine(let backward, let lineBoundary):
      try container.encode(backward, forKey: .backward)
      try container.encode(lineBoundary, forKey: .lineBoundary)
    case .formatText(let format):
      try container.encode(format, forKey: .format)
    case .setBlockType(let blockType):
      try container.encode(blockType, forKey: .blockType)
    case .insertList(let listType):
      try container.encode(listType, forKey: .listType)
    case .toggleChecked(let path):
      try container.encode(path, forKey: .path)
    case .wait(let milliseconds):
      try container.encode(milliseconds, forKey: .milliseconds)
    case .toggleLink(let url):
      try container.encode(url, forKey: .url)
    case .editLink(let url):
      try container.encode(url, forKey: .url)
    case .paste(let clipboard):
      try container.encode(clipboard, forKey: .clipboard)
    case .insertTable(let rows, let columns):
      try container.encode(rows, forKey: .rows)
      try container.encode(columns, forKey: .columns)
    case .insertTableRow(let after), .insertTableColumn(let after):
      try container.encode(after, forKey: .after)
    case .insertParagraph, .insertLineBreak, .removeList, .indent, .outdent, .selectAll, .copy, .cut, .deleteTableRow,
      .deleteTableColumn, .undo, .redo:
      break
    }
  }
}

/// What a copy puts on the clipboard, or a paste takes from it, by the MIME
/// types Lexical writes and reads.
public struct Clipboard: Codable, Equatable, Sendable {
  public var plainText: String
  /// Never copied, and pasted as the plain text beside it: Lexical writes
  /// and reads HTML through a DOM (#168).
  public var html: String?
  public var lexical: LexicalClipboardPayload?

  public init(plainText: String, html: String? = nil, lexical: LexicalClipboardPayload? = nil) {
    self.plainText = plainText
    self.html = html
    self.lexical = lexical
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: MIMEType.self)
    plainText = try container.decode(String.self, forKey: .plainText)
    html = try container.decodeIfPresent(String.self, forKey: .html)
    lexical = try container.decodeIfPresent(LexicalClipboardPayload.self, forKey: .lexical)
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: MIMEType.self)
    try container.encode(plainText, forKey: .plainText)
    try container.encodeIfPresent(html, forKey: .html)
    try container.encodeIfPresent(lexical, forKey: .lexical)
  }

  private struct MIMEType: CodingKey {
    static let plainText = MIMEType(stringValue: "text/plain")
    static let html = MIMEType(stringValue: "text/html")
    static let lexical = MIMEType(stringValue: LexicalClipboardPayload.mimeType)

    var stringValue: String
    var intValue: Int? { nil }

    init(stringValue: String) { self.stringValue = stringValue }
    init?(intValue: Int) { nil }
  }
}

/// Lexical's own copy of a selection: the nodes, which paste as nodes only
/// into an editor of the same namespace.
public struct LexicalClipboardPayload: Codable, Equatable, Sendable {
  /// The MIME type Lexical puts the payload on the clipboard as, in JSON.
  public static let mimeType = "application/x-lexical-editor"

  public var namespace: String
  public var nodes: [JSONValue]

  public init(namespace: String, nodes: [JSONValue]) {
    self.namespace = namespace
    self.nodes = nodes
  }
}

/// The paths, in the document after an update, of the nodes it created or
/// changed. Adding or removing a node changes its parent.
public struct ChangeSet: Equatable, Sendable {
  public var changed: Set<[Int]>
  /// What a copy or cut put on the clipboard: nothing for an empty selection.
  public var clipboard: Clipboard?

  public init(changed: Set<[Int]> = [], clipboard: Clipboard? = nil) {
    self.changed = changed
    self.clipboard = clipboard
  }
}

extension ChangeSet: Codable {
  private enum CodingKeys: String, CodingKey {
    case changed, clipboard
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    changed = Set(try container.decode([[Int]].self, forKey: .changed))
    clipboard = try container.decodeIfPresent(Clipboard.self, forKey: .clipboard)
  }

  /// Sorted, so a recorded fixture's bytes don't depend on hashing.
  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(changed.sorted { $0.lexicographicallyPrecedes($1) }, forKey: .changed)
    try container.encodeIfPresent(clipboard, forKey: .clipboard)
  }
}

public enum EditorError: Error, Equatable {
  case noNode(path: [Int])
  case noSelection
  /// Valid input this implementation does not handle yet.
  case unsupported(String)
  case invalidState(String)

  /// What went wrong, without the particulars, for comparing two
  /// implementations' refusals.
  public enum Kind: String, Codable, Sendable {
    case noNode, noSelection, unsupported, invalidState
  }

  public var kind: Kind {
    switch self {
    case .noNode: .noNode
    case .noSelection: .noSelection
    case .unsupported: .unsupported
    case .invalidState: .invalidState
    }
  }
}
