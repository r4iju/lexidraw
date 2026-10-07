#if canImport(UIKit)
import EditorModelInterface
import UIKit

/// The web's poll card: a question, each option with its share as a bar and
/// "N votes · P%", and a footer with the total and a quiet "Add option".
/// Editing an option's text and removing it are in the option's menu
/// (long press) and its accessibility actions, not buttons on every row.
@MainActor final class NativePollView: EmbeddedContentView {
  private let stack = UIStackView()
  private let editable: Bool
  private let userID: String?
  private let changed: ((JSONValue) throws -> Void)?
  private let editOption: ((String, String) -> Void)?
  private let failed: ((any Error) -> Void)?
  private var node: JSONValue
  /// The web card's `px-4 pt-3 pb-2`.
  private let padding = UIEdgeInsets(top: 12, left: 16, bottom: 8, right: 16)

  init(_ node: JSONValue, userID: String? = nil, editable: Bool = false,
    changed: ((JSONValue) throws -> Void)? = nil, editOption: ((String, String) -> Void)? = nil,
    failed: ((any Error) -> Void)? = nil)
  {
    self.node = node; self.userID = userID; self.editable = editable
    self.changed = changed; self.editOption = editOption; self.failed = failed
    super.init(frame: .zero)
    backgroundColor = ThemeColor.card.color
    layer.cornerRadius = 8
    layer.borderWidth = 1
    drawBorder()
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: NativePollView, _: UITraitCollection) in
      view.drawBorder()
    }
    stack.axis = .vertical; stack.spacing = 0
    addSubview(stack)
    show(node)
  }
  required init?(coder: NSCoder) { nil }

  /// A layer's border takes a colour for one appearance.
  private func drawBorder() {
    layer.borderColor = ThemeColor.border.color.resolvedColor(with: traitCollection).cgColor
  }

  override func show(_ node: JSONValue) {
    self.node = node
    for view in stack.arrangedSubviews { stack.removeArrangedSubview(view); view.removeFromSuperview() }
    guard node["question"]?.stringValue != nil, let storedOptions = node["options"]?.arrayValue,
      storedOptions.allSatisfy({ $0["uid"]?.stringValue != nil && $0["text"]?.stringValue != nil && $0["votes"]?.arrayValue?.allSatisfy({ $0.stringValue != nil }) == true }) else {
      let unavailable = label("Poll data unavailable (#134)", style: .body, color: .foreground)
      stack.addArrangedSubview(unavailable); return
    }
    let question = label(node["question"]?.stringValue ?? "", style: .body, color: .foreground)
    question.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 17, weight: .semibold))
    stack.addArrangedSubview(question)
    stack.setCustomSpacing(4, after: question)
    let options = storedOptions
    let total = options.reduce(0) { $0 + ($1["votes"]?.arrayValue?.count ?? 0) }
    if options.isEmpty {
      stack.addArrangedSubview(padded(label("No options yet", style: .subheadline, color: .mutedForeground)))
    }
    for (index, option) in options.enumerated() {
      stack.addArrangedSubview(row(option, index: index, total: total, removable: options.count > WebPollStyle.minimumOptions))
    }
    if editable && userID == nil {
      stack.addArrangedSubview(padded(label("Voting unavailable: account identity is unavailable.", style: .caption1, color: .mutedForeground)))
    }
    let footer = UIStackView(); footer.alignment = .center; footer.spacing = 12
    if !options.isEmpty {
      let summary = label(total == 0 ? "No votes yet" : "\(total) \(total == 1 ? "vote" : "votes") total", style: .subheadline, color: .mutedForeground)
      summary.numberOfLines = 1
      summary.setContentHuggingPriority(.required, for: .horizontal)
      footer.addArrangedSubview(summary)
    }
    let spacer = UIView()
    spacer.setContentHuggingPriority(.defaultLow - 1, for: .horizontal)
    footer.addArrangedSubview(spacer)
    if editable {
      let add = UIButton(type: .system)
      add.setTitle("Add option", for: .normal)
      add.setImage(UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(textStyle: .subheadline)), for: .normal)
      add.titleLabel?.font = .preferredFont(forTextStyle: .subheadline)
      add.titleLabel?.adjustsFontForContentSizeCategory = true
      add.tintColor = ThemeColor.mutedForeground.color
      add.accessibilityIdentifier = "poll-add-option"
      add.setContentHuggingPriority(.required, for: .horizontal)
      add.addAction(UIAction { [weak self] _ in self?.addOption() }, for: .touchUpInside)
      footer.addArrangedSubview(add)
    }
    footer.heightAnchor.constraint(greaterThanOrEqualToConstant: 32).isActive = true
    stack.addArrangedSubview(footer)
  }

  override func contentSize(fitting width: CGFloat) -> CGSize {
    let width = min(width, WebPollStyle.maximumWidth)
    let inner = max(1, width - padding.left - padding.right)
    let fitting = stack.systemLayoutSizeFitting(CGSize(width: inner, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
    return CGSize(width: width, height: fitting.height + padding.top + padding.bottom)
  }
  override func layoutSubviews() { super.layoutSubviews(); stack.frame = bounds.inset(by: padding) }

  /// One option as the web lays it out: the vote box, the wrapping label with
  /// its count at the end, and the bar of its share under them.
  private func row(_ option: JSONValue, index: Int, total: Int, removable: Bool) -> UIView {
    let uid = option["uid"]?.stringValue ?? ""
    let text = option["text"]?.stringValue ?? ""
    let votes = option["votes"]?.arrayValue ?? []
    let name = text.isEmpty ? "Option \(index + 1)" : text
    let checked = userID.map { votes.contains(.string($0)) } ?? false
    let percentage = total == 0 ? 0 : Int((Double(votes.count) / Double(total) * 100).rounded())

    let title = label(name, style: .body, color: text.isEmpty ? .mutedForeground : .foreground)
    title.setContentHuggingPriority(.defaultLow, for: .horizontal)
    title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    let line = UIStackView(arrangedSubviews: [title]); line.alignment = .firstBaseline; line.spacing = 12
    if total > 0 {
      let count = label("\(votes.count) \(votes.count == 1 ? "vote" : "votes") · \(percentage)%", style: .subheadline, color: .mutedForeground)
      count.numberOfLines = 1
      count.font = count.font.withMonospacedDigits
      count.setContentHuggingPriority(.required, for: .horizontal)
      count.setContentCompressionResistancePriority(.required, for: .horizontal)
      line.addArrangedSubview(count)
    }
    let bar = UIProgressView(progressViewStyle: .bar)
    bar.progress = total == 0 ? 0 : Float(votes.count) / Float(total)
    bar.trackTintColor = ThemeColor.muted.color
    bar.progressTintColor = ThemeColor.foreground.opacity(checked ? 0.8 : 0.35).color
    bar.layer.cornerRadius = 3; bar.clipsToBounds = true
    bar.heightAnchor.constraint(equalToConstant: 6).isActive = true
    bar.accessibilityLabel = name
    let body = UIStackView(arrangedSubviews: [line, bar]); body.axis = .vertical; body.spacing = 6

    let content = OptionRow(arrangedSubviews: [body]); content.alignment = .top; content.spacing = 12
    content.isLayoutMarginsRelativeArrangement = true
    content.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0)
    guard editable else { return content }

    let vote = UIButton(type: .custom)
    let symbol = UIImage.SymbolConfiguration(pointSize: 20, weight: .regular)
    vote.setImage(UIImage(systemName: checked ? "checkmark.square.fill" : "square", withConfiguration: symbol), for: .normal)
    vote.tintColor = checked ? ThemeColor.foreground.color : ThemeColor.mutedForeground.color
    vote.isEnabled = userID != nil
    vote.isSelected = checked
    vote.accessibilityIdentifier = "poll-vote-\(uid)"
    vote.accessibilityLabel = "\(checked ? "Remove vote for" : "Vote for") \(name)"
    vote.addAction(UIAction { [weak self] _ in self?.toggleVote(uid) }, for: .touchUpInside)
    vote.widthAnchor.constraint(equalToConstant: 24).isActive = true
    vote.heightAnchor.constraint(equalToConstant: 24).isActive = true
    content.insertArrangedSubview(vote, at: 0)

    let edit = UIAction(title: "Edit option", image: UIImage(systemName: "pencil")) { [weak self] _ in self?.editOption?(uid, text) }
    let remove = UIAction(title: "Remove option", image: UIImage(systemName: "xmark"), attributes: .destructive) { [weak self] _ in self?.removeOption(uid) }
    content.menu = UIMenu(title: name, children: removable ? [edit, remove] : [edit])
    title.isUserInteractionEnabled = true
    title.addGestureRecognizer(UITapGestureRecognizer(target: content, action: #selector(OptionRow.tapped)))
    content.onTap = { [weak self] in self?.editOption?(uid, text) }
    title.accessibilityTraits = .button
    title.accessibilityHint = "Edits the option"
    var actions = [UIAccessibilityCustomAction(name: "Edit \(name)") { [weak self] _ in self?.editOption?(uid, text); return true }]
    if removable {
      actions.append(UIAccessibilityCustomAction(name: "Remove \(name)") { [weak self] _ in self?.removeOption(uid); return true })
    }
    title.accessibilityCustomActions = actions
    return content
  }

  private func label(_ text: String, style: UIFont.TextStyle, color: ThemeColor) -> UILabel {
    let label = UILabel()
    label.text = text; label.numberOfLines = 0
    label.font = .preferredFont(forTextStyle: style); label.adjustsFontForContentSizeCategory = true
    label.textColor = color.color
    return label
  }
  /// A line of muted text with the room of an option row around it.
  private func padded(_ view: UIView) -> UIView {
    let wrapper = UIStackView(arrangedSubviews: [view])
    wrapper.isLayoutMarginsRelativeArrangement = true
    wrapper.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0)
    return wrapper
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

/// An option's row: a tap on its label edits it, and a long press opens its menu.
@MainActor private final class OptionRow: UIStackView, UIContextMenuInteractionDelegate {
  var menu: UIMenu? {
    didSet { if menu != nil, interactions.isEmpty { addInteraction(UIContextMenuInteraction(delegate: self)) } }
  }
  var onTap: (() -> Void)?

  @objc func tapped() { onTap?() }

  func contextMenuInteraction(_ interaction: UIContextMenuInteraction,
    configurationForMenuAtLocation location: CGPoint) -> UIContextMenuConfiguration?
  {
    guard let menu else { return nil }
    return UIContextMenuConfiguration(actionProvider: { _ in menu })
  }
}

private extension UIFont {
  /// The face with tabular figures, as the web's `tabular-nums`.
  var withMonospacedDigits: UIFont {
    let descriptor = fontDescriptor.addingAttributes([.featureSettings: [[
      UIFontDescriptor.FeatureKey.type: kNumberSpacingType, .selector: kMonospacedNumbersSelector,
    ]]])
    return UIFont(descriptor: descriptor, size: 0)
  }
}
#endif
