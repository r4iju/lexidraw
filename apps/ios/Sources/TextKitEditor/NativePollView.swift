#if canImport(UIKit)
import EditorModelInterface
import UIKit

@MainActor final class NativePollView: EmbeddedContentView {
  private let stack = UIStackView()
  private let editable: Bool
  private let userID: String?
  private let changed: ((JSONValue) throws -> Void)?
  private let editOption: ((String, String) -> Void)?
  private let failed: ((any Error) -> Void)?
  private var node: JSONValue

  init(_ node: JSONValue, userID: String? = nil, editable: Bool = false,
    changed: ((JSONValue) throws -> Void)? = nil, editOption: ((String, String) -> Void)? = nil,
    failed: ((any Error) -> Void)? = nil)
  {
    self.node = node; self.userID = userID; self.editable = editable
    self.changed = changed; self.editOption = editOption; self.failed = failed
    super.init(frame: .zero)
    backgroundColor = .secondarySystemBackground
    layer.cornerRadius = 12
    stack.axis = .vertical; stack.spacing = 8
    addSubview(stack)
    show(node)
  }
  required init?(coder: NSCoder) { nil }

  override func show(_ node: JSONValue) {
    self.node = node
    for view in stack.arrangedSubviews { stack.removeArrangedSubview(view); view.removeFromSuperview() }
    guard node["question"]?.stringValue != nil, let storedOptions = node["options"]?.arrayValue,
      storedOptions.allSatisfy({ $0["uid"]?.stringValue != nil && $0["text"]?.stringValue != nil && $0["votes"]?.arrayValue?.allSatisfy({ $0.stringValue != nil }) == true }) else {
      let unavailable = UILabel(); unavailable.text = "Poll data unavailable (#134)"; unavailable.numberOfLines = 0
      stack.addArrangedSubview(unavailable); return
    }
    let question = UILabel(); question.text = node["question"]?.stringValue
    question.font = .preferredFont(forTextStyle: .headline); question.numberOfLines = 0
    stack.addArrangedSubview(question)
    let options = node["options"]?.arrayValue ?? []
    let total = options.reduce(0) { $0 + ($1["votes"]?.arrayValue?.count ?? 0) }
    for (index, option) in options.enumerated() {
      let uid = option["uid"]?.stringValue ?? ""
      let text = option["text"]?.stringValue ?? ""
      let votes = option["votes"]?.arrayValue ?? []
      let row = UIStackView(); row.axis = .vertical; row.spacing = 4
      let title = UILabel(); title.text = text.isEmpty ? "Option \(index + 1)" : text
      title.font = .preferredFont(forTextStyle: .body); title.numberOfLines = 0
      row.addArrangedSubview(title)
      let result = UILabel()
      let percentage = total == 0 ? 0 : Int((Double(votes.count) / Double(total) * 100).rounded())
      result.text = "\(votes.count) \(votes.count == 1 ? "vote" : "votes") · \(percentage)%"
      result.font = .preferredFont(forTextStyle: .caption1)
      row.addArrangedSubview(result)
      if editable {
        let controls = UIStackView(); controls.spacing = 8
        let selected = userID.map { votes.contains(.string($0)) } ?? false
        let vote = button(selected ? "Remove vote" : "Vote", id: "poll-vote-\(uid)") { [weak self] in self?.toggleVote(uid) }
        vote.isEnabled = userID != nil; vote.accessibilityLabel = "\(selected ? "Remove vote for" : "Vote for") \(text)"
        controls.addArrangedSubview(vote)
        controls.addArrangedSubview(button("Edit", id: "poll-edit-\(uid)") { [weak self] in self?.editOption?(uid, text) })
        let remove = button("Remove", id: "poll-remove-\(uid)") { [weak self] in self?.removeOption(uid) }
        remove.isEnabled = options.count > WebPollStyle.minimumOptions
        controls.addArrangedSubview(remove)
        row.addArrangedSubview(controls)
      }
      stack.addArrangedSubview(row)
    }
    if editable {
      if userID == nil {
        let unavailable = UILabel(); unavailable.text = "Voting unavailable: account identity is unavailable."; unavailable.numberOfLines = 0
        unavailable.font = .preferredFont(forTextStyle: .caption1); stack.addArrangedSubview(unavailable)
      }
      stack.addArrangedSubview(button("Add option", id: "poll-add-option") { [weak self] in self?.addOption() })
    }
  }

  override func contentSize(fitting width: CGFloat) -> CGSize {
    let width = min(width, WebPollStyle.maximumWidth)
    let inner = max(1, width - 24)
    let fitting = stack.systemLayoutSizeFitting(CGSize(width: inner, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
    return CGSize(width: width, height: fitting.height + 24)
  }
  override func layoutSubviews() { super.layoutSubviews(); stack.frame = bounds.insetBy(dx: 12, dy: 12) }

  private func button(_ title: String, id: String, action: @escaping () -> Void) -> UIButton {
    let button = UIButton(type: .system); button.setTitle(title, for: .normal); button.accessibilityIdentifier = id
    button.addAction(UIAction { _ in action() }, for: .touchUpInside)
    return button
  }
  private func commit(_ options: [JSONValue]) {
    guard var fields = node.objectValue else { return }
    fields["options"] = .array(options)
    do { try changed?(.object(fields)) } catch { failed?(error) }
  }
  private func toggleVote(_ uid: String) {
    guard let userID, var options = node["options"]?.arrayValue,
      let index = options.firstIndex(where: { $0["uid"] == .string(uid) }), var option = options[index].objectValue else { return }
    var votes = option["votes"]?.arrayValue ?? []
    if let index = votes.firstIndex(of: .string(userID)) { votes.remove(at: index) } else { votes.append(.string(userID)) }
    option["votes"] = .array(votes); options[index] = .object(option)
    commit(options)
  }
  private func addOption() {
    var options = node["options"]?.arrayValue ?? []
    guard var option = try? JSONValue(parsing: WebPollStyle.emptyOptionJSON).objectValue else {
      preconditionFailure("Generated poll option is invalid")
    }
    option["uid"] = .string(UUID().uuidString)
    options.append(.object(option))
    commit(options)
  }
  private func removeOption(_ uid: String) {
    guard var options = node["options"]?.arrayValue, options.count > WebPollStyle.minimumOptions,
      let index = options.firstIndex(where: { $0["uid"] == .string(uid) }) else { return }
    options.remove(at: index); commit(options)
  }
}
#endif
