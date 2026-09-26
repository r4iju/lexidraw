import Foundation
import LexicalFuzz
import LexicalReference
import LexicalSwift
import Testing
import TextKitEditor

@Suite struct DocumentTextTests {
  enum Model: String, CaseIterable {
    case lexicalSwift, reference

    func make() throws -> any EditorModel {
      switch self {
      case .lexicalSwift: return Editor()
      case .reference: return try Support.referenceEditor()
      }
    }
  }

  /// Format bits as the only attribute, so a wrong run shows as a difference.
  static func style(_ blockType: String, _ format: TextFormat) -> [NSAttributedString.Key: Any] {
    [.lexicalFormat: format.rawValue]
  }

  @Test func laysOutBlocksAsLinesAndPointsAsABrowserResolvesThem() throws {
    let model = Editor()
    try model.load(
      LexicalJSON.document([
        LexicalJSON.paragraph([
          LexicalJSON.text("ab"), LexicalJSON.text("cd", format: .bold), LexicalJSON.lineBreak, LexicalJSON.text("ef"),
        ]),
        LexicalJSON.paragraph([]),
      ]))
    let text = DocumentText(model: model, style: Self.style)
    let storage = NSMutableAttributedString()

    try text.reload(storage)

    #expect(storage.string == "abcd\u{2028}ef\n\n")
    #expect(text.point(at: 0) == .text([0, 0], 0))
    #expect(text.point(at: 2) == .text([0, 0], 2))
    #expect(text.point(at: 4) == .text([0, 1], 2))
    #expect(text.point(at: 5) == .text([0, 3], 0))
    #expect(text.point(at: 8) == Point(path: [1], offset: 0, type: .element))
    #expect(text.offset(of: Point(path: [], offset: 2, type: .element)) == 8)
  }

  @Test(arguments: Model.allCases)
  func keepsTheTextAFreshRenderWouldGiveAfterEveryCommand(_ kind: Model) throws {
    let model = try kind.make()
    for (name, start, commands) in try Self.scripts() {
      try model.load(start)
      let text = DocumentText(model: model, style: Self.style)
      let storage = NSMutableAttributedString()
      try text.reload(storage)
      for (index, command) in commands.enumerated() {
        guard let change = try? model.apply(command) else { continue }
        try text.update(storage, after: change)

        let fresh = NSMutableAttributedString()
        try DocumentText(model: model, style: Self.style).reload(fresh)
        #expect(storage.isEqual(to: fresh), "\(name), after command \(index): \(command)")
        for offset in 0..<storage.length {
          #expect(text.offset(of: text.point(at: offset)) == offset, "\(name), offset \(offset)")
        }
        if let selection = try model.selection() {
          #expect(text.offset(of: selection.anchor) != nil && text.offset(of: selection.focus) != nil)
        }
      }
    }
  }

  @Test(arguments: Model.allCases)
  func givesEachBlockAsTheStateSavesIt(_ kind: Model) throws {
    let model = try kind.make()
    for (name, start, _) in try Self.scripts() {
      try model.load(start)
      let saved = try model.snapshot().state["root"]?["children"]?.arrayValue ?? []
      #expect(try model.childKeys(at: []).count == saved.count, "\(name)")
      for (index, block) in saved.enumerated() {
        #expect(try model.node(at: [index]) == block, "\(name), block \(index)")
      }
    }
  }

  static func scripts() throws -> [(String, JSONValue, [EditorCommand])] {
    let folder = Support.iosRoot.appending(path: "Tests/LexicalSwiftTests/Fixtures")
    let fixtures = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
      .filter { $0.pathExtension == "json" }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
      .map { url in
        let fixture = try Fixture.read(from: url)
        return (url.lastPathComponent, fixture.start, fixture.commands)
      }
    let editing = LexicalJSON.document([
      LexicalJSON.paragraph([LexicalJSON.text("Hello world")]),
      LexicalJSON.paragraph([LexicalJSON.text("bold", format: .bold), LexicalJSON.text(" tail")]),
      LexicalJSON.paragraph([]),
    ])
    let session: [EditorCommand] = [
      .caret(.text([0, 0], 11)), .insertParagraph, .insertText("new"), .deleteCharacter(backward: true),
      .deleteCharacter(backward: true), .deleteCharacter(backward: true), .deleteCharacter(backward: true),
      .caret(.text([1, 0], 0)), .deleteCharacter(backward: true), .selectAll, .insertText("x"), .undo, .undo,
      .redo, .insertLineBreak, .formatText(.bold), .insertText("B"), .wait(milliseconds: 2000),
      .insertParagraph, .insertParagraph, .caret(.text([0, 0], 5)), .deleteLine(backward: true, lineBoundary: .text([0, 0], 0)),
      .caret(Point(path: [], offset: 0, type: .element)),
      .insertParagraph, .undo, .undo, .undo,
    ]
    return fixtures + [("editing session", editing, session)]
  }
}

enum Support {
  static let iosRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

  static func referenceEditor() throws -> ReferenceEditor {
    try ReferenceEditor(scriptURL: iosRoot.appending(path: "reference/dist/lexical-reference.js"))
  }
}

extension NSAttributedString.Key {
  static let lexicalFormat = NSAttributedString.Key("lexicalFormat")
}
