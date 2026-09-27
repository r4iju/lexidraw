import LexicalFuzz
import LexicalSwift
import Testing

/// The web editor's GFM table shortcut, and the markdown its cells import,
/// recorded from Lexical with the web's transformers and replayed on
/// LexicalSwift.
@Suite struct MarkdownTableTests {
  struct Script: CustomTestStringConvertible, Sendable {
    let name: String
    let start: JSONValue
    let commands: [EditorCommand]
    /// The document Lexical leaves, in `shape`'s short form.
    let expected: String
    /// Where Lexical leaves the caret, where the script says.
    var caret: Point?

    var testDescription: String { name }
  }

  static let emptyParagraph = document(paragraph())
  static let caretInEmptyParagraph = EditorCommand.caret(Point(path: [0], offset: 0, type: .element))
  static let twoColumns = LexicalJSON.table([["a", "b"], ["c", "d"]])
  static let caretUnderTable = caretInBlock(1)

  static func caretInBlock(_ index: Int) -> EditorCommand {
    .caret(Point(path: [index], offset: 0, type: .element))
  }

  /// One key at a time, as the shortcuts want them.
  static func typing(_ keys: String) -> [EditorCommand] {
    keys.map { .insertText(String($0)) }
  }

  /// A row typed in an empty paragraph, with the space that finishes it
  /// typed on its own.
  static func row(_ markdown: String) -> [EditorCommand] {
    [caretInEmptyParagraph, .insertText(markdown), .insertText(" ")]
  }

