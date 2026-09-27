#if canImport(UIKit)
import LexicalFuzz
import LexicalSwift
import Testing
import TextKitEditor
import UIKit

/// The hardware keys a UI script can't press: the simulator never passes
/// Delete or Forward Delete from XCUITest's `typeKey` to the app. These run
/// each key's command as UIKit would on the key.
@MainActor @Suite struct EditorViewTests {
  /// Backspace alone is the keyboard's: it calls `deleteBackward`.
  @Test func backspaceHasNoCommand() throws {
    let model = Editor()
    try model.load(LexicalJSON.document([LexicalJSON.paragraph([])]))
    let commands = EditorView(model: model).keyCommands ?? []
    #expect(!commands.contains { $0.input == UIKeyCommand.inputDelete && $0.modifierFlags.isEmpty })
  }

  @Test func optionDeleteDeletesTheWordBeforeTheCaret() throws {
    #expect(try text(afterPressing: UIKeyCommand.inputDelete, .alternate, in: "one two three", caretAt: 13) == "one two ")
  }

  @Test func commandDeleteDeletesToTheStartOfTheLine() throws {
    #expect(try text(afterPressing: UIKeyCommand.inputDelete, .command, in: "one two three", caretAt: 8) == "three")
  }

  @Test func forwardDeleteDeletesTheCharacterAfterTheCaret() throws {
    #expect(try text(afterPressing: "\u{7F}", [], in: "one two", caretAt: 0) == "ne two")
  }

