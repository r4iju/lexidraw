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
}
#endif
