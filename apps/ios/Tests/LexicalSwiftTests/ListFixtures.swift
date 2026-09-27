import Foundation
import LexicalFuzz
import LexicalSwift
import Testing

/// The scripts behind the list, checklist, indent, Tab and Enter fixtures in
/// Fixtures/, which `FixtureReplayTests` holds LexicalSwift and the reference
/// to. They are recorded from the reference with
/// `RECORD_FIXTURES=1 swift test --filter ListFixtures`.
@Suite struct ListFixtures {
  typealias Script = (name: String, start: JSONValue, commands: [EditorCommand])

  static let scripts: [Script] = [
    (
      "a-bullet-list-takes-in-the-paragraph-the-caret-is-in",
      document(paragraph(text("one")), paragraph(text("two"))),
      [.caret(.text([0, 0], 1)), .insertList(.bullet)]
    ),
    (
      "a-numbered-list-takes-in-every-selected-paragraph",
      document(paragraph(text("a")), paragraph(text("b")), paragraph(text("c"))),
      [.setSelection(anchor: .text([0, 0], 0), focus: .text([1, 0], 1)), .insertList(.number)]
    ),
    (
      "an-empty-paragraph-becomes-a-checklist-to-type-in",
      document(paragraph()),
      [.caret(Point(path: [0], offset: 0, type: .element)), .insertList(.check), .insertText("x")]
    ),
    (
      "inserting-another-type-of-list-changes-the-whole-list",
      document(list(.bullet, [.item([text("a")]), .item([text("b")])])),
      [.caret(.text([0, 1, 0], 1)), .insertList(.number)]
    ),
    (
      "a-new-list-item-joins-a-list-of-its-type-beside-it",
      document(list(.bullet, [.item([text("a")])]), paragraph(text("b")), list(.bullet, [.item([text("c")])])),
      [.caret(.text([1, 0], 0)), .insertList(.bullet)]
    ),
    (
      "removing-a-list-leaves-paragraphs-indented-as-the-items-were",
      document(
        list(.bullet, [.item([text("a")]), .nested(.bullet, [.item([text("b")])]), .item([text("c")])])),
      [.caret(.text([0, 1, 0, 0, 0], 1)), .removeList]
    ),
    (
      "indenting-an-item-nests-it-under-the-item-before",
      document(list(.number, [.item([text("a")]), .item([text("b")]), .item([text("c")])])),
      [.caret(.text([0, 1, 0], 0)), .indent, .indent, .outdent]
    ),
    (
      "outdenting-an-item-in-the-middle-splits-its-list",
      document(
        list(
          .bullet,
          [.item([text("a")]), .nested(.bullet, [.item([text("b")]), .item([text("c")]), .item([text("d")])])])),
      [.caret(.text([0, 1, 0, 1, 0], 0)), .outdent]
    ),
    (
      "indenting-stops-at-six-levels-of-list",
      document(
        list(
          .bullet,
          [
            .item([text("1")]),
            .nested(
              .bullet,
              [
                .item([text("2")]),
                .nested(
                  .bullet,
                  [
                    .item([text("3")]),
                    .nested(
                      .bullet,
                      [
                        .item([text("4")]),
                        .nested(
                          .bullet, [.item([text("5")]), .nested(.bullet, [.item([text("6")]), .item([text("7")])])]),
                      ]),
                  ]),
              ]),
          ])),
      [.caret(.text([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], 0)), .indent]
    ),
    (
      "enter-in-an-item-splits-it",
      document(list(.number, [.item([text("ab")]), .item([text("c")])])),
      [.caret(.text([0, 0, 0], 1)), .insertParagraph]
    ),
    (
      "enter-in-an-empty-item-leaves-the-list",
      document(list(.number, [.item([text("a")]), .item([]), .item([text("c")])])),
      [.caret(Point(path: [0, 1], offset: 0, type: .element)), .insertParagraph]
    ),
    (
      "enter-in-an-empty-nested-item-outdents-it",
      document(list(.bullet, [.item([text("a")]), .nested(.bullet, [.item([])])])),
      [.caret(Point(path: [0, 1, 0, 0], offset: 0, type: .element)), .insertParagraph]
    ),
    (
      "enter-after-a-checked-item-starts-an-unchecked-one",
      document(list(.check, [.item([text("done")], checked: true)])),
      [.caret(.text([0, 0, 0], 4)), .insertParagraph, .insertText("next")]
    ),
    (
      "backspace-at-the-start-of-an-item-makes-it-a-paragraph",
      document(list(.bullet, [.item([text("a")]), .item([text("b")]), .item([text("c")])])),
      [.caret(.text([0, 1, 0], 0)), .deleteCharacter(backward: true)]
    ),
    (
      "backspace-at-the-start-of-a-nested-item-outdents-it",
      document(list(.bullet, [.item([text("a")]), .nested(.bullet, [.item([text("b")])])])),
      [.caret(.text([0, 1, 0, 0, 0], 0)), .deleteCharacter(backward: true)]
    ),
    (
      "backspace-at-the-start-of-an-indented-paragraph-outdents-it",
      document(paragraph([text("a")], indent: 2)),
      [.caret(.text([0, 0], 0)), .deleteCharacter(backward: true)]
    ),
    (
      "forward-delete-at-the-end-of-an-item-joins-the-next",
      document(list(.bullet, [.item([text("a")]), .item([text("b")])])),
      [.caret(.text([0, 0, 0], 1)), .deleteCharacter(backward: false)]
    ),
    (
      "a-tap-on-a-box-checks-and-unchecks-its-item",
      document(list(.check, [.item([text("a")]), .item([text("b")])])),
      [.caret(.text([0, 0, 0], 1)), .toggleChecked(path: [0, 1]), .toggleChecked(path: [0, 0]),
       .toggleChecked(path: [0, 1])]
    ),
    (
      "tab-at-the-start-of-an-item-indents-it-and-shift-tab-outdents-it",
      document(list(.bullet, [.item([text("a")]), .item([text("b")])])),
      [.caret(.text([0, 1, 0], 0)), .tab(backward: false), .tab(backward: true)]
    ),
    (
      "tab-inside-text-inserts-a-tab",
      document(paragraph(text("ab"))),
      [.caret(.text([0, 0], 1)), .tab(backward: false), .insertText("x")]
    ),
    (
      "tab-over-selected-paragraphs-indents-them",
      document(paragraph(text("a")), paragraph(text("b"))),
      [.setSelection(anchor: .text([0, 0], 0), focus: .text([1, 0], 1)), .tab(backward: false), .indent,
       .tab(backward: true)]
    ),
    (
      "enter-leaves-behind-a-case-format-the-caret-would-type-in",
      document(paragraph(text("a"))),
      [.caret(.text([0, 0], 1)), .formatText(.uppercase), .formatText(.bold), .insertParagraph, .insertText("b")]
    ),
    (
      "a-list-comes-and-goes-with-undo-and-redo",
      document(paragraph(text("a"))),
      [.caret(.text([0, 0], 1)), .insertList(.check), .undo, .redo]
    ),
    (
      "an-empty-item-takes-the-format-typed-into-it",
      document(list(.bullet, [.item([text("a")])])),
      [.caret(.text([0, 0, 0], 1)), .insertParagraph, .formatText(.bold), .insertText("b")]
    ),
    (
      "a-checklist-item-made-a-paragraph-keeps-its-text",
      document(list(.check, [.item([text("a", format: .italic)], checked: true), .item([text("b")])])),
      [.caret(.text([0, 0, 0], 0)), .setBlockType(.paragraph)]
    ),
    (
      "an-item-in-the-middle-made-a-quote-splits-its-list",
      document(list(.number, [.item([text("a")]), .item([text("b")]), .item([text("c")])])),
      [.caret(.text([0, 1, 0], 1)), .setBlockType(.quote)]
    ),
    (
      "a-nested-item-made-a-heading-keeps-how-deep-it-was",
      document(list(.bullet, [.item([text("a")]), .nested(.bullet, [.item([text("b")])]), .item([text("c")])])),
      [.caret(.text([0, 1, 0, 0, 0], 1)), .setBlockType(.h2)]
    ),
    (
      "a-selection-across-items-makes-each-a-heading",
      document(list(.bullet, [.item([text("a")]), .item([text("b")])]), paragraph(text("c"))),
      [.setSelection(anchor: .text([0, 0, 0], 0), focus: .text([1, 0], 1)), .setBlockType(.h1)]
    ),
    (
      "a-list-item-outside-a-list-loads-into-one",
      document(paragraph(text("a")), LexicalJSON.element("listitem", [text("b")], ["value": 1])),
      []
    ),
  ]

  @Test(.enabled(if: Support.environment("RECORD_FIXTURES") != nil))
  func record() throws {
    let reference = try Support.referenceEditor()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    for script in Self.scripts {
      let fixture = try Fixture.record(start: script.start, commands: script.commands, on: reference)
      let data = try encoder.encode(fixture) + Data("\n".utf8)
      try data.write(to: Support.fixturesSource.appending(path: "\(script.name).json"))
    }
  }
}

func list(_ listType: ListType, _ entries: [LexicalJSON.ListEntry], start: Int = 1, marker: String? = nil) -> JSONValue {
  LexicalJSON.list(listType, entries, start: start, marker: marker)
}

func paragraph(_ children: [JSONValue], indent: Int) -> JSONValue {
  LexicalJSON.paragraph(children, indent: indent)
}
