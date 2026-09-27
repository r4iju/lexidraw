import LexicalFuzz
import LexicalSwift
import Testing

/// A rule selected whole, as Lexical's NodeSelection holds one where an
/// arrow or a deletion reaches it, and what the web's keys and menus do to
/// it: each script runs on the reference, and LexicalSwift has to agree.
@Suite struct NodeSelectionTests {
  init() {}

  private func agreed(_ start: JSONValue, _ commands: [EditorCommand]) throws -> Fixture {
    let fixture = try Fixture.record(start: start, commands: commands, on: try Support.referenceEditor())
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
    return fixture
  }

  private let rule = LexicalJSON.horizontalRule
  private let start = Point(path: [0], offset: 0, type: .element)

  private func arrow(_ key: ArrowKey, extend: Bool = false, native: Point) -> EditorCommand {
    .arrow(key, extend: extend, native: native, atCellEdge: false)
  }

  /// Down from the empty block before the rule, which selects it.
  private var ontoTheRule: [EditorCommand] { [.caret(start), arrow(.down, native: start)] }

  private var ruleBetween: JSONValue { document(paragraph(), rule, paragraph(text("ab"))) }

  private func types(_ snapshot: Snapshot) -> [String] {
    snapshot.state["root"]?["children"]?.arrayValue?.compactMap { $0["type"]?.stringValue } ?? []
  }

  private func changes(_ fixture: Fixture) -> ChangeSet? {
    if case .applied(let changes) = fixture.changes.last { changes } else { nil }
  }

  private func element(_ path: [Int], _ offset: Int) -> Point { Point(path: path, offset: offset, type: .element) }

  @Test func anArrowOrABackspaceOntoARuleSelectsIt() throws {
    let down = try agreed(ruleBetween, ontoTheRule)
    #expect(down.expected.selection == .node(nodes: [[1]]))

    let backspace = try agreed(
      document(paragraph(text("a")), rule, paragraph()), [.caret(element([2], 0)), .deleteCharacter(backward: true)])
    #expect(backspace.expected.selection == .node(nodes: [[1]]))
  }

  @Test func anArrowLeavesASelectedRuleTowardItsSide() throws {
    for (key, landing) in [(ArrowKey.up, element([0], 0)), (.left, element([0], 0)), (.down, element([2], 0)), (.right, element([2], 0))] {
      let fixture = try agreed(ruleBetween, ontoTheRule + [arrow(key, native: start)])
      #expect(fixture.expected.selection?.anchor == landing)
    }
    let last = try agreed(document(paragraph(), rule), ontoTheRule + [arrow(.down, native: start)])
    #expect(last.expected.selection?.anchor == element([], 2))

    let twoRules = document(rule, rule, paragraph())
    let third = element([2], 0)
    let up = try agreed(twoRules, [.caret(third), arrow(.up, native: third), arrow(.up, native: third)])
    #expect(up.expected.selection?.anchor == element([], 1))
  }

  /// Shift and an arrow make the rule a range, which the platform extends.
  @Test func shiftAndAnArrowExtendFromASelectedRule() throws {
    let down = try agreed(ruleBetween, ontoTheRule + [arrow(.down, extend: true, native: .text([2, 0], 1))])
    #expect(down.expected.selection?.anchor == element([], 1))
    #expect(down.expected.selection?.focus == .text([2, 0], 1))

    let up = try agreed(ruleBetween, ontoTheRule + [arrow(.up, extend: true, native: start)])
    #expect(up.expected.selection?.anchor == element([], 2))
  }

  @Test func backspaceAndDeleteRemoveASelectedRule() throws {
    for backward in [true, false] {
      let fixture = try agreed(ruleBetween, ontoTheRule + [.deleteCharacter(backward: backward)])
      #expect(types(fixture.expected) == ["paragraph", "paragraph"])
      #expect(fixture.expected.selection?.anchor == element([], 1))
    }
    let only = try agreed(document(paragraph(), rule), ontoTheRule + [.deleteCharacter(backward: true)])
    #expect(types(only.expected) == ["paragraph"])
  }

  @Test func undoAndRedoBringBackASelectedRule() throws {
    let fixture = try agreed(
      ruleBetween, ontoTheRule + [.wait(milliseconds: 10), .deleteCharacter(backward: true), .undo])
    #expect(fixture.expected.selection == .node(nodes: [[1]]))
    _ = try agreed(ruleBetween, ontoTheRule + [.deleteCharacter(backward: true), .undo, .redo])
  }

  /// Keys and menus that answer a range alone leave a selected rule as it
  /// is, typing among them: a browser has no caret to type at.
  @Test func whatAnswersARangeAloneLeavesASelectedRuleBe() throws {
    let commands: [EditorCommand] = [
      .insertText("x"), .commitComposition("x"), .deleteWord(backward: true),
      .deleteLine(backward: true, lineBoundary: start), .formatText(.bold), .setBlockType(.h1),
      .insertList(.bullet), .removeList, .indent, .outdent, .tab(backward: false), .toggleLink(url: nil),
      .toggleLink(url: "not a url"), plain("hello"),
    ]
    for command in commands {
      let fixture = try agreed(ruleBetween, ontoTheRule + [command])
      #expect(fixture.expected.selection == .node(nodes: [[1]]), "\(command)")
      #expect(changes(fixture)?.changed == [], "\(command)")
    }
    let refused = try agreed(ruleBetween, ontoTheRule + [.insertTableRow(after: true)])
    #expect(refused.changes.last == .refused(.invalidState))
  }

