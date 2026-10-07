#if canImport(UIKit)
import EditorModelInterface
import UIKit

/// The web's poll card: a question, each option with its share as a bar and
/// "N votes · P%", and a footer with the total and a quiet "Add option".
/// Editing an option's text and removing it are in the option's menu
/// (long press) and its accessibility actions, not buttons on every row.
///
/// The card lays itself out with frames from one function, so the height it
/// asks for is the height it draws in.
@MainActor final class NativePollView: EmbeddedContentView {
  private let editable: Bool
  private let userID: String?
  private let changed: ((JSONValue) throws -> Void)?
  private let editOption: ((String, String) -> Void)?
  private let failed: ((any Error) -> Void)?
  private var node: JSONValue
  private var lines: [Line] = []
  /// The web card's `px-4 pt-3 pb-2`.
  private let padding = UIEdgeInsets(top: 12, left: 16, bottom: 8, right: 16)

  /// A line of the card, top to bottom.
  private enum Line {
    case question(UILabel)
    case note(UILabel)
    case option(OptionRow)
    case footer(summary: UILabel?, add: UIButton?)
  }

  init(_ node: JSONValue, userID: String? = nil, editable: Bool = false,
    changed: ((JSONValue) throws -> Void)? = nil, editOption: ((String, String) -> Void)? = nil,
    failed: ((any Error) -> Void)? = nil)
  {
    self.node = node; self.userID = userID; self.editable = editable
    self.changed = changed; self.editOption = editOption; self.failed = failed
    super.init(frame: .zero)
    backgroundColor = WebPollStyle.background.color
    layer.cornerRadius = 8
    layer.borderWidth = 1
    drawBorder()
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: NativePollView, _: UITraitCollection) in
      view.drawBorder()
    }
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (view: NativePollView, _: UITraitCollection) in
      view.setNeedsLayout()
    }
    show(node)
  }
  required init?(coder: NSCoder) { nil }

  /// A layer's border takes a colour for one appearance.
  private func drawBorder() {
    layer.borderColor = ThemeColor.border.color.resolvedColor(with: traitCollection).cgColor
  }

  override func show(_ node: JSONValue) {
    self.node = node
    subviews.forEach { $0.removeFromSuperview() }
    lines = []
    defer { lines.forEach(add); setNeedsLayout() }
    guard node["question"]?.stringValue != nil, let options = node["options"]?.arrayValue,
      options.allSatisfy({ $0["uid"]?.stringValue != nil && $0["text"]?.stringValue != nil && $0["votes"]?.arrayValue?.allSatisfy({ $0.stringValue != nil }) == true }) else {
      lines = [.note(label("Poll data unavailable (#134)", style: .body, color: .foreground))]
      return
    }
    let question = label(node["question"]?.stringValue ?? "", style: .body, color: .foreground)
    question.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 17, weight: .semibold))
    lines.append(.question(question))
    let total = options.reduce(0) { $0 + ($1["votes"]?.arrayValue?.count ?? 0) }
    if options.isEmpty {
      lines.append(.note(label("No options yet", style: .subheadline, color: .mutedForeground)))
    }
    for (index, option) in options.enumerated() {
      lines.append(.option(row(option, index: index, total: total, removable: options.count > WebPollStyle.minimumOptions)))
    }
    if editable && userID == nil {
      lines.append(.note(label("Voting unavailable: account identity is unavailable.", style: .caption1, color: .mutedForeground)))
    }
    let summary = options.isEmpty ? nil
      : label(total == 0 ? "No votes yet" : "\(total) \(total == 1 ? "vote" : "votes") total", style: .subheadline, color: .mutedForeground)
    var add: UIButton?
    if editable {
      let button = UIButton(type: .system)
      button.setTitle("Add option", for: .normal)
      button.setImage(UIImage(systemName: "plus", withConfiguration: UIImage.SymbolConfiguration(textStyle: .subheadline)), for: .normal)
      button.titleLabel?.font = .preferredFont(forTextStyle: .subheadline)
      button.titleLabel?.adjustsFontForContentSizeCategory = true
      button.tintColor = ThemeColor.mutedForeground.color
      button.accessibilityIdentifier = "poll-add-option"
      button.addAction(UIAction { [weak self] _ in self?.addOption() }, for: .touchUpInside)
      add = button
    }
    if summary != nil || add != nil { lines.append(.footer(summary: summary, add: add)) }
  }

  private func add(_ line: Line) {
    switch line {
    case .question(let label), .note(let label): addSubview(label)
    case .option(let row): addSubview(row)
    case .footer(let summary, let add): [summary, add].compactMap { $0 }.forEach(addSubview)
    }
  }

  override func contentSize(fitting width: CGFloat) -> CGSize {
    let width = min(width, WebPollStyle.maximumWidth)
    return CGSize(width: width, height: arrange(width: width))
  }
  override func layoutSubviews() { super.layoutSubviews(); _ = arrange(width: bounds.width) }

  /// Places every line for a card `width` wide and returns the card's height.
  private func arrange(width: CGFloat) -> CGFloat {
    let inner = max(1, width - padding.left - padding.right)
    var y = padding.top
    for line in lines {
      switch line {
      case .question(let label):
        let height = measure(label, inner)
        label.frame = CGRect(x: padding.left, y: y, width: inner, height: height)
        y += height + 4
      case .note(let label):
        let height = measure(label, inner)
        label.frame = CGRect(x: padding.left, y: y + 6, width: inner, height: height)
        y += height + 12
      case .option(let row):
        let height = row.arrange(width: inner)
        row.frame = CGRect(x: padding.left, y: y, width: inner, height: height)
        y += height
      case .footer(let summary, let add):
        let summarySize = summary.map { CGSize(width: min(inner, ceil($0.sizeThatFits(.zero).width)), height: measure($0, inner)) } ?? .zero
        let addSize = add.map { $0.sizeThatFits(CGSize(width: inner, height: .greatestFiniteMagnitude)) } ?? .zero
        let height = max(32, summarySize.height, ceil(addSize.height))
        summary?.frame = CGRect(x: padding.left, y: y + (height - summarySize.height) / 2, width: summarySize.width, height: summarySize.height)
        add?.frame = CGRect(x: padding.left + inner - ceil(addSize.width), y: y + (height - ceil(addSize.height)) / 2,
          width: ceil(addSize.width), height: ceil(addSize.height))
        y += height
      }
    }
    return ceil(y + padding.bottom)
  }

  /// One option as the web lays it out: the vote box, the wrapping label with
  /// its count at the end, and the bar of its share under them.
  private func row(_ option: JSONValue, index: Int, total: Int, removable: Bool) -> OptionRow {
    let uid = option["uid"]?.stringValue ?? ""
    let text = option["text"]?.stringValue ?? ""
    let votes = option["votes"]?.arrayValue ?? []
    let name = text.isEmpty ? "Option \(index + 1)" : text
    let checked = userID.map { votes.contains(.string($0)) } ?? false
    let percentage = total == 0 ? 0 : Int((Double(votes.count) / Double(total) * 100).rounded())

    let title = label(name, style: .body, color: text.isEmpty ? .mutedForeground : .foreground)
    var count: UILabel?
    if total > 0 {
      let shown = label("\(votes.count) \(votes.count == 1 ? "vote" : "votes") · \(percentage)%", style: .subheadline, color: .mutedForeground)
      shown.numberOfLines = 1
      shown.font = shown.font.withMonospacedDigits
      count = shown
    }
    let bar = ShareBar(progressViewStyle: .bar)
    bar.progress = total == 0 ? 0 : Float(votes.count) / Float(total)
    bar.trackTintColor = ThemeColor.muted.color
    bar.progressTintColor = ThemeColor.foreground.opacity(checked ? 0.8 : 0.35).color
    bar.layer.cornerRadius = 3; bar.clipsToBounds = true
    bar.accessibilityLabel = name

    var vote: UIButton?
    if editable {
      let button = UIButton(type: .custom)
      let symbol = UIImage.SymbolConfiguration(pointSize: 20, weight: .regular)
      button.setImage(UIImage(systemName: checked ? "checkmark.square.fill" : "square", withConfiguration: symbol), for: .normal)
      button.tintColor = checked ? ThemeColor.foreground.color : ThemeColor.mutedForeground.color
      button.isEnabled = userID != nil
      button.isSelected = checked
      button.accessibilityIdentifier = "poll-vote-\(uid)"
      button.accessibilityLabel = "\(checked ? "Remove vote for" : "Vote for") \(name)"
      button.addAction(UIAction { [weak self] _ in self?.toggleVote(uid) }, for: .touchUpInside)
      vote = button
    }
    let row = OptionRow(vote: vote, title: title, count: count, bar: bar)
    guard editable else { return row }

    let edit = UIAction(title: "Edit option", image: UIImage(systemName: "pencil")) { [weak self] _ in self?.editOption?(uid, text) }
    let remove = UIAction(title: "Remove option", image: UIImage(systemName: "xmark"), attributes: .destructive) { [weak self] _ in self?.removeOption(uid) }
    row.menu = UIMenu(title: name, children: removable ? [edit, remove] : [edit])
    title.isUserInteractionEnabled = true
    title.addGestureRecognizer(UITapGestureRecognizer(target: row, action: #selector(OptionRow.tapped)))
    row.onTap = { [weak self] in self?.editOption?(uid, text) }
    title.accessibilityTraits = .button
    title.accessibilityHint = "Edits the option"
    var actions = [UIAccessibilityCustomAction(name: "Edit \(name)") { [weak self] _ in self?.editOption?(uid, text); return true }]
    if removable {
      actions.append(UIAccessibilityCustomAction(name: "Remove \(name)") { [weak self] _ in self?.removeOption(uid); return true })
    }
    title.accessibilityCustomActions = actions
    return row
  }

  private func label(_ text: String, style: UIFont.TextStyle, color: ThemeColor) -> UILabel {
    let label = UILabel()
    label.text = text; label.numberOfLines = 0
    label.font = .preferredFont(forTextStyle: style); label.adjustsFontForContentSizeCategory = true
    label.textColor = color.color
    return label
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

/// An option's share, as thick as the web's `h-1.5` bar; a plain progress view
/// keeps its own thinner height when given a frame.
private final class ShareBar: UIProgressView {
  override var intrinsicContentSize: CGSize { CGSize(width: UIView.noIntrinsicMetric, height: 6) }
  override func sizeThatFits(_ size: CGSize) -> CGSize { CGSize(width: size.width, height: 6) }
}

/// The height `label` needs at `width`, rounded up to whole points.
@MainActor private func measure(_ label: UILabel, _ width: CGFloat) -> CGFloat {
  ceil(label.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
}

/// An option's row: the vote box, the label with its count, and the bar under
/// them. A tap on its label edits it, and a long press opens its menu.
@MainActor private final class OptionRow: UIView, UIContextMenuInteractionDelegate {
  let vote: UIButton?
  let title: UILabel
  let count: UILabel?
  let bar: UIProgressView
  var menu: UIMenu? {
    didSet { if menu != nil, interactions.isEmpty { addInteraction(UIContextMenuInteraction(delegate: self)) } }
  }
  var onTap: (() -> Void)?

  init(vote: UIButton?, title: UILabel, count: UILabel?, bar: UIProgressView) {
    (self.vote, self.title, self.count, self.bar) = (vote, title, count, bar)
    super.init(frame: .zero)
    [vote, title, count, bar].compactMap { $0 }.forEach(addSubview)
  }
  required init?(coder: NSCoder) { nil }

  /// Places the row's parts for `width` and returns its height: the web's
  /// `py-1.5`, the label line, a 6pt gap, and the 6pt bar.
  func arrange(width: CGFloat) -> CGFloat {
    let top: CGFloat = 6
    let box: CGFloat = 24
    let start = vote == nil ? 0 : box + 12
    let body = max(1, width - start)
    let countSize = count.map { CGSize(width: ceil($0.sizeThatFits(.zero).width), height: measure($0, .greatestFiniteMagnitude)) } ?? .zero
    let titleWidth = max(1, body - (count == nil ? 0 : countSize.width + 12))
    let titleHeight = measure(title, titleWidth)
    title.frame = CGRect(x: start, y: top, width: titleWidth, height: titleHeight)
    if let count {
      // On the label's first baseline, as the web's `items-start` with `pt-px` reads.
      let baseline = (title.font.ascender - count.font.ascender).rounded()
      count.frame = CGRect(x: width - countSize.width, y: top + max(0, baseline), width: countSize.width, height: countSize.height)
    }
    let line = max(titleHeight, count.map { $0.frame.maxY - top } ?? 0)
    vote?.frame = CGRect(x: 0, y: top + max(0, (title.font.lineHeight - box) / 2), width: box, height: box)
    bar.frame = CGRect(x: start, y: top + line + 6, width: body, height: 6)
    return bar.frame.maxY + top
  }

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
