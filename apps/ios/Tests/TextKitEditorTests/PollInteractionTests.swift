#if canImport(UIKit)
import LexicalSwift
import Testing
@testable import TextKitEditor
import UIKit

@MainActor @Suite struct PollInteractionTests {
  @Test func insertedPollUsesWebDefaultsAndRejectsEmptyQuestion() throws {
    let model = Editor()
    try model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": []]]]])
    try model.apply(.caret(Point(path: [0], offset: 0, type: .element)))
    let view = EditorView(model: model)
    #expect(!view.insertPoll(question: " \t"))
    #expect(view.insertPoll(question: "Choose"))
    let poll = try model.node(at: [0, 0])
    #expect(poll["type"] == "poll")
    #expect(poll["question"] == "Choose")
    let options = try #require(poll["options"]?.arrayValue)
    #expect(options.count == 2)
    #expect(options.allSatisfy { $0["text"] == "" && $0["votes"] == [] })
    #expect(Set(options.compactMap { $0["uid"]?.stringValue }).count == 2)
  }

  @Test func votingUpdatesOnlyTheSelectedOptionAndSchedulesAutosave() throws {
    let model = Editor()
    let poll: JSONValue = ["type": "poll", "version": 1, "question": "Choose", "options": [
      ["text": "Pen", "uid": "pen", "votes": ["someone"]], ["text": "Pencil", "uid": "pencil", "votes": []],
    ]]
    try model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": [poll]]]]])
    let view = EditorView(model: model)
    view.configureSocialNodes(userID: "reader", author: "Reader")
    var saved = 0
    view.onChange = { saved += 1 }
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
    view.frame = window.bounds
    window.addSubview(view); window.makeKeyAndVisible(); view.layoutIfNeeded()
    func voteButton(_ parent: UIView) -> UIButton? {
      if let button = parent as? UIButton, button.accessibilityIdentifier == "poll-vote-pencil" { return button }
      return parent.subviews.lazy.compactMap(voteButton).first
    }
    let button = try #require(voteButton(view))
    button.sendActions(for: .touchUpInside)
    let options = try #require(model.node(at: [0, 0])["options"]?.arrayValue)
    #expect(options[0]["votes"] == ["someone"])
    #expect(options[1]["votes"] == ["reader"])
    #expect(saved == 1)
    try model.apply(.undo)
    #expect(try model.node(at: [0, 0])["options"]?.arrayValue?[1]["votes"] == [])
  }

  private func poll(_ options: [JSONValue]) -> JSONValue {
    ["type": "poll", "version": 1, "question": "Choose", "options": .array(options)]
  }
  private func option(_ text: String, votes: [JSONValue] = []) -> JSONValue {
    ["text": .string(text), "uid": .string(text.lowercased()), "votes": .array(votes)]
  }
  /// What the poll shows in words: its labels and its buttons' titles.
  private func texts(in view: UIView) -> [String] {
    [(view as? UILabel)?.text, (view as? UIButton)?.currentTitle].compactMap { $0 }
      + view.subviews.flatMap { texts(in: $0) }
  }
  private func laidOut(_ view: NativePollView) -> NativePollView {
    view.frame.size = view.contentSize(fitting: 390)
    view.layoutIfNeeded()
    return view
  }

  @Test func eachOptionShowsItsShareAsABarAndNoTextButtons() throws {
    let view = laidOut(NativePollView(
      poll([option("Pen", votes: ["a", "b"]), option("Pencil", votes: ["reader"])]), userID: "reader", editable: true))
    let shown = texts(in: view)
    #expect(shown.contains("2 votes · 67%"))
    #expect(shown.contains("1 vote · 33%"))
    #expect(shown.contains("3 votes total"))
    #expect(!shown.contains { ["Vote", "Remove vote", "Edit", "Remove"].contains($0) })
    func bars(_ view: UIView) -> [UIProgressView] {
      ((view as? UIProgressView).map { [$0] } ?? []) + view.subviews.flatMap(bars)
    }
    #expect(bars(view).map(\.progress) == [Float(2) / 3, Float(1) / 3])
  }

  @Test func aPollWithoutVotesSaysSoAndAnEmptyOneSaysItHasNoOptions() throws {
    let unvoted = texts(in: laidOut(NativePollView(poll([option("Pen"), option("Pencil")]))))
    #expect(unvoted.contains("No votes yet"))
    #expect(!unvoted.contains { $0.contains("0 votes") })
    let empty = texts(in: laidOut(NativePollView(poll([]), userID: "reader", editable: true)))
    #expect(empty.contains("No options yet"))
    #expect(empty.contains("Add option"))
  }

  @Test func anOptionIsRemovedThroughItsActionsAboveTheMinimum() throws {
    var saved: JSONValue?
    let view = laidOut(NativePollView(
      poll([option("Pen"), option("Pencil"), option("Brush")]), userID: "reader", editable: true,
      changed: { saved = $0 }))
    func actions(_ view: UIView) -> [UIAccessibilityCustomAction] {
      (view.accessibilityCustomActions ?? []) + view.subviews.flatMap(actions)
    }
    let remove = try #require(actions(view).first { $0.name == "Remove Pencil" })
    #expect(remove.actionHandler?(remove) == true)
    #expect(saved?["options"]?.arrayValue?.compactMap { $0["text"]?.stringValue } == ["Pen", "Brush"])
    let minimal = laidOut(NativePollView(poll([option("Pen"), option("Pencil")]), userID: "reader", editable: true))
    #expect(!actions(minimal).contains { $0.name.hasPrefix("Remove") })
  }
}
#endif
