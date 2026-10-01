#if canImport(UIKit)
import UIKit
import EditorModelInterface

@MainActor final class CommentComposerController: UIViewController, UITextViewDelegate {
  private let text = UITextView()
  private let submit: (String) -> Bool
  private var save: UIBarButtonItem!

  init(title: String, submit: @escaping (String) -> Bool) {
    self.submit = submit
    super.init(nibName: nil, bundle: nil)
    self.title = title
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    text.font = .preferredFont(forTextStyle: .body)
    text.adjustsFontForContentSizeCategory = true
    text.delegate = self
    text.accessibilityLabel = "Comment"
    text.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(text)
    NSLayoutConstraint.activate([
      text.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 12),
      text.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
      text.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
      text.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -12)
    ])
    navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
    save = UIBarButtonItem(title: "Comment", primaryAction: UIAction { [weak self] _ in
      guard let self, self.submit(self.text.text) else { return }
      self.dismiss(animated: true)
    })
    save.isEnabled = false
    navigationItem.rightBarButtonItem = save
  }
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    text.becomeFirstResponder()
  }
  func textViewDidChange(_ textView: UITextView) {
    save.isEnabled = JSRegExp(#"^\s*$"#, flags: "").firstMatch(in: textView.text) == nil
  }
}
#endif
