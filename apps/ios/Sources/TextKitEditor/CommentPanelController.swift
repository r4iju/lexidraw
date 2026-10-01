#if canImport(UIKit)
import UIKit
import LexidrawJSON

@MainActor final class CommentPanelController: UITableViewController {
  private let onClose: () -> Void
  private let show: (String) -> Void
  private let entries: () -> [JSONValue]
  private let editable: () -> Bool
  private let reply: (String) -> Void
  private let resolve: (String, Bool) -> Void
  private let removeReply: (String, String) -> Void
  private let remove: (String) -> Void
  private var items: [JSONValue] = []
  private var showsResolved = false

  init(onClose: @escaping () -> Void, show: @escaping (String) -> Void, entries: @escaping () -> [JSONValue], editable: @escaping () -> Bool,
       reply: @escaping (String) -> Void, resolve: @escaping (String, Bool) -> Void,
       removeReply: @escaping (String, String) -> Void, remove: @escaping (String) -> Void) {
    self.onClose = onClose; self.show = show
    self.entries = entries; self.editable = editable; self.reply = reply
    self.resolve = resolve; self.removeReply = removeReply; self.remove = remove
    super.init(style: .insetGrouped)
    title = "Comments"
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  override func viewDidLoad() {
    super.viewDidLoad()
    navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
    navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Resolved", primaryAction: UIAction { [weak self] _ in
      guard let self else { return }; self.showsResolved.toggle(); self.reload()
    })
    reload()
  }
  override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); reload() }
  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isBeingDismissed || navigationController?.isBeingDismissed == true { onClose() }
  }
  override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
    tableView.deselectRow(at: indexPath, animated: true)
    guard let id = items[indexPath.row]["id"]?.stringValue else { return }
    show(id)
    dismiss(animated: true)
  }
  func reload() {
    items = entries().filter { ($0["resolved"] == .bool(true)) == showsResolved }
    tableView.reloadData()
    navigationItem.leftBarButtonItem?.title = showsResolved ? "Active" : "Resolved"
  }
  override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { items.count }
  override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
    let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
    let item = items[indexPath.row]
    var configuration = cell.defaultContentConfiguration()
    configuration.text = item["quote"]?.stringValue ?? item["author"]?.stringValue ?? "Comment"
    configuration.textProperties.numberOfLines = 0
    let comments = item["comments"]?.arrayValue ?? [item]
    configuration.secondaryText = comments.map { comment in
      let author = comment["author"]?.stringValue ?? ""
      let content = comment["content"]?.stringValue ?? ""
      let time = comment["timeStamp"]?.numberValue.map {
        RelativeDateTimeFormatter().localizedString(for: Date(timeIntervalSince1970: $0 / 1000), relativeTo: Date())
      } ?? ""
      return (author.isEmpty ? content : author + ": " + content) + (time.isEmpty ? "" : "\n" + time)
    }.joined(separator: "\n\n")
    configuration.secondaryTextProperties.numberOfLines = 0
    cell.contentConfiguration = configuration
    cell.accessoryType = editable() ? .detailButton : .none
    return cell
  }
  override func tableView(_ tableView: UITableView, accessoryButtonTappedForRowWith indexPath: IndexPath) {
    guard editable(), let id = items[indexPath.row]["id"]?.stringValue else { return }
    let item = items[indexPath.row]
    let actions = UIAlertController(title: "Comment", message: nil, preferredStyle: .actionSheet)
    if item["type"] == "thread" {
      let resolved = item["resolved"] == .bool(true)
      if !resolved { actions.addAction(UIAlertAction(title: "Reply", style: .default) { [weak self] _ in self?.reply(id) }) }
      actions.addAction(UIAlertAction(title: resolved ? "Reopen" : "Resolve", style: .default) { [weak self] _ in
        self?.resolve(id, !resolved); self?.reload()
      })
    }
    for comment in item["comments"]?.arrayValue ?? [] where comment["deleted"] != .bool(true) {
      guard let commentID = comment["id"]?.stringValue else { continue }
      let excerpt = String((comment["content"]?.stringValue ?? "Reply").prefix(40))
      actions.addAction(UIAlertAction(title: "Delete reply: " + excerpt, style: .destructive) { [weak self] _ in
        guard let self else { return }
        let confirm = UIAlertController(title: "Delete reply?", message: nil, preferredStyle: .alert)
        confirm.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        confirm.addAction(UIAlertAction(title: "Delete", style: .destructive) { [weak self] _ in
          self?.removeReply(id, commentID); self?.reload()
        })
        self.present(confirm, animated: true)
      })
    }
    actions.addAction(UIAlertAction(title: "Delete", style: .destructive) { [weak self] _ in
      guard let self else { return }
      let confirm = UIAlertController(title: "Delete comment?", message: "This removes the comment and its text annotation.", preferredStyle: .alert)
      confirm.addAction(UIAlertAction(title: "Cancel", style: .cancel))
      confirm.addAction(UIAlertAction(title: "Delete", style: .destructive) { [weak self] _ in self?.remove(id); self?.reload() })
      self.present(confirm, animated: true)
    })
    actions.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    actions.popoverPresentationController?.sourceView = tableView.cellForRow(at: indexPath)
    actions.popoverPresentationController?.sourceRect = tableView.cellForRow(at: indexPath)?.bounds ?? .zero
    present(actions, animated: true)
  }
}
#endif