  @Test func forwardDeleteDeletesAJoinedEmojiWhole() throws {
    let family = "👨‍👩‍👧"
    #expect(
      try text(afterPressing: "\u{7F}", [], in: family + "👍🏽🇯🇵", caretAt: family.utf16.count)
        == family + "🇯🇵")
  }

  @Test func optionForwardDeleteDeletesTheWordAfterTheCaret() throws {
    #expect(try text(afterPressing: "\u{7F}", .alternate, in: "one two", caretAt: 0) == " two")
  }

  /// A document the user may only read shows no keyboard, and no edit
  /// reaches it however it is asked for.
  @Test func aReadOnlyViewTakesNoEdits() throws {
    let (view, model) = try editing(Self.linked, isEditable: false)
    let document = try model.snapshot().state
    view.pasteboard.string = "pasted"
    view.askForURL = { _, answer in answer("https://x.io") }

    #expect((view as any UITextInput).isEditable == false)
    select(view, 0, 3)
    view.toggleBoldface(nil)
    view.insertText("!")
    view.deleteBackward()
    view.replace(try #require(range(view, 0, 3)), withText: "1")
    view.setMarkedText("か", selectedRange: NSRange(location: 1, length: 0))
    view.unmarkText()
    view.cut(nil)
    view.paste(nil)
    view.addLink()
    select(view, 6, 6)
    view.editLink()
    view.removeLink()
    view.undoManager?.undo()

    #expect(try model.snapshot().state == document)
    #expect(view.pasteboard.string == "pasted")
  }

  /// Reading is what a read-only document is for, so its text can be
  /// selected and copied.
  @Test func aReadOnlyViewCopiesTheSelection() throws {
    let (view, _) = try editing(LexicalJSON.paragraph([LexicalJSON.text("hello world")]), isEditable: false)
    select(view, 6, 11)

    #expect(view.canPerformAction(#selector(UIResponderStandardEditActions.copy(_:)), withSender: nil))
    view.copy(nil)

    #expect(view.pasteboard.string == "world")
  }

  /// What would edit isn't offered on a read-only view, in the edit menu or
  /// on a hardware keyboard.
  @Test func aReadOnlyViewOffersNothingThatEdits() throws {
    let (view, _) = try editing(Self.linked, isEditable: false)
    view.pasteboard.string = "pasted"
    select(view, 0, 3)

    for action in [
      #selector(UIResponder.toggleBoldface(_:)), #selector(UIResponder.toggleItalics(_:)),
      #selector(UIResponder.toggleUnderline(_:)), #selector(UIResponderStandardEditActions.cut(_:)),
      #selector(UIResponderStandardEditActions.paste(_:)),
    ] {
      #expect(!view.canPerformAction(action, withSender: nil), "\(action)")
    }
    #expect(view.canPerformAction(#selector(UIResponder.selectAll(_:)), withSender: nil))
    #expect(linkActions(view, 0, 3) == [])
    #expect(linkActions(view, 6, 6) == ["Open Link"])
    let keys = view.keyCommands ?? []
    #expect(!keys.contains { [UIKeyCommand.inputDelete, "\u{7F}", "\r", "k"].contains($0.input) })
    #expect(keys.contains { $0.input == UIKeyCommand.inputLeftArrow && $0.modifierFlags.isEmpty })
    let whole = try #require(view.textRange(from: view.beginningOfDocument, to: view.endOfDocument))
    let menu = view.editMenu(for: whole, suggestedActions: [])
    #expect(menu?.children.contains { $0.title == "Table" } != true)
  }

  /// VoiceOver names a block the editor can't show yet by its type, where
  /// the text holds one character for it.
  @Test func readsABlockItCantShowYetByItsType() throws {
    let model = Editor()
    try model.load(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("Watch this")]), LexicalJSON.youtube("dQw4w9WgXcQ"),
        LexicalJSON.paragraph([LexicalJSON.text("after")]),
      ]))
    let view = EditorView(model: model)

    #expect(view.accessibilityValue == "Watch this\nyoutube\nafter\n")
  }

  /// ⌘⌥0 to ⌘⌥3 and ⌘⌥Q set the block type, as on the web.
  @Test(arguments: [("1", "h1"), ("2", "h2"), ("3", "h3"), ("q", "quote"), ("0", "paragraph")])
  func commandOptionKeysSetTheBlockType(_ input: String, _ type: String) throws {
    let (model, view) = try host(
      LexicalJSON.document([LexicalJSON.heading("h4", [LexicalJSON.text("one")])]), caretAt: 1)

    try press(input, [.command, .alternate], in: view)

    let block = try model.snapshot().state["root"]?["children"]?.arrayValue?.first
    #expect((block?["type"] == "heading" ? block?["tag"] : block?["type"])?.stringValue == type)
    #expect(block?["children"]?.arrayValue?.first?["text"] == "one")
  }

  /// A composition reaches the model as one commit, which can finish a
  /// markdown shortcut as the end of a composition does on the web.
  @Test func aCompositionThatEndsInASpaceFinishesAShortcut() throws {
    let (model, view) = try host(LexicalJSON.document([LexicalJSON.paragraph([])]), caretAt: 0)

    view.setMarkedText("# ", selectedRange: NSRange(location: 2, length: 0))
    view.unmarkText()

    #expect(try model.snapshot().state["root"]?["children"]?.arrayValue?.first?["type"] == "heading")
  }

  /// Tab moves to the end of the next table cell, and Shift-Tab to the
  /// end of the one before, as @lexical/table's Tab does.
  @Test func tabMovesBetweenTableCells() throws {
    let (view, model) = try tableView(caretAfter: "one")
    try press("\t", [], in: view)
    view.insertText("!")
    try press("\t", .shift, in: view)
    view.insertText("?")

    let rows = try model.snapshot().state["root"]?["children"]?.arrayValue?.first?["children"]?.arrayValue ?? []
    let texts: [[String]] = rows.map { row in
      (row["children"]?.arrayValue ?? []).map { cell in
        let paragraph = cell["children"]?.arrayValue?.first
        return paragraph?["children"]?.arrayValue?.first?["text"]?.stringValue ?? ""
      }
    }
    #expect(texts == [["one?", "two!"]])
  }

  /// Outside a table, Tab types a tab, as the key did before tables took it.
  @Test func tabOutsideATableTypesATab() throws {
    #expect(try text(afterPressing: "\t", [], in: "one", caretAt: 3) == "one\t")
  }

  /// Over selected cells, Tab is taken by nothing, so it types nothing and
  /// the cells stay selected.
  @Test func tabOverSelectedCellsLeavesThemSelected() throws {
    let (view, model) = try tableView(caretAfter: "one")
    let two = try #require(view.position(from: view.beginningOfDocument, offset: 5))
    view.selectedTextRange = view.textRange(from: view.beginningOfDocument, to: two)
    let selected = try model.selection()
    guard case .table(table: [0], _, _, _) = selected else {
      Issue.record("Expected cells selected, not \(String(describing: selected))")
      return
    }

    try press("\t", [], in: view)

    #expect(try model.selection() == selected)
  }

  /// Shift and an arrow over selected cells move the focus a whole cell, as
  /// @lexical/table's arrow keys do, so the cells selected grow and shrink.
  @Test func shiftArrowsMoveSelectedCellsFocusACellAtATime() throws {
    let (view, model) = try tableView([["one", "two", "six"], ["three", "four", "ten"]], caretAfter: "one")
    try press(UIKeyCommand.inputRightArrow, .shift, in: view)
    #expect(try selectedCells(model) == [[0, 0, 0], [0, 0, 1]])
    try press(UIKeyCommand.inputRightArrow, .shift, in: view)
    #expect(try selectedCells(model) == [[0, 0, 0], [0, 0, 1], [0, 0, 2]])
    try press(UIKeyCommand.inputDownArrow, .shift, in: view)
    #expect(try selectedCells(model) == [[0, 0, 0], [0, 0, 1], [0, 0, 2], [0, 1, 0], [0, 1, 1], [0, 1, 2]])
    try press(UIKeyCommand.inputLeftArrow, .shift, in: view)
    #expect(try selectedCells(model) == [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1]])
  }

  /// Selected cells keep a handle in the anchor cell and one in the focus
  /// cell, and a handle moved to another cell selects what the model makes
  /// of the range it gives.
  @Test func selectedCellsKeepHandlesThatChangeWhichAreSelected() throws {
    let (view, model) = try tableView([["one", "two"], ["three", "four"]], caretAfter: "one")
    let whole = try #require(view.textRange(from: view.beginningOfDocument, to: view.endOfDocument))
    let text = try #require(view.text(in: whole)) as NSString
    func offset(_ word: String, _ within: Int) -> Int { text.range(of: word).location + within }
    func position(_ offset: Int) throws -> UITextPosition {
      try #require(view.position(from: view.beginningOfDocument, offset: offset))
    }
    func select(_ from: Int, _ to: Int) throws {
      view.selectedTextRange = view.textRange(from: try position(from), to: try position(to))
    }
    try select(offset("one", 0), offset("two", 1))
    #expect(try selectedCells(model) == [[0, 0, 0], [0, 0, 1]])

    let selected = try #require(view.selectedTextRange)
    let rects = view.selectionRects(for: selected)
    let start = try #require(rects.first { $0.containsStart }).rect
    let end = try #require(rects.first { $0.containsEnd }).rect
    let startCaret = view.caretRect(for: try position(offset("one", 0)))
    let endCaret = view.caretRect(for: try position(offset("two", 3)))
    #expect(start.origin == startCaret.origin && start.height == startCaret.height)
    #expect(end.origin == endCaret.origin && end.height == endCaret.height)

    try select(offset("one", 0), offset("four", 2))
    #expect(try selectedCells(model) == [[0, 0, 0], [0, 0, 1], [0, 1, 0], [0, 1, 1]])
    try select(offset("one", 0), offset("three", 2))
    #expect(try selectedCells(model) == [[0, 0, 0], [0, 1, 0]])
  }

  /// Down from a table's last row, at the end of the document, leaves the
  /// table: the caret is beside it at the root, and drawn under it.
  @Test func downLeavesATableAtTheEndOfTheDocument() throws {
    let (view, model) = try tableView([["one"], ["two"]], caretAfter: "two")
    let inCell = view.caretRect(for: try #require(view.selectedTextRange).start)
    try press(UIKeyCommand.inputDownArrow, [], in: view)

    let selection = try #require(try model.selection())
    #expect(selection.isCollapsed && selection.focus == Point(path: [], offset: 1, type: .element))
    let caret = view.caretRect(for: try #require(view.selectedTextRange).start)
    #expect(caret.minY > inCell.maxY)
    #expect(caret.width > caret.height)

    try press(UIKeyCommand.inputUpArrow, [], in: view)
    #expect(view.caretRect(for: try #require(view.selectedTextRange).start) == inCell)
  }

  /// A tap past a cell's text, which UIKit resolves through the character
  /// there, keeps the caret in the cell rather than taking the newline that
  /// ends it and landing in the next.
  @Test func theCharacterPastACellsTextIsInTheCell() throws {
    let (view, _) = try tableView([["a", "b"]], caretAfter: "b")
    let end = try #require(view.position(from: view.beginningOfDocument, offset: 1))
    let caret = view.caretRect(for: end)

    let range = try #require(view.characterRange(at: CGPoint(x: caret.maxX + 2, y: caret.midY)))

    #expect(view.compare(range.end, to: end) != .orderedDescending)
  }

  private func selectedCells(_ model: Editor) throws -> [[Int]]? {
    guard case .table(_, _, _, let cells) = try model.selection() else { return nil }
    return cells
  }

  private func tableView(_ rows: [[String]] = [["one", "two"]], caretAfter word: String) throws -> (EditorView, Editor) {
    let model = Editor()
    try model.load(LexicalJSON.document([LexicalJSON.table(rows)]))
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
    let view = EditorView(model: model)
    view.frame = window.bounds
    window.addSubview(view)
    window.makeKeyAndVisible()
    #expect(view.becomeFirstResponder())
    view.layoutIfNeeded()
    let whole = try #require(view.textRange(from: view.beginningOfDocument, to: view.endOfDocument))
    let text = try #require(view.text(in: whole)) as NSString
    let caret = try #require(view.position(from: view.beginningOfDocument, offset: NSMaxRange(text.range(of: word))))
    view.selectedTextRange = view.textRange(from: caret, to: caret)
    return (view, model)
  }

  private func press(_ input: String, _ modifiers: UIKeyModifierFlags, in view: EditorView) throws {
    let command = try #require(view.keyCommands?.first { $0.input == input && $0.modifierFlags == modifiers })
    view.perform(try #require(command.action), with: command)
  }

  /// Backspace from an empty block after a rule takes the block and selects
  /// the rule whole, as on the web: the view highlights no text for it,
  /// typing and composing leave it be, and Backspace again deletes it.
  @Test func backspaceSelectsARuleWholeAndThenDeletesIt() throws {
    let (model, view) = try host(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("a")]), LexicalJSON.horizontalRule, LexicalJSON.paragraph([]),
      ]), caretAt: 4)

    view.deleteBackward()
    #expect(try model.selection() == .node(nodes: [[1]]))
    let selected = try #require(view.selectedTextRange)
    #expect(view.offset(from: view.beginningOfDocument, to: selected.start) == 2)
    #expect(view.offset(from: view.beginningOfDocument, to: selected.end) == 3)
    #expect(view.selectionRects(for: selected).isEmpty)

    let document = try model.snapshot().state
    let text = try LayoutTests.text(of: view)
    view.insertText("x")
    view.setMarkedText("か", selectedRange: NSRange(location: 1, length: 0))
    #expect(view.markedTextRange == nil)
    view.unmarkText()
    #expect(try model.snapshot().state == document)
    #expect(try LayoutTests.text(of: view) == text)
    #expect(try model.selection() == .node(nodes: [[1]]))

    view.deleteBackward()
    let types = try paragraphs(model).compactMap { $0["type"]?.stringValue }
    #expect(types == ["paragraph"])
  }

  @Test func tabIndentsAnItemAndShiftTabOutdentsIt() throws {
    let (model, view) = try host(
      LexicalJSON.document([
        LexicalJSON.list(.bullet, [.item([LexicalJSON.text("a")]), .item([LexicalJSON.text("b")])])
      ]), caretAt: 2)

    try press("\t", [], in: view)
    #expect(
      try model.snapshot().state
        == LexicalJSON.document([
          LexicalJSON.list(.bullet, [.item([LexicalJSON.text("a")]), .nested(.bullet, [.item([LexicalJSON.text("b")])])])
        ]))

    try press("\t", .shift, in: view)
    #expect(
      try model.snapshot().state
        == LexicalJSON.document([
          LexicalJSON.list(.bullet, [.item([LexicalJSON.text("a")]), .item([LexicalJSON.text("b")])])
        ]))
  }

  @Test func tabInsideTextInsertsATab() throws {
    let (model, view) = try host(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("ab")])]), caretAt: 1)

    try press("\t", [], in: view)

    #expect(
      try model.snapshot().state
        == LexicalJSON.document([
          LexicalJSON.paragraph([LexicalJSON.text("a"), LexicalJSON.tab(), LexicalJSON.text("b")])
        ]))
  }

  @Test func listsComeAndGoAndIndentFromTheView() throws {
    let (model, view) = try host(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("a")])]), caretAt: 1)

    view.insertList(.check)
    #expect(
      try model.snapshot().state == LexicalJSON.document([LexicalJSON.list(.check, [.item([LexicalJSON.text("a")])])]))

    view.removeList()
    view.indent()
    view.indent()
    view.outdent()
    #expect(
      try model.snapshot().state == LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text("a")], indent: 1)]))
  }

  // MARK: Clipboard

  @Test func copyPutsTheSelectionOnThePasteboardAsTextAndAsLexicalNodes() throws {
    let (view, _) = try editing(LexicalJSON.paragraph([LexicalJSON.text("hello world")]))
    select(view, 6, 11)

    view.copy(nil)

    #expect(view.pasteboard.string == "world")
    let data = try #require(view.pasteboard.data(forPasteboardType: "application/x-lexical-editor"))
    let copied = try JSONDecoder().decode(JSONValue.self, from: data)
    #expect(copied == ["namespace": "Lexidraw", "nodes": [LexicalJSON.text("world")]])
  }

  @Test func cutPutsTheSelectionOnThePasteboardAndDeletesIt() throws {
    let (view, model) = try editing(LexicalJSON.paragraph([LexicalJSON.text("hello world")]))
    select(view, 5, 11)

    view.cut(nil)

    #expect(view.pasteboard.string == " world")
    #expect(try paragraphs(model) == [LexicalJSON.paragraph([LexicalJSON.text("hello")])])
  }

  @Test func pastingWhatWasCopiedKeepsItsFormat() throws {
    let (source, _) = try editing(
      LexicalJSON.paragraph([LexicalJSON.text("one")]), LexicalJSON.paragraph([LexicalJSON.text("two", format: .bold)]))
    select(source, 1, 7)
    source.copy(nil)
    let (view, model) = try editing(LexicalJSON.paragraph([LexicalJSON.text("hello world")]))
    view.pasteboard = source.pasteboard
    select(view, 5, 5)

    view.paste(nil)

    #expect(
      try paragraphs(model) == [
        LexicalJSON.paragraph([LexicalJSON.text("hellone")]),
        LexicalJSON.paragraph([LexicalJSON.text("two", format: .bold), LexicalJSON.text(" world")]),
      ])
  }

  @Test func pastingFromAnotherAppInsertsItsPlainText() throws {
    let (view, model) = try editing(LexicalJSON.paragraph([]))
    view.pasteboard.setItems([["public.utf8-plain-text": "a\nb", "public.html": Data("<b>a</b><br>b".utf8)]])

    #expect(view.canPerformAction(#selector(UIResponderStandardEditActions.paste(_:)), withSender: nil))
    view.paste(nil)

    #expect(
      try paragraphs(model) == [
        LexicalJSON.paragraph([LexicalJSON.text("a")]), LexicalJSON.paragraph([LexicalJSON.text("b")]),
      ])
  }

  @Test func aPasteTheModelRefusesSaysWhy() throws {
    let (view, model) = try editing(LexicalJSON.paragraph([LexicalJSON.text("hello")]))
    let image: JSONValue = ["type": "image", "version": 1, "src": "https://a.io/b.png"]
    let payload = LexicalClipboardPayload(namespace: editorNamespace, nodes: [image])
    view.pasteboard.setItems([
      ["public.utf8-plain-text": "", "application/x-lexical-editor": try JSONEncoder().encode(payload)]
    ])
    var told: String?
    view.tellRefusal = { told = $0 }
    select(view, 5, 5)

    view.paste(nil)

    #expect(told == "Pasting image nodes isn't supported yet (#131)")
    #expect(try paragraphs(model) == [LexicalJSON.paragraph([LexicalJSON.text("hello")])])
  }

  @Test func offersToCopyOnlyASelectionAndToPasteOnlyWhatThereIs() throws {
    let (view, _) = try editing(LexicalJSON.paragraph([LexicalJSON.text("hello")]))
    select(view, 2, 2)

    #expect(!view.canPerformAction(#selector(UIResponderStandardEditActions.copy(_:)), withSender: nil))
    #expect(!view.canPerformAction(#selector(UIResponderStandardEditActions.cut(_:)), withSender: nil))
    #expect(!view.canPerformAction(#selector(UIResponderStandardEditActions.paste(_:)), withSender: nil))
    select(view, 0, 2)
    #expect(view.canPerformAction(#selector(UIResponderStandardEditActions.copy(_:)), withSender: nil))
  }

  // MARK: Links

  static let linked = LexicalJSON.paragraph([
    LexicalJSON.text("see "), LexicalJSON.link("https://a.io", [LexicalJSON.text("the site")]), LexicalJSON.text(" now"),
  ])

  @Test func theEditMenuOffersToLinkASelection() throws {
    let (view, _) = try editing(LexicalJSON.paragraph([LexicalJSON.text("hello world")]))

    #expect(linkActions(view, 6, 11) == ["Add Link…"])
    #expect(linkActions(view, 6, 6) == [])
  }

  @Test func theEditMenuOffersTheLinkActionsAndTheTableMenu() throws {
    let (view, _) = try editing(LexicalJSON.paragraph([LexicalJSON.text("hello world")]))

    let menu = view.editMenu(for: try #require(range(view, 6, 11)), suggestedActions: [])

    #expect(menu?.children.map(\.title) == ["Add Link…", "Table"])
  }

  @Test func theEditMenuInALinkOffersToOpenEditOrRemoveIt() throws {
    let (view, _) = try editing(Self.linked)

    #expect(linkActions(view, 6, 6) == ["Open Link", "Edit Link…", "Remove Link"])
    #expect(view.link(at: 6) == URL(string: "https://a.io"))
    #expect(view.link(at: 2) == nil)
  }

  /// The web opens a link only with a protocol it supports, so no other
  /// link is offered to open.
  @Test(arguments: [("mailto:a@b.io", true), ("TEL:+1", true), ("ftp://x.io", false), ("javascript:x()", false)])
  func theEditMenuOffersToOpenALinkOnlyWithAProtocolTheWebOpens(_ url: String, _ opens: Bool) throws {
    let (view, _) = try editing(LexicalJSON.paragraph([LexicalJSON.link(url, [LexicalJSON.text("the site")])]))
    var opened: URL?
    view.open = { opened = $0 }
    select(view, 2, 2)

    view.openLink()

    #expect(linkActions(view, 2, 2) == (opens ? ["Open Link"] : []) + ["Edit Link…", "Remove Link"])
    #expect(opened == (opens ? URL(string: url) : nil))
  }

  @Test func addingALinkLinksTheSelectionToTheURLGiven() throws {
    let (view, model) = try editing(LexicalJSON.paragraph([LexicalJSON.text("hello world")]))
    var offered: String?
    view.askForURL = { current, answer in
      offered = current
      answer("https://x.io")
    }
    select(view, 6, 11)

    view.addLink()

    #expect(offered == "https://")
    #expect(
      try paragraphs(model) == [
        LexicalJSON.paragraph([
          LexicalJSON.text("hello "), LexicalJSON.link("https://x.io", [LexicalJSON.text("world")]),
        ])
      ])
  }

  @Test func editingALinkChangesItsURLAsTheWebWritesIt() throws {
    let (view, model) = try editing(Self.linked)
    var offered: String?
    view.askForURL = { current, answer in
      offered = current
      answer("HTTPS://B.io")
    }
    select(view, 6, 6)

    view.editLink()

    #expect(offered == "https://a.io")
    #expect(try paragraphs(model).first?["children"]?.arrayValue?[1]["url"] == "https://b.io/")
  }

  /// As on the web, saving no URL changes nothing; removing is its own
  /// action.
  @Test func editingALinkToNoURLKeepsIt() throws {
    let (view, model) = try editing(Self.linked)
    view.askForURL = { _, answer in answer("") }
    select(view, 6, 6)

    view.editLink()

    #expect(try paragraphs(model) == [Self.linked])
  }

  @Test func removingALinkLeavesItsText() throws {
    let (view, model) = try editing(Self.linked)
    select(view, 6, 6)

    view.removeLink()

    #expect(try paragraphs(model) == [LexicalJSON.paragraph([LexicalJSON.text("see the site now")])])
  }

  @Test func openingALinkOpensItsURL() throws {
    let (view, _) = try editing(Self.linked)
    var opened: URL?
    view.open = { opened = $0 }
    select(view, 6, 6)

    view.openLink()

    #expect(opened == URL(string: "https://a.io"))
  }

  @Test func openingAnAutolinkOpensItsURLAndAnUndoneOneIsNoLink() throws {
    let (view, _) = try editing(
      LexicalJSON.paragraph([
        LexicalJSON.text("or "), LexicalJSON.autoLink("https://www.b.io", [LexicalJSON.text("www.b.io")]),
        LexicalJSON.text(" or "),
        LexicalJSON.autoLink("https://www.c.io", [LexicalJSON.text("www.c.io")], isUnlinked: true),
      ]))
    var opened: [URL] = []
    view.open = { opened.append($0) }

    select(view, 5, 5)
    view.openLink()
    select(view, 17, 17)
    view.openLink()

    #expect(opened == [URL(string: "https://www.b.io")])
    #expect(linkActions(view, 17, 17) == [])
  }

  /// A view editing a document of `blocks` in a window, first responder.
  private func editing(_ blocks: JSONValue..., isEditable: Bool = true) throws -> (EditorView, Editor) {
    let model = Editor()
    try model.load(LexicalJSON.document(blocks))
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
    let view = EditorView(model: model, isEditable: isEditable)
    view.pasteboard = UIPasteboard.withUniqueName()
    view.frame = window.bounds
    window.addSubview(view)
    window.makeKeyAndVisible()
    #expect(view.becomeFirstResponder())
    view.layoutIfNeeded()
    return (view, model)
  }

  private func select(_ view: EditorView, _ start: Int, _ end: Int) {
    view.selectedTextRange = range(view, start, end)
  }

  private func range(_ view: EditorView, _ start: Int, _ end: Int) -> UITextRange? {
    guard let from = view.position(from: view.beginningOfDocument, offset: start),
      let to = view.position(from: view.beginningOfDocument, offset: end)
    else { return nil }
    return view.textRange(from: from, to: to)
  }

  /// The titles the edit menu adds for links over UIKit's own.
  private func linkActions(_ view: EditorView, _ start: Int, _ end: Int) -> [String] {
    guard let range = range(view, start, end) else { return [] }
    return view.editMenu(for: range, suggestedActions: [])?.children.map(\.title).filter { $0 != "Table" } ?? []
  }

  private func paragraphs(_ model: Editor) throws -> [JSONValue] {
    try model.snapshot().state["root"]?["children"]?.arrayValue ?? []
  }

  /// The paragraph's text after the key command for `input` and `modifiers`
  /// runs with the caret `caretAt` UTF-16 offsets into `text`.
  private func text(
    afterPressing input: String, _ modifiers: UIKeyModifierFlags, in text: String, caretAt offset: Int
  ) throws -> String {
    let (model, view) = try host(LexicalJSON.document([LexicalJSON.paragraph([LexicalJSON.text(text)])]), caretAt: offset)
    try press(input, modifiers, in: view)
    let paragraph = try model.snapshot().state["root"]?["children"]?.arrayValue?.first
    return (paragraph?["children"]?.arrayValue ?? []).compactMap { $0["text"]?.stringValue }.joined()
  }

  /// A view of `document`, first responder with the caret `caretAt` UTF-16
  /// offsets into its text.
  private func host(_ document: JSONValue, caretAt offset: Int) throws -> (Editor, EditorView) {
    let model = Editor()
    try model.load(document)
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 600))
    let view = EditorView(model: model)
    view.frame = window.bounds
    window.addSubview(view)
    window.makeKeyAndVisible()
    #expect(view.becomeFirstResponder())
    view.layoutIfNeeded()
    let caret = try #require(view.position(from: view.beginningOfDocument, offset: offset))
    view.selectedTextRange = view.textRange(from: caret, to: caret)
    return (model, view)
  }
}
#endif
