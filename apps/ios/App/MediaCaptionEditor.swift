import EditorModelInterface
import LexidrawJSON
import TextKitEditor
import UIKit

@MainActor func configureMediaCaptions(_ view: EditorView) {
  let previous = view.onEmbeddedTap
  view.onEmbeddedTap = { [weak view] key, node in
    if previous?(key, node) == true { return true }
    guard let view, view.isEditable,
      let type = node["type"]?.stringValue,
      ["image", "inline-image", "video"].contains(type),
      let presenter = mediaPresenter(view) else { return false }
    let options = UIAlertController(title: type == "video" ? "Video" : "Image", message: nil, preferredStyle: .actionSheet)
    let edit = UIAlertAction(title: "Edit caption", style: .default) { [weak view, weak presenter] _ in
      guard let view, let presenter else { return }
      do {
        if node["showCaption"] != true, var fields = node.objectValue {
          fields["showCaption"] = true
          try view.replaceEmbeddedNode(key: key, expected: node, replacement: .object(fields))
        }
        let panel = try MediaCaptionEditor(owner: view, key: key)
        presenter.present(UINavigationController(rootViewController: panel), animated: true)
      } catch { mediaError(error, presenter) }
    }
    edit.isEnabled = type != "video"
    options.addAction(edit)
    let visibility = UIAlertAction(title: node["showCaption"] == true ? "Hide caption" : "Show caption", style: .default) { [weak view, weak presenter] _ in
      guard let view, let presenter, var fields = node.objectValue else { return }
      fields["showCaption"] = .bool(node["showCaption"] != true)
      do { try view.replaceEmbeddedNode(key: key, expected: node, replacement: .object(fields)) }
      catch { mediaError(error, presenter) }
    }
    visibility.isEnabled = type != "video" || node["captionsEnabled"] == true
    options.addAction(visibility)
    if let src = node["src"]?.stringValue, let url = URL(string: src),
      ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
      options.addAction(UIAlertAction(title: "Open original", style: .default) { _ in UIApplication.shared.open(url) })
    }
    options.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    options.popoverPresentationController?.sourceView = view
    options.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
    presenter.present(options, animated: true)
    return true
  }
}

@MainActor private final class MediaCaptionEditor: UIViewController {
  private let editor: EditorView

  init(owner: EditorView, key: String) throws {
    editor = try owner.makeCaptionEditor(key: key)
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("MediaCaptionEditor is made in code") }

  override func loadView() { view = NativeEditorHost(editor: editor) }
  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Edit caption"
    navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak self] _ in
      self?.editor.resignFirstResponder()
      self?.dismiss(animated: true)
    })
  }
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    if editor.isEditable { editor.becomeFirstResponder() }
  }
}

@MainActor private func mediaPresenter(_ view: UIView) -> UIViewController? {
  var responder: UIResponder? = view
  while let next = responder?.next {
    if let controller = next as? UIViewController { return controller }
    responder = next
  }
  return nil
}
@MainActor private func mediaError(_ error: Error, _ presenter: UIViewController) {
  let alert = UIAlertController(title: "Caption could not be changed", message: error.localizedDescription, preferredStyle: .alert)
  alert.addAction(UIAlertAction(title: "OK", style: .default))
  presenter.present(alert, animated: true)
}
