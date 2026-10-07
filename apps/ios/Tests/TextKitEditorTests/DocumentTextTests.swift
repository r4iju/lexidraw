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
@testable import TextKitEditor

@Suite struct DocumentTextTests {
  @Test func multipleCommentMarkersShareOneHiddenParagraph() throws {
    let editor = Editor()
    let thread: JSONValue = ["type": "thread", "version": 1, "thread": ["type": "thread", "id": "one", "quote": "Body", "comments": []]]
    try editor.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": [thread, thread]]]]])
    let document = DocumentText(model: editor, style: { _, _ in [:] })
    let storage = NSMutableAttributedString()
    try document.reload(storage)
    #expect(document.kind(ofBlock: 0) == .embedded(type: "thread"))
    #expect(document.range(ofBlock: 0).length == 2)
  }

  @Test func structuralPreviewsUseOwningDocumentCommentAndFootnoteMetadata() throws {
    let model = Editor()
    let mark: JSONValue = ["type": "mark", "version": 1, "ids": ["thread"], "children": .array([LexicalJSON.text("Body")])]
    let reference: JSONValue = ["type": "footnote-reference", "version": 1, "label": "root-note"]
    let definition: JSONValue = ["type": "footnote-definition", "version": 1, "label": "nested-note", "children": .array([LexicalJSON.text("Nested")])]
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([mark, reference]), definition]))
    let storage = NSMutableAttributedString()
    let document = DocumentText(model: model, style: Self.style)
    document.externalResolvedCommentIDs = ["thread"]
    document.externalFootnoteNumbers = ["root-note": 7]
    document.rendersRootFootnotes = false
    try document.reload(storage)
    #expect(storage.attribute(.commentResolved, at: 0, effectiveRange: nil) as? Bool == true)
    #expect((storage.attribute(.attachment, at: 4, effectiveRange: nil) as? FootnoteReferenceAttachment)?.marker == "7")
    #expect(storage.attribute(.footnoteDefinitionNumber, at: storage.length - 2, effectiveRange: nil) == nil)
  }

  @Test func aDeepNestedCommentKeepsItsOwnTapIDsAndBothHighlightLayers() throws {
    let model = Editor()
    let inner: JSONValue = ["type": "mark", "version": 1, "ids": ["inner"], "children": .array([LexicalJSON.text("Nested")])]
    let link: JSONValue = ["type": "link", "version": 1, "url": "https://example.com", "children": [inner]]
    let outer: JSONValue = ["type": "mark", "version": 1, "ids": ["outer"], "children": [link]]
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([outer])]))
    let storage = NSMutableAttributedString()
    try DocumentText(model: model, style: Self.style).reload(storage)
    #expect(storage.attribute(.commentIDs, at: 0, effectiveRange: nil) as? [String] == ["inner"])
    let highlights = try #require(storage.attribute(.commentHighlights, at: 0, effectiveRange: nil) as? [CommentHighlight])
    #expect(highlights.map(\.ids) == [["outer"], ["inner"]])
  }

  @Test func commentHighlightResolutionFollowsEveryThreadAndActiveSelection() throws {
    let model = Editor()
    let mark: JSONValue = ["type": "mark", "version": 1, "ids": ["one", "two"], "children": .array([LexicalJSON.text("Annotated")])]
    func thread(_ id: String, resolved: Bool) -> JSONValue {
      ["type": "thread", "version": 1, "thread": ["type": "thread", "id": .string(id), "quote": "Annotated", "comments": [], "resolved": .bool(resolved)]]
    }
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([mark]), LexicalJSON.paragraph([thread("one", resolved: true)]), LexicalJSON.paragraph([thread("two", resolved: false)])]))
    let storage = NSMutableAttributedString()
    let document = DocumentText(model: model, style: Self.style)
    try document.reload(storage)
    #expect(storage.attribute(.commentResolved, at: 0, effectiveRange: nil) as? Bool == false)
    let change = try model.apply(.saveCommentThread(id: "two", thread: thread("two", resolved: true)["thread"]))
    try document.update(storage, after: change)
    #expect(storage.attribute(.commentResolved, at: 0, effectiveRange: nil) as? Bool == true)
    document.activeCommentIDs = ["one"]
    try document.reload(storage)
    #expect(storage.attribute(.commentActive, at: 0, effectiveRange: nil) as? Bool == true)
  }

  @Test func aCommentOnlyParagraphUsesHiddenMetadataPresentation() throws {
    let model = Editor()
    let comment: JSONValue = ["type": "comment", "version": 1, "comment": ["type": "comment", "id": "note", "author": "Reader", "content": "Disposable comment", "deleted": false, "timeStamp": 0]]
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([comment])]))
    let storage = NSMutableAttributedString()
    let document = DocumentText(model: model, style: Self.style)
    try document.reload(storage)
    #expect(document.kind(ofBlock: 0) == .embedded(type: "comment"))
    #expect(storage.string == "\u{FFFC}\n")
  }

  @Test func commentMarksKeepTheirThreadIDsOnNativeTextRuns() throws {
    let model = Editor()
    let mark: JSONValue = ["type": "mark", "version": 1, "ids": ["thread-one", "thread-two"],
      "children": .array([LexicalJSON.text("Annotated")])]
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([mark, LexicalJSON.text(" plain")])]))
    let storage = NSMutableAttributedString()
    try DocumentText(model: model, style: Self.style).reload(storage)
    #expect(storage.attribute(.commentIDs, at: 0, effectiveRange: nil) as? [String] == ["thread-one", "thread-two"])
    #expect(storage.attribute(.commentIDs, at: 10, effectiveRange: nil) == nil)
    #expect(storage.string == "Annotated plain\n")
  }

  @Test func footnoteReferencesUseFirstDefinitionNumbersAndMissingLabels() throws {
    let model = Editor()
    let references: [JSONValue] = ["second", "first", "missing"].map { ["type": "footnote-reference", "version": 1, "label": .string($0)] }
    func note(_ label: String, _ body: String) -> JSONValue {
      ["type": "footnote-definition", "version": 1, "label": .string(label), "children": .array([LexicalJSON.text(body)]), "direction": .null, "format": "", "indent": 0]
    }
    try model.load(LexicalJSON.document([LexicalJSON.paragraph(references), note("first", "One"), note("first", "Duplicate"), note("second", "Two")]))
    let storage = NSMutableAttributedString()
    let document = DocumentText(model: model, style: Self.style)
    try document.reload(storage)
    #expect(storage.string == "\u{FFFC}\u{FFFC}\u{FFFC}\nOne\nDuplicate\nTwo\n")
    #expect((storage.attribute(.attachment, at: 0, effectiveRange: nil) as? FootnoteReferenceAttachment)?.marker == "2")
    #expect((storage.attribute(.attachment, at: 1, effectiveRange: nil) as? FootnoteReferenceAttachment)?.marker == "1")
    #expect((storage.attribute(.attachment, at: 2, effectiveRange: nil) as? FootnoteReferenceAttachment)?.marker == "missing?")
    #expect(document.point(at: 1) == Point(path: [0], offset: 1, type: .element))
    #expect(document.point(at: 5) == .text([1, 0], 1))
  }

  /// Format bits as the only attribute, so a wrong run shows as a difference.
  static func style(_ blockType: String, _ format: TextFormat) -> [NSAttributedString.Key: Any] {
    [.lexicalFormat: format.rawValue]
  }

  @Test func undoRecreatesAMentionDOMBackgroundAfterItsNodeWasRemoved() throws {
    let model = Editor()
    let mention: JSONValue = ["type": "mention", "version": 1, "text": "Reader", "mentionName": "Reader", "mode": "segmented", "detail": 1, "format": 0, "style": "background-color: red;"]
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([mention])]))
    let storage = NSMutableAttributedString()
    let document = DocumentText(model: model, style: { _, _ in [:] })
    try document.reload(storage)
    try model.apply(.setSelection(anchor: .text([0, 0], 0), focus: .text([0, 0], 6)))
    try document.update(storage, after: model.apply(.clearFormatting))
    #expect(storage.attribute(.backgroundColor, at: 0, effectiveRange: nil) == nil)
    try model.apply(.wait(milliseconds: 1000))
    try model.apply(.setSelection(anchor: .text([0, 0], 0), focus: .text([0, 0], 6)))
    try document.update(storage, after: model.apply(.deleteCharacter(backward: true)))
    try document.update(storage, after: model.apply(.undo))
    #expect(storage.attribute(.backgroundColor, at: 0, effectiveRange: nil) != nil)
  }

  @Test func clearingMentionStylesFollowsTheLiveDOMStyleDelta() throws {
    let model = Editor()
    let mention: JSONValue = ["type": "mention", "version": 1, "text": "Reader", "mentionName": "Reader", "mode": "segmented", "detail": 1, "format": 0, "style": "background-color: red;"]
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([mention])]))
    let storage = NSMutableAttributedString()
    let document = DocumentText(model: model, style: { _, _ in [:] })
    try document.reload(storage)
    #expect(storage.attribute(.backgroundColor, at: 0, effectiveRange: nil) != nil)
    try model.apply(.setSelection(anchor: .text([0, 0], 0), focus: .text([0, 0], 6)))
    let change = try model.apply(.clearFormatting)
    try document.update(storage, after: change)
    #expect(storage.attribute(.backgroundColor, at: 0, effectiveRange: nil) == nil)
  }

  @Test func mentionDOMStyleOverridesStoredInlineColors() throws {
    let model = Editor()
    let mention: JSONValue = ["type": "mention", "version": 1, "text": "Reader", "mentionName": "Reader", "mode": "segmented", "detail": 1, "format": 0, "style": "color: red; background-color: red;"]
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([mention])]))
    let storage = NSMutableAttributedString()
    try DocumentText(model: model, style: Self.style).reload(storage)
    #expect(storage.string == "Reader\n")
    #expect(storage.attribute(.foregroundColor, at: 0, effectiveRange: nil) == nil)
    #if canImport(UIKit)
    let color = try #require(storage.attribute(.backgroundColor, at: 0, effectiveRange: nil) as? UIColor)
    var red: CGFloat = 0; var green: CGFloat = 0; var blue: CGFloat = 0; var alpha: CGFloat = 0
    color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    #else
    let color = try #require(storage.attribute(.backgroundColor, at: 0, effectiveRange: nil) as? NSColor)
    let red = color.redComponent; let green = color.greenComponent; let blue = color.blueComponent; let alpha = color.alphaComponent
    #endif
    #expect(abs(red - 24.0 / 255) < 0.001 && abs(green - 119.0 / 255) < 0.001)
    #expect(abs(blue - 232.0 / 255) < 0.001 && abs(alpha - 0.2) < 0.001)
  }

  @Test func textAndHighlightColorsReachNativeRuns() throws {
    let model = Editor()
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([
      LexicalJSON.text("abc", style: "color: #ff0000; background-color: #0000ff;")
    ])]))
    let storage = NSMutableAttributedString()
    try DocumentText(model: model, style: Self.style).reload(storage)
    #if canImport(UIKit)
    let foreground = try #require(storage.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor)
    let background = try #require(storage.attribute(.backgroundColor, at: 0, effectiveRange: nil) as? UIColor)
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 0
    foreground.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    #expect(red == 1 && green == 0 && blue == 0 && alpha == 1)
    background.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    #expect(red == 0 && green == 0 && blue == 1 && alpha == 1)
    #else
    let foreground = try #require((storage.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? NSColor)?.usingColorSpace(.deviceRGB))
    let background = try #require((storage.attribute(.backgroundColor, at: 0, effectiveRange: nil) as? NSColor)?.usingColorSpace(.deviceRGB))
    #expect(foreground.redComponent == 1 && foreground.greenComponent == 0 && foreground.blueComponent == 0)
    #expect(background.redComponent == 0 && background.greenComponent == 0 && background.blueComponent == 1)
    #endif
  }

  @Test func fontSizeStyleReachesNativeFont() throws {
    let model = Editor()
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("abc", style: "font-size: 32px;")])]))
    #if canImport(UIKit)
    let font = UIFont.systemFont(ofSize: 16)
    #else
    let font = NSFont.systemFont(ofSize: 16)
    #endif
    let text = DocumentText(model: model, style: { _, _ in [.font: font] })
    let storage = NSMutableAttributedString()
    try text.reload(storage)
    #if canImport(UIKit)
    #expect((storage.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)?.pointSize == 32)
    #else
    #expect((storage.attribute(.font, at: 0, effectiveRange: nil) as? NSFont)?.pointSize == 32)
    #endif
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

extension DocumentTextTests {
  @Test func nativeStructuralPanelsOccupyOneSelectableBlock() throws {
    let model = Editor()
    try model.load(
      LexicalJSON.document([
        LexicalJSON.element(
          "callout", [LexicalJSON.paragraph([LexicalJSON.text("body")])], ["kind": "note", "title": ""])
      ]))
    let document = DocumentText(model: model, style: Self.style)
    document.embeddedElementTypes = ["callout"]
    let storage = NSMutableAttributedString()
    try document.reload(storage)
    #expect(document.kind(ofBlock: 0) == .embedded(type: "callout"))
    #expect(document.range(ofBlock: 0).length == 1)
  }
}
