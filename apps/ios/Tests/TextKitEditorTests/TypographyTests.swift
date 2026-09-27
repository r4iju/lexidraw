#if canImport(UIKit)
import EditorModelInterface
import LexicalFuzz
import LexicalSwift
import Testing
@testable import TextKitEditor
import UIKit

/// Blocks set and spaced as the web's stylesheet sets them, an em being
/// the body text's size, seen through where UIKit is told carets are.
@MainActor @Suite struct TypographyTests {
  static let em = UIFont.preferredFont(forTextStyle: .body).pointSize

  /// document.css's sizes and lines, in ems, at a phone's width.
  nonisolated static let (h1Size, wideH1Size, h2Size) = (1.625, 1.875, 1.5)
  nonisolated static let (paragraphLine, h1Line, wideH1Line, h2Line) = (1.6, 1.25 * h1Size, 1.25 * wideH1Size, 1.3 * h2Size)

  static func caret(_ view: EditorView, before text: String) throws -> CGRect {
    let offset = (try LayoutTests.text(of: view) as NSString).range(of: text).location
    return view.caretRect(for: try #require(view.position(from: view.beginningOfDocument, offset: offset)))
  }

  static func expectNear(_ actual: CGFloat, _ expected: CGFloat, _ what: String, within: CGFloat = 1) {
    #expect(abs(actual - expected) < within, "\(what): \(actual), not \(expected)")
  }

  /// Blocks are spaced as the web spaces them, a heading right after
  /// another with half its space before.
  @Test func blocksAreSpacedAsTheWebSpacesThem() throws {
    let view = try LayoutTests.host(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("para")]),
        LexicalJSON.heading("h1", [LexicalJSON.text("One")]),
        LexicalJSON.heading("h2", [LexicalJSON.text("Two")]),
        LexicalJSON.quote([LexicalJSON.text("Quote")]),
        LexicalJSON.paragraph([LexicalJSON.text("end")]),
      ]))
    let (paragraph, one, two, quote, end) = (
      try Self.caret(view, before: "para"), try Self.caret(view, before: "One"), try Self.caret(view, before: "Two"),
      try Self.caret(view, before: "Quote"), try Self.caret(view, before: "end")
    )

    Self.expectNear(paragraph.midY, Self.paragraphLine / 2 * Self.em, "the first block has no space before it")
    Self.expectNear(
      one.midY - paragraph.midY, (Self.paragraphLine / 2 + 1.6 * Self.h1Size + Self.h1Line / 2) * Self.em,
      "a paragraph to a heading")
    Self.expectNear(
      two.midY - one.midY, (Self.h1Line / 2 + 1.6 * Self.h2Size / 2 + Self.h2Line / 2) * Self.em,
      "a heading to the heading after it")
    Self.expectNear(
      quote.midY - two.midY, (Self.h2Line / 2 + 0.4 * Self.h2Size + Self.paragraphLine / 2) * Self.em,
      "a heading to a quote")
    Self.expectNear(end.midY - quote.midY, (Self.paragraphLine + 0.75) * Self.em, "a quote to a paragraph")
    Self.expectNear(quote.minX, 3 + Self.em, "a quote's text")
    Self.expectNear(paragraph.minX, 0, "a paragraph's text")
    try LayoutTests.expectEveryCaretToLandOnItself(view)
  }

  /// A caret is as tall as the text it is in, in the middle of its line,
  /// as a browser draws one.
  @Test func aCaretIsAsTallAsItsText() throws {
    let view = try LayoutTests.host(
      LexicalJSON.document([
        LexicalJSON.heading("h1", [LexicalJSON.text("One")]),
        LexicalJSON.paragraph([LexicalJSON.text("para")]),
      ]))
    let heading = UIFont.systemFont(ofSize: Self.h1Size * Self.em, weight: .semibold)

    Self.expectNear(try Self.caret(view, before: "One").height, heading.lineHeight, "in a heading")
    Self.expectNear(
      try Self.caret(view, before: "para").height, UIFont.preferredFont(forTextStyle: .body).lineHeight, "in a paragraph")
  }

  /// The web sets top-level headings smaller in a view no wider than a
  /// phone's.
  @Test(arguments: [(390, h1Size, h1Line), (820, wideH1Size, wideH1Line)])
  func aTopLevelHeadingIsSmallerOnANarrowView(_ width: CGFloat, _ size: Double, _ line: Double) throws {
    let view = try LayoutTests.host(
      LexicalJSON.document([
        LexicalJSON.heading("h1", [LexicalJSON.text("One")]),
        LexicalJSON.paragraph([LexicalJSON.text("para")]),
      ]), width: width)
    let one = try Self.caret(view, before: "One")

    Self.expectNear(one.midY, line / 2 * Self.em, "a heading \(width) wide, first, with no space before it")
    Self.expectNear(
      try Self.caret(view, before: "para").midY - one.midY, (line / 2 + 0.4 * size + Self.paragraphLine / 2) * Self.em,
      "from a heading \(width) wide to a paragraph")
  }

  /// A rule is a line with room around it, the caret before it or after it.
  @Test func aRuleIsALineWithRoomAroundIt() throws {
    let view = try LayoutTests.host(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("above")]),
        LexicalJSON.horizontalRule,
        LexicalJSON.paragraph([LexicalJSON.text("below")]),
      ]))
    Self.expectNear(
      try Self.caret(view, before: "below").midY - Self.caret(view, before: "above").midY,
      (Self.paragraphLine + 2 * 2) * Self.em + 1, "across a rule")
    let offset = "above\n".utf16.count
    let before = view.caretRect(for: try #require(view.position(from: view.beginningOfDocument, offset: offset)))
    let after = view.caretRect(for: try #require(view.position(from: view.beginningOfDocument, offset: offset + 1)))
    Self.expectNear(before.minX, 0, "the caret before a rule")
    Self.expectNear(after.minX, view.textInputView.bounds.width, "the caret after a rule")
    try LayoutTests.expectEveryCaretToLandOnItself(view)
  }

  /// Making a block a heading moves it by the space a heading has before
  /// it.
  @Test func aBlockMadeAHeadingTakesAHeadingsSpace() throws {
    let view = try LayoutTests.host(
      LexicalJSON.document([
        LexicalJSON.paragraph([LexicalJSON.text("para")]),
        LexicalJSON.paragraph([LexicalJSON.text("Two")]),
      ]))
    #expect(view.becomeFirstResponder())
    let caret = try #require(view.position(from: view.beginningOfDocument, offset: "para\nT".utf16.count))
    view.selectedTextRange = view.textRange(from: caret, to: caret)

    view.setBlockType(.h2)
    view.layoutIfNeeded()

    Self.expectNear(
      try Self.caret(view, before: "Two").midY - Self.caret(view, before: "para").midY,
      (Self.paragraphLine / 2 + 1.6 * Self.h2Size + Self.h2Line / 2) * Self.em, "a paragraph to the heading after it")
    try LayoutTests.expectEveryCaretToLandOnItself(view)
  }

  /// The web sets a document in Japanese or Chinese in taller lines and
  /// wider letters; a heading keeps its own line height, and its own
  /// letter spacing where it sets one.
  @Test(arguments: [("ja-JP", 1.8, 0.02), ("zh", 1.8, 0.02), ("en", 1.6, 0), (nil, 1.6, 0)])
  func aDocumentsLanguageSetsItsText(_ language: String?, _ lineHeight: Double, _ letterSpacing: Double) {
    let typesetting = Typesetting(.web)
    typesetting.language = language
    let (paragraph, h1, h3) = (
      typesetting.attributes(.text(.paragraph), []), typesetting.attributes(.text(.h1), []),
      typesetting.attributes(.text(.h3), [])
    )

    Self.expectNear((paragraph[.paragraphStyle] as? NSParagraphStyle)?.minimumLineHeight ?? 0, lineHeight * Self.em, "a line")
    Self.expectNear(paragraph[.kern] as? CGFloat ?? 0, letterSpacing * Self.em, "a paragraph's letters", within: 0.001)
    Self.expectNear((h3[.paragraphStyle] as? NSParagraphStyle)?.minimumLineHeight ?? 0, 1.4 * 1.25 * Self.em, "an h3's line")
    Self.expectNear(h3[.kern] as? CGFloat ?? 0, letterSpacing * Self.em, "an h3's letters", within: 0.001)
    Self.expectNear(h1[.kern] as? CGFloat ?? 0, -0.015 * Self.h1Size * Self.em, "a narrow h1's letters", within: 0.001)
  }
}
#endif
