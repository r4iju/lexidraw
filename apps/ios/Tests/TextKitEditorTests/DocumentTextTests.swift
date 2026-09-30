import Foundation
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif
import LexicalFuzz
import LexicalReference
import LexicalSwift
import Testing
import TextKitEditor

@Suite struct DocumentTextTests {
  /// Format bits as the only attribute, so a wrong run shows as a difference.
  static func style(_ blockType: String, _ format: TextFormat) -> [NSAttributedString.Key: Any] {
    [.lexicalFormat: format.rawValue]
  }

  @Test func tableAlignmentPreservesItsCellTextAlignment() throws {
    let model = Editor()
    var fields = LexicalJSON.table([["one", "two"]]).objectValue!
    fields["format"] = "center"
    let table = JSONValue.object(fields)
    try model.load(LexicalJSON.document([table]))
    let text = DocumentText(model: model, style: Self.style)
    let storage = NSMutableAttributedString()
    try text.reload(storage)
    let paragraph = storage.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle
    #expect(paragraph?.alignment != .center)
  }

  @Test func alignmentAndDirectionReachParagraphLayoutTogether() throws {
    let model = Editor()
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("abc")])]))
    try model.apply(.caret(.text([0, 0], 0)))
    try model.apply(.setWritingDirection(.rtl))
    try model.apply(.formatElement(.center))
    let text = DocumentText(model: model, style: Self.style)
    let storage = NSMutableAttributedString()
    try text.reload(storage)
    let paragraph = storage.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle
    #expect(paragraph?.alignment == .center)
    #expect(paragraph?.baseWritingDirection == .rightToLeft)
  }

  @Test func explicitDirectionReachesParagraphLayout() throws {
    let model = Editor()
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("abc")])]))
    try model.apply(.caret(.text([0, 0], 0)))
    try model.apply(.setWritingDirection(.rtl))
    let text = DocumentText(model: model, style: Self.style)
    let storage = NSMutableAttributedString()
    try text.reload(storage)
    #expect(
      (storage.attribute(.paragraphStyle, at: 0, effectiveRange: nil) as? NSParagraphStyle)?
        .baseWritingDirection == .rightToLeft)
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

  @Test(arguments: EditorModelChoice.allCases)
  func keepsTheTextAFreshRenderWouldGiveAfterEveryCommand(_ choice: EditorModelChoice) throws {
    let model = try choice.make(referenceScript: Support.referenceScript)
    for (name, start, commands) in try Self.scripts() {
      try model.load(start)
      let text = DocumentText(model: model, style: Self.style)
      let storage = NSMutableAttributedString()
      var blocks = Self.blockTexts(storage, text, after: try text.reload(storage), in: [])
      for (index, command) in commands.enumerated() {
        guard let change = try? model.apply(command) else { continue }
        blocks = Self.blockTexts(storage, text, after: try text.update(storage, after: change), in: blocks)

        let fresh = NSMutableAttributedString()
        try DocumentText(model: model, style: Self.style).reload(fresh)
        #expect(storage.isEqual(to: fresh), "\(name), after command \(index): \(command)")
        #expect(blocks == (0..<text.blockCount).map { storage.attributedSubstring(from: text.range(ofBlock: $0)) })
        for offset in 0..<storage.length {
          let point = text.point(at: offset)
          if point.type == .text {
            #expect(text.offset(of: point) == offset, "\(name), offset \(offset)")
          } else {
            let canonicalOffset = try #require(text.offset(of: point))
            #expect(text.point(at: canonicalOffset) == point, "\(name), offset \(offset)")
          }
        }
        if let selection = try model.selection() {
          #expect(text.offset(of: selection.anchor) != nil && text.offset(of: selection.focus) != nil)
        }
      }
    }
  }

  @Test(arguments: EditorModelChoice.allCases)
  func givesEachBlockAsTheStateSavesIt(_ choice: EditorModelChoice) throws {
    let model = try choice.make(referenceScript: Support.referenceScript)
    for (name, start) in try Self.scripts().map({ ($0.0, $0.1) }) + Self.storedDocuments() {
      try model.load(start)
      let saved = try model.snapshot().state["root"]?["children"]?.arrayValue ?? []
      #expect(try model.childKeys(at: []).count == saved.count, "\(name)")
      for (index, block) in saved.enumerated() {
        #expect(try model.node(at: [index]) == block, "\(name), block \(index)")
      }
    }
  }

  @Test func showsANodeWithNoTextAsOneCharacter() throws {
    let model = Editor()
    try model.load(
      LexicalJSON.document([
        LexicalJSON.paragraph([
          LexicalJSON.text("a"), ["type": "equation", "version": 1, "equation": "x", "inline": true], LexicalJSON.text("b"),
        ]),
        ["type": "page-break", "version": 1],
        ["type": "not-a-lexidraw-node", "version": 1],
      ]))
    let text = DocumentText(model: model, style: Self.style)
    let storage = NSMutableAttributedString()

    try text.reload(storage)

    #expect(storage.string == "a\u{FFFC}b\n\u{FFFC}\n\u{FFFC}\n")
    #expect(text.point(at: 2) == .text([0, 2], 0))
    #expect(text.point(at: 4) == Point(path: [], offset: 1, type: .element))
  }

  @Test func describesEachBlockByHowItIsLaidOut() throws {
    let model = Editor()
    try model.load(TestDocuments.titledTable([["c1", "c2"], ["c3", "c4"]]))
    let text = DocumentText(model: model) { blockType, format in
      [.lexicalFormat: format.rawValue, .blockType: blockType]
    }
    let storage = NSMutableAttributedString()

    try text.reload(storage)

    func shown(_ range: NSRange) -> String { (storage.string as NSString).substring(with: range) }
    #expect((0..<text.blockCount).map { shown(text.range(ofBlock: $0)) } == ["Title", "before", "c1\nc2\nc3\nc4", "\u{FFFC}", "after"])
    #expect(storage.attribute(.blockType, at: 0, effectiveRange: nil) as? String == "h2")
    #expect(text.kind(ofBlock: 1) == .text)
    guard case .table(let table) = text.kind(ofBlock: 2) else {
      Issue.record("The table isn't laid out as one")
      return
    }
    let start = text.range(ofBlock: 2).location
    #expect(
      table.rows.map { $0.map { shown(NSRange(location: start + $0.range.location, length: $0.range.length)) } }
        == [["c1", "c2"], ["c3", "c4"]])
    #expect(text.blockIndex(at: NSMaxRange(text.range(ofBlock: 2))) == 2)
    #expect(text.kind(ofBlock: 3) == .embedded(type: "youtube"))
  }

  @Test func standsInForANodeWithOneCharacter() throws {
    let model = Editor()
    try model.load(TestDocuments.titledTable([["c1", "c2"], ["c3", "c4"]]))
    let text = DocumentText(model: model, style: Self.style) { node, _ in
      node["type"] == "table" ? [.standIn: "table"] : nil
    }
    let storage = NSMutableAttributedString()

    try text.reload(storage)

    #expect(storage.string == "Title\nbefore\n\u{FFFC}\n\u{FFFC}\nafter\n")
    #expect(storage.attribute(.standIn, at: 13, effectiveRange: nil) as? String == "table")
    #expect(text.kind(ofBlock: 2) == .embedded(type: "table"))
    #expect(text.point(at: 13) == Point(path: [], offset: 2, type: .element))
    #expect(text.offset(of: .text([2, 0, 0, 0, 0], 1)) == nil)
  }

  /// A composition edits the text without the model, even across blocks.
  @Test func followsAnEditOfItsOwnWithinABlockAndAcrossBlocks() throws {
    let model = Editor()
    try model.load(
      LexicalJSON.document(["ab", "cd", "ef"].map { LexicalJSON.paragraph([LexicalJSON.text($0)]) }))
    let text = DocumentText(model: model, style: Self.style)
    let storage = NSMutableAttributedString()
    var blocks = Self.blockTexts(storage, text, after: try text.reload(storage), in: [])

    blocks = Self.blockTexts(
      storage, text, after: text.replace(storage, in: NSRange(location: 1, length: 0), with: Self.plain("XY")),
      in: blocks)
    #expect(storage.string == "aXYb\ncd\nef\n")
    #expect(text.range(ofBlock: 1) == NSRange(location: 5, length: 2))

    blocks = Self.blockTexts(
      storage, text, after: text.replace(storage, in: NSRange(location: 3, length: 3), with: Self.plain("Z")),
      in: blocks)
    #expect(storage.string == "aXYZd\nef\n")
    #expect(text.blockCount == 2)
    #expect(text.range(ofBlock: 1) == NSRange(location: 6, length: 2))
    #expect(blocks == (0..<text.blockCount).map { storage.attributedSubstring(from: text.range(ofBlock: $0)) })

    _ = text.replace(storage, in: NSRange(location: 3, length: 1), with: Self.plain("b\nc"))
    _ = text.replace(storage, in: NSRange(location: 1, length: 2), with: Self.plain(""))
    try model.apply(.caret(.text([1, 0], 1)))
    blocks = Self.blockTexts(storage, text, after: try text.update(storage, after: try model.apply(.insertText("Q"))), in: blocks)

    let fresh = NSMutableAttributedString()
    try DocumentText(model: model, style: Self.style).reload(fresh)
    #expect(storage.isEqual(to: fresh))
    #expect(blocks == (0..<text.blockCount).map { storage.attributedSubstring(from: text.range(ofBlock: $0)) })
  }

  @Test(arguments: EditorModelChoice.allCases)
  func reachesEveryPlaceInEveryStoredNode(_ choice: EditorModelChoice) throws {
    let model = try choice.make(referenceScript: Support.referenceScript)
    let stored = try Self.storedDocuments()
    var unreachable: [String] = []
    for (name, document) in stored {
      try model.load(document)
      let text = DocumentText(model: model, style: Self.style)
      let storage = NSMutableAttributedString()
      try text.reload(storage)
      if (0..<storage.length).contains(where: { text.offset(of: text.point(at: $0)) != $0 }) { unreachable.append(name) }
    }

    #expect(stored.count > 4000)
    #expect(unreachable == [])
  }

  static func plain(_ string: String) -> NSAttributedString {
    NSAttributedString(string: string, attributes: style("paragraph", []))
  }

  /// `blocks`, the text of each block before an edit, brought up to date by
  /// the splices the edit reported: what a view keeping something per block
  /// would hold after it.
  static func blockTexts(
    _ storage: NSAttributedString, _ text: DocumentText, after splices: [DocumentText.Splice],
    in blocks: [NSAttributedString]
  ) -> [NSAttributedString] {
    var blocks = blocks
    for splice in splices {
      blocks.replaceSubrange(splice.old, with: splice.new.map { storage.attributedSubstring(from: text.range(ofBlock: $0)) })
    }
    return blocks
  }

  /// Every node the web has stored and could read, in a document of its own.
  static func storedDocuments() throws -> [(String, JSONValue)] {
    try JSONValue(parsing: String(contentsOf: Support.storedBytes, encoding: .utf8)).arrayValue?.compactMap { entry in
      guard entry["threw"] != true, let name = entry["name"]?.stringValue, let node = entry["node"] else { return nil }
      return (name, LexicalJSON.document([node]))
    } ?? []
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

  static let referenceScript = iosRoot.appending(path: "reference/dist/lexical-reference.js")

  /// The web's saves of every stored node, from @packages/lexical-nodes.
  static let storedBytes = iosRoot.appending(path: "../../packages/lexical-nodes/test/stored-bytes.json")
}

extension NSAttributedString.Key {
  static let lexicalFormat = NSAttributedString.Key("lexicalFormat")
  static let blockType = NSAttributedString.Key("blockType")
  static let standIn = NSAttributedString.Key("standIn")
}
