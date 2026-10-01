#if canImport(UIKit)
import EditorModelInterface
import UIKit

@MainActor final class NativeInlineImageOptions: UIViewController {
  private var node: JSONObject
  private let inserted: (JSONValue) -> Void
  private let alternative = UITextField()
  private let position = UISegmentedControl(items: MediaInsertions.inlinePositions.map(\.1))
  private let caption = UISwitch()

  init(node: JSONValue, inserted: @escaping (JSONValue) -> Void) {
    self.node = node.objectValue!
    self.inserted = inserted
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func viewDidLoad() {
    super.viewDidLoad()
    title = "Inline image"
    view.backgroundColor = .systemBackground
    alternative.borderStyle = .roundedRect
    alternative.accessibilityLabel = "Alternative text"
    alternative.placeholder = "Alternative text"
    alternative.text = node["altText"]?.stringValue
    position.selectedSegmentIndex = MediaInsertions.inlinePositions.firstIndex { $0.0 == node["position"]?.stringValue } ?? UISegmentedControl.noSegment
    position.accessibilityLabel = "Image position"
    caption.isOn = node["showCaption"]?.boolValue ?? false
    caption.accessibilityLabel = "Show caption"
    let label = UILabel()
    label.text = "Show caption"
    let captionRow = UIStackView(arrangedSubviews: [label, caption])
    captionRow.axis = .horizontal
    captionRow.distribution = .equalSpacing
    let stack = UIStackView(arrangedSubviews: [alternative, position, captionRow])
    stack.axis = .vertical
    stack.spacing = 20
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
      stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
    ])
    navigationItem.leftBarButtonItem = UIBarButtonItem(title: "Cancel", primaryAction: UIAction { [weak self] _ in self?.dismiss(animated: true) })
    navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Insert image", primaryAction: UIAction { [weak self] _ in self?.insert() })
  }

  private func insert() {
    node["altText"] = .string(alternative.text ?? "")
    node["showCaption"] = .bool(caption.isOn)
    if MediaInsertions.inlinePositions.indices.contains(position.selectedSegmentIndex) {
      node["position"] = .string(MediaInsertions.inlinePositions[position.selectedSegmentIndex].0)
    }
    let payload = JSONValue.object(node)
    dismiss(animated: true) { [self] in inserted(payload) }
  }
}
#endif