  static let rows: [Script] = [
    Script(
      name: "a row and a space make a table", start: emptyParagraph, commands: [caretInEmptyParagraph] + typing("|a|b| "),
      expected: "table[p(a)|p(b)]"),
    Script(
      name: "rows in the paragraphs above join it, the short ones padded",
      start: document(paragraph(text("|x|y|")), paragraph(text("|z| ")), paragraph()),
      commands: [caretInBlock(2)] + typing("|a|b|c| "),
      expected: "table[p(x)|p(y)|p()/p(z)|p()|p()/p(a)|p(b)|p(c)]"),
    Script(
      name: "a paragraph above of formatted text joins as its text",
      start: document(paragraph(text("|x|", format: .bold)), paragraph()), commands: [caretUnderTable] + typing("|a| "),
      expected: "table[p(x)/p(a)]"),
    Script(
      name: "a paragraph above of more than one text doesn't join",
      start: document(paragraph(text("|x"), text("|", format: .bold)), paragraph()),
      commands: [caretUnderTable] + typing("|a| "), expected: "p(|x|{1}) table[p(a)]"),
    Script(
      name: "a row under a table with as many columns joins it", start: document(twoColumns, paragraph()),
      commands: [caretUnderTable] + typing("|e|f| "), expected: "table[p(a)|p(b)/p(c)|p(d)/p(e)|p(f)]"),
    Script(
      name: "a row joining a table takes its header row's alignment",
      start: document(LexicalJSON.table([["a", "b"]]), paragraph(), paragraph()),
      commands: [caretUnderTable] + typing("|:---|---:| ") + [caretUnderTable] + typing("|e|f| "),
      expected: "table[p(a)*<|p(b)*>/p(e)<|p(f)>]"),
    Script(
      name: "a row under a table with other columns makes a table of its own",
      start: document(twoColumns, paragraph()), commands: [caretUnderTable] + typing("|e| "),
      expected: "table[p(a)|p(b)/p(c)|p(d)] table[p(e)]"),
    Script(
      name: "a divider under a table makes its last row a header, aligned as it says",
      start: document(twoColumns, paragraph()), commands: [caretUnderTable] + typing("|:---:|--- | "),
      expected: "table[p(a)|p(b)/p(c)*^|p(d)*]", caret: .text([0, 1, 1, 0, 0], 1)),
    Script(
      name: "a divider with no table above takes away what was typed", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("|---| "), expected: "p()"),
    Script(
      name: "a row typed in a heading makes a table in its place", start: document(heading("h2")),
      commands: [caretInEmptyParagraph] + typing("|a| "), expected: "table[p(a)]"),
    Script(
      name: "a row typed in a cell stays as typed", start: document(twoColumns),
      commands: [.caret(.text([0, 0, 0, 0, 0], 1))] + typing("|x| "), expected: "table[p(a|x| )|p(b)/p(c)|p(d)]"),
    Script(
      name: "a row typed in an empty cell stays as typed",
      start: document(LexicalJSON.table([["", "b"]])),
      commands: [.caret(Point(path: [0, 0, 0, 0], offset: 0, type: .element))] + typing("|x| "),
      expected: "table[p(|x| )|p(b)]"),
    Script(
      name: "Enter doesn't finish a row", start: emptyParagraph, commands: row("|a|").dropLast() + [.insertParagraph],
      expected: "p(|a|) p()"),
    Script(
      name: "undo after a row gives back what was typed", start: emptyParagraph,
      commands: [caretInEmptyParagraph] + typing("|a| ") + [.undo], expected: "p(|a| )"),
    Script(
      name: "an escaped pipe is a pipe in a cell", start: emptyParagraph, commands: row(#"|a\|b|c|"#),
      expected: "table[p(a|b)|p(c)]"),
    Script(
      name: "a character reference past Unicode's end fails the update, as JavaScript throws",
      start: emptyParagraph, commands: row("|&#99999999;|"), expected: "p(|&#99999999;| )"),
    Script(
      name: "a link to a character past Unicode's end fails the update too",
      start: emptyParagraph, commands: row("|[a](&#99999999;)|"), expected: "p(|[a](&#99999999;)| )"),
  ]

  /// What a cell imports, typed as a row of its own.
  static let cells: [Script] = [
    ("formats", "**b** _i_ `c` ~~s~~ ==h==", "table[p(b{1} i{2} c{16} s{4} h{128})]"),
    ("\\n breaks the line, and blocks follow it", #"a\nb  \nc\n# d\n> e\n> f\n---\ng"#,
     "table[p(a⏎b⏎  c),h1(d),q(e⏎f),hr,p(g)]"),
    ("empty lines go", #"a\n\n \nb"#, "table[p(a),p(b)]"),
    ("a lone empty cell keeps its paragraph", "   ", "table[p()]"),
    ("a line ending in a backslash breaks hard", #"a\\nb"#, "table[p(a⏎\\b)]"),
    ("a tab is a tab node", "a\tb", "table[p(a⇥b)]"),
    ("an escape is taken out", ##"\*a\* \# b"##, "table[p(*a* # b)]"),
    ("a character reference is its character", "&#65;&#128077;", "table[p(A👍)]"),
    ("a lone surrogate is a replacement character", "&#55357;", "table[p(\u{FFFD})]"),
    ("an article tag stays text", "<article x>", "table[p(<article x>)]"),
    ("a placeholder stays text, whatever it holds", "<!-- lexidraw:poll#1 ![a](b) -->", "table[p(<!-- lexidraw:poll#1 ![a](b) -->)]"),
    ("a divider inside a cell stays text", #"\|---\|"#, "table[p(|---|)]"),
    ("a row inside a cell stays text", #"\|a\|"#, "table[p(|a|)]"),
    ("lines of a list make one list", #"- a\n- b"#, "table[ul[li(a),li(b)]]"),
    ("items with other markers make one list, keeping the last marker", #"* a\n+ b"#, "table[ul[li(a),li(b)]+]"),
    ("a numbered list starts where it says", #"3. a\n4. b"#, "table[ol3[li(a),li(b)]]"),
    ("a checklist is checked as it says", #"- [ ] a\n- [x] b"#, "table[cl[li(a),li(b)✓]]"),
    ("an item indented under another nests in it", #"1. a\n   - b"#, "table[ol1[li(a),li(ul[li(b)])]]"),
    ("a line under an item joins it", #"- a\nb"#, "table[ul[li(a⏎b)]]"),
    ("an empty line between items keeps them in one list", #"- a\n\n- b"#, "table[ul[li(a),li(b)]]"),
    ("an item's text imports its formats", #"- **a**"#, "table[ul[li(a{1})]]"),
    ("an equation fence that isn't closed is text", "$$", "table[p($$)]"),
    ("an admonition that isn't closed is text", ":::note", "table[p(:::note)]"),
    ("an admonition closed inside a fence isn't closed", #":::note\n~~~\n:::"#, "table[p(:::note⏎~~~⏎:::)]"),
    ("details that aren't closed are text", "<details>", "table[p(<details>)]"),
    ("columns that aren't closed are text", "<columns>", "table[p(<columns>)]"),
    ("columns with nothing in them are text", #"<columns>\n</columns>"#, "table[p(<columns>⏎</columns>)]"),
    ("a link is a link", "x [a](b) y", "table[p(x [a](b) y)]"),
    ("a link's text imports its formats", "[**a** c](b)", "table[p([a{1} c](b))]"),
    ("a link takes a title, and its URL loses its escapes", #"[a](<b\>c> "t")"#, #"table[p([a](b>c "t"))]"#),
    ("a bracket before a link stays outside it", "[[a](b)", "table[p([[a](b))]"),
    ("a link in a link's text stays text", "[[a](b) c](d)", "table[p([[a](b) c](d))]"),
    ("a link in code stays code", "`[a](b)`", "table[p([a](b){16})]"),
  ].map { name, markdown, expected in
    Script(name: name, start: emptyParagraph, commands: row("|\(markdown)|"), expected: expected)
  }

  /// CommonMark's delimiter runs, as @lexical/markdown's import reads them.
  static let emphasis: [Script] = [
    ("_ inside a word stays", "a_b_c", "table[p(a_b_c)]"),
    ("* inside a word formats", "a*b*c", "table[p(ab{2}c)]"),
    ("*** is bold and italic", "***a***", "table[p(a{3})]"),
    ("*** closed by ** leaves a *", "***a**", "table[p(*a{1})]"),
    ("** closed by * leaves a *", "**a*", "table[p(*a{2})]"),
    ("an unclosed run stays", "**a", "table[p(**a)]"),
    ("an escaped * opens nothing", #"\*a* b"#, "table[p(*a* b)]"),
    ("an escaped * closes nothing", #"*a\* b"#, "table[p(*a* b)]"),
    ("an escaped backslash leaves the * a delimiter", #"\\*a*"#, "table[p(\\a{2})]"),
    ("emphasis nests", "*a **b** c*", "table[p(a {2}b{3} c{2})]"),
    ("= alone isn't highlight", "=a=", "table[p(=a=)]"),
    ("code wins over emphasis", "`**a**`", "table[p(**a**{16})]"),
    ("emphasis around code formats the code too", "**`a`**", "table[p(a{17})]"),
    ("a space before the closer stays", "*a *", "table[p(*a *)]"),
    ("rule of three", "*a**b*", "table[p(a**b{2})]"),
    ("a backslash after a delimiter isn't punctuation, so the * opens", #"**a*\**"#, "table[p(**a*{2})]"),
  ].map { name, markdown, expected in
    Script(name: name, start: emptyParagraph, commands: row("|\(markdown)|"), expected: expected)
  }

  @Test(arguments: rows + cells + emphasis)
  func lexicalSwiftDoesWhatLexicalDoes(_ script: Script) throws {
    let fixture = try Fixture.record(start: script.start, commands: script.commands, on: try Support.referenceEditor())

    #expect(Self.shape(fixture.expected.state) == script.expected)
    if let caret = script.caret { #expect(fixture.expected.selection?.anchor == caret) }
    #expect(try fixture.replay(on: Editor()) == fixture.recorded)
  }

  /// Rows of random cells, typed and checked against Lexical, one for every
  /// ten of FUZZ_STEPS from FUZZ_SEED. The first row that disagrees is
  /// written as a fixture to commit.
  @Test func randomCellsImportAsLexicalImportsThem() throws {
    let count = (Support.environment("FUZZ_STEPS").flatMap(Int.init) ?? 2_000) / 10
    let seed = Support.environment("FUZZ_SEED").flatMap(UInt64.init) ?? UInt64.random(in: 0...UInt64.max)
    let reference = try Support.referenceEditor()
    var rows = MarkdownRows(seed: seed)
    var declined = 0
    for _ in 0..<count {
      let row = rows.next()
      let fixture = try Fixture.record(start: Self.emptyParagraph, commands: Self.row(row), on: reference)
      let editor = Editor()
      let outcome = try fixture.replay(on: editor)
      if editor.shortcutsDeclinedAsNotPorted > 0 {
        declined += 1
      } else if outcome != fixture.recorded {
        let url = try fixture.write(into: Support.fixturesSource)
        Issue.record("Seed \(seed): \(row) diverged; fixture written to \(url.path)")
        return
      }
    }
    print("Seed \(seed): \(count - declined) rows agreed, \(declined) declined as not ported yet")
  }

  /// A hard break a cell imported keeps its marker in the line break, and a
  /// document holding one opens to edit.
  @Test(arguments: [#"a\\nb"#, #"a  \nb"#])
  func aDocumentWithAHardBreakMarkerEdits(_ markdown: String) throws {
    let reference = try Support.referenceEditor()
    try reference.load(Self.emptyParagraph)
    for command in Self.row("|\(markdown)|") { try reference.apply(command) }
    let imported = try reference.snapshot().state
    let typing: [EditorCommand] = [.caret(.text([0, 0, 0, 0, 2], 0)), .insertText("x")]
    let fixture = try Fixture.record(start: imported, commands: typing, on: reference)
    let editor = Editor()

    try editor.load(imported)
    #expect(editor.isEditable)
    #expect(try fixture.replay(on: editor) == fixture.recorded)
  }

  /// Markdown in a cell that a transformer LexicalSwift doesn't port yet
  /// imports as something else, and the row stays as typed instead.
  static let notPortedYet: [Script] = [
    "```", "``` a", "$x$", "$$x$$", "![a](b)", ":smile:", "[^a]", "[^a]: b",
    #"<tweet id="1" />"#, "> [!note]", #"$$\nx\n$$"#, #":::note\na\n:::"#, "<details></details>",
    #"<details>\na\n</details>"#, #"<columns>\na\n</columns>"#,
  ].map { markdown in
    Script(name: markdown, start: emptyParagraph, commands: row("|\(markdown)|"), expected: "p(|\(markdown)| )")
  }

  @Test(arguments: notPortedYet)
  func aCellNotPortedYetKeepsTheRowAsTyped(_ script: Script) throws {
    let fixture = try Fixture.record(start: script.start, commands: script.commands, on: try Support.referenceEditor())
    let outcome = try fixture.replay(on: Editor())

    #expect(Self.shape(fixture.expected.state) != script.expected)
    #expect(outcome.changes.allSatisfy { if case .applied = $0 { true } else { false } })
    #expect(Self.shape(outcome.snapshot.state) == script.expected)
  }

  /// A short form of a document's blocks: `p(…)` a paragraph, `h1(…)` a
  /// heading, `q(…)` a quote, `hr` a rule, `ul[…]`, `ol[…]` and `cl[…]` a
  /// list of `li(…)` items, with a numbered list's start after its tag, a
  /// kept marker after it and `✓` after a checked item, and `table[…]` a
  /// table whose rows `/` and cells `|` part, each cell its blocks with `*`
  /// after a header and `<`, `^` or `>` after an alignment. Text shows its
  /// format in braces, `⏎` a line break followed by any hard break marker,
  /// `⇥` a tab.
  static func shape(_ state: JSONValue) -> String {
    (state["root"]?["children"]?.arrayValue ?? []).map(block).joined(separator: " ")
  }

  private static func block(_ node: JSONValue) -> String {
    let children = node["children"]?.arrayValue ?? []
    switch node["type"]?.stringValue {
    case "paragraph": return "p(\(children.map(inline).joined()))"
    case "heading": return "\(node["tag"]?.stringValue ?? "")(\(children.map(inline).joined()))"
    case "quote": return "q(\(children.map(inline).joined()))"
    case "horizontalrule": return "hr"
    case "list":
      let kind = ["bullet": "ul", "number": "ol", "check": "cl"][node["listType"]?.stringValue ?? ""] ?? "?"
      let start = kind == "ol" ? "\(node["start"]?.intValue ?? 1)" : ""
      let marker = node["$"]?["mdListMarker"]?.stringValue ?? ""
      return "\(kind)\(start)[\(children.map(block).joined(separator: ","))]\(marker)"
    case "listitem":
      let checked = node["checked"]?.boolValue == true ? "✓" : ""
      return "li(\(children.map { $0["type"] == "list" ? block($0) : inline($0) }.joined()))\(checked)"
    case "table":
      let rows = children.map { row in
        (row["children"]?.arrayValue ?? []).map { cell in
          let header = (cell["headerState"]?.intValue ?? 0) != 0 ? "*" : ""
          let alignment = ["left": "<", "center": "^", "right": ">"][cell["format"]?.stringValue ?? ""] ?? ""
          return (cell["children"]?.arrayValue ?? []).map(block).joined(separator: ",") + header + alignment
        }.joined(separator: "|")
      }
      return "table[\(rows.joined(separator: "/"))]"
    case let type: return type ?? "?"
    }
  }

  private static func inline(_ node: JSONValue) -> String {
    switch node["type"]?.stringValue {
    case "text":
      let format = node["format"]?.intValue ?? 0
      return (node["text"]?.stringValue ?? "") + (format == 0 ? "" : "{\(format)}")
    case "linebreak": return "⏎" + (node["$"]?["mdHardLineBreak"]?.stringValue ?? "")
    case "tab": return "⇥"
    case "link":
      let title = node["title"]?.stringValue.map { #" "\#($0)""# } ?? ""
      return "[\((node["children"]?.arrayValue ?? []).map(inline).joined())](\(node["url"]?.stringValue ?? "")\(title))"
    case let type: return "<\(type ?? "?")>"
    }
  }
}