  @Test func enterAfterASelectedRuleStartsTheBlockAfterIt() throws {
    let enter = try agreed(ruleBetween, ontoTheRule + [.insertParagraph])
    #expect(types(enter.expected) == ["paragraph", "horizontalrule", "paragraph", "paragraph"])
    #expect(enter.expected.selection?.anchor == .text([3, 0], 0))

    let last = try agreed(document(paragraph(), rule), ontoTheRule + [.insertParagraph])
    #expect(types(last.expected) == ["paragraph", "horizontalrule", "paragraph"])

    let lineBreak = try agreed(ruleBetween, ontoTheRule + [.insertLineBreak])
    #expect(lineBreak.expected.selection?.anchor == .text([2, 1], 0))
  }

  @Test func copyingOrCuttingASelectedRuleTakesTheRule() throws {
    let copy = try agreed(ruleBetween, ontoTheRule + [.copy])
    #expect(changes(copy)?.clipboard == copied("\n", rule))

    let cut = try agreed(ruleBetween, ontoTheRule + [.cut])
    #expect(changes(cut)?.clipboard == copied("\n", rule))
    #expect(types(cut.expected) == ["paragraph", "paragraph"])
    #expect(cut.expected.selection?.anchor == element([0], 0))

    _ = try agreed(ruleBetween, ontoTheRule + [.cut, .undo])
    _ = try agreed(document(paragraph(), rule), ontoTheRule + [.cut, .deleteCharacter(backward: true)])
  }

  /// Pasted nodes take the rule's place; pasted text has no caret to go to.
  @Test func pastingOverASelectedRuleReplacesIt() throws {
    let paragraphs = try agreed(ruleBetween, ontoTheRule + [.paste(copied("a\nb", paragraph(text("a")), paragraph(text("b"))))])
    #expect(types(paragraphs.expected) == ["paragraph", "paragraph", "paragraph", "paragraph"])

    let words = try agreed(ruleBetween, ontoTheRule + [.paste(copied("pp", text("pp")))])
    #expect(types(words.expected) == ["paragraph", "paragraph", "paragraph"])

    _ = try agreed(ruleBetween, ontoTheRule + [.paste(copied("\n", rule))])
  }

  /// A link wraps a selected rule, in a paragraph of its own as a root holds
  /// blocks, and keeps it selected.
  @Test func linkingASelectedRuleWrapsIt() throws {
    let url = "https://example.com"
    let linked = try agreed(ruleBetween, ontoTheRule + [.toggleLink(url: url)])
    #expect(linked.expected.selection == .node(nodes: [[1, 0, 0]]))

    let unlinked = try agreed(ruleBetween, ontoTheRule + [.toggleLink(url: url), .toggleLink(url: nil)])
    #expect(unlinked.expected.selection == .node(nodes: [[1, 0]]))

    _ = try agreed(ruleBetween, ontoTheRule + [.toggleLink(url: url), .toggleLink(url: "https://example.org")])
    _ = try agreed(ruleBetween, ontoTheRule + [.editLink(url: url)])
    _ = try agreed(ruleBetween, ontoTheRule + [.toggleLink(url: url), .undo])
    let deleted = try agreed(ruleBetween, ontoTheRule + [.toggleLink(url: url), .deleteCharacter(backward: true)])
    #expect(deleted.expected.selection?.anchor == element([1], 0))
    _ = try agreed(ruleBetween, ontoTheRule + [.toggleLink(url: url), arrow(.down, native: start)])
    _ = try agreed(ruleBetween, ontoTheRule + [.toggleLink(url: url), .insertParagraph])
    _ = try agreed(ruleBetween, ontoTheRule + [.toggleLink(url: url), .insertLineBreak])
    _ = try agreed(ruleBetween, ontoTheRule + [.toggleLink(url: url), .copy])
    _ = try agreed(ruleBetween, ontoTheRule + [.toggleLink(url: url), .cut])
  }

  /// The paragraph a link puts a selected rule in is a block that the
  /// block menus change, as the rule stays selected.
  @Test func theBlockALinkedRuleIsInTakesTheBlockMenus() throws {
    let link = EditorCommand.toggleLink(url: "https://example.com")
    let listed = try agreed(ruleBetween, ontoTheRule + [link, .insertList(.bullet)])
    #expect(types(listed.expected) == ["paragraph", "list", "paragraph"])
    for command: EditorCommand in [.formatText(.bold), .setBlockType(.h1), .indent, .removeList] {
      let fixture = try agreed(ruleBetween, ontoTheRule + [link, command])
      #expect(fixture.expected.selection == .node(nodes: [[1, 0, 0]]), "\(command)")
    }
    _ = try agreed(ruleBetween, ontoTheRule + [link, .insertList(.bullet), .insertList(.number)])
  }

  @Test func aTableGoesAfterASelectedRule() throws {
    let fixture = try agreed(ruleBetween, ontoTheRule + [.insertTable(rows: 1, columns: 1)])
    #expect(types(fixture.expected) == ["paragraph", "horizontalrule", "table", "paragraph"])
    #expect(fixture.expected.selection?.anchor == element([2, 0, 0, 0], 0))
  }

  @Test func selectingAllOrPlacingTheSelectionLeavesASelectedRule() throws {
    let all = try agreed(ruleBetween, ontoTheRule + [.selectAll])
    #expect(all.expected.selection?.focus == .text([2, 0], 2))

    let placed = try agreed(ruleBetween, ontoTheRule + [.caret(.text([2, 0], 1))])
    #expect(placed.expected.selection?.anchor == .text([2, 0], 1))
  }
}
