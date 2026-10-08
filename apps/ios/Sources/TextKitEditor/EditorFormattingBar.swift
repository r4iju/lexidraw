#if canImport(UIKit)
import EditorModelInterface
import UIKit

@MainActor final class EditorFormattingBar: UIInputView {
  private let stack = UIStackView()
  private var formats: [(UIAction, TextFormatType)] = []
  private let textFormat: UIButton
  private let linkAction: UIAction
  private let block: UIButton
  private let lists: UIButton
  private let insert: UIButton
  private var lastFormat: TextFormat?

  init(
    format: @escaping (TextFormatType) -> Void, link: @escaping () -> Void,
    undo: @escaping () -> Void, redo: @escaping () -> Void,
    hideKeyboard: @escaping () -> Void,
    menus: @escaping () -> (block: UIMenu, lists: UIMenu, insert: UIMenu)
  ) {
    textFormat = Self.button("Format", symbol: "textformat")
    linkAction = UIAction(title: "Link", image: UIImage(systemName: "link")) { _ in link() }
    block = Self.button("Block type", symbol: "textformat.size")
    lists = Self.button("Lists", symbol: "list.bullet")
    insert = Self.button("Insert", symbol: "plus")
    super.init(frame: CGRect(x: 0, y: 0, width: 0, height: 48), inputViewStyle: .keyboard)
    allowsSelfSizing = true
    let scroll = UIScrollView()
    scroll.showsHorizontalScrollIndicator = false
    scroll.translatesAutoresizingMaskIntoConstraints = false
    addSubview(scroll)
    let hide = Self.button("Hide keyboard", symbol: "keyboard.chevron.compact.down")
    hide.translatesAutoresizingMaskIntoConstraints = false
    hide.addAction(UIAction { _ in hideKeyboard() }, for: .touchUpInside)
    addSubview(hide)
    stack.axis = .horizontal
    stack.spacing = 2
    stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: hide.leadingAnchor, constant: -4),
      hide.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -4),
      hide.centerYAnchor.constraint(equalTo: centerYAnchor),
      hide.widthAnchor.constraint(equalToConstant: 44),
      hide.heightAnchor.constraint(equalToConstant: 44),
      scroll.topAnchor.constraint(equalTo: topAnchor),
      scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 8),
      stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -8),
      stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
      stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
      stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor),
    ])
    for (type, title, symbol) in [
      (TextFormatType.bold, "Bold", "bold"), (.italic, "Italic", "italic"),
      (.underline, "Underline", "underline"), (.strikethrough, "Strikethrough", "strikethrough"),
      (.code, "Inline code", "chevron.left.forwardslash.chevron.right"),
    ] {
      let action = UIAction(title: title, image: UIImage(systemName: symbol)) { _ in format(type) }
      formats.append((action, type))
    }
    textFormat.showsMenuAsPrimaryAction = true
    stack.addArrangedSubview(textFormat)
    for button in [block, lists, insert] {
      button.showsMenuAsPrimaryAction = true
      stack.addArrangedSubview(button)
    }
    for (title, symbol, action) in [
      ("Undo", "arrow.uturn.backward", undo), ("Redo", "arrow.uturn.forward", redo),
    ] {
      let button = Self.button(title, symbol: symbol)
      button.addAction(UIAction { _ in action() }, for: .touchUpInside)
      stack.addArrangedSubview(button)
    }
    for (button, choices) in [
      (block, { [menus] in menus().block.children }),
      (lists, { [menus] in menus().lists.children }),
      (insert, { [menus] in menus().insert.children }),
    ] {
      button.menu = UIMenu(children: [UIDeferredMenuElement.uncached { completion in
        completion(choices())
      }])
    }
    update(format: [])
  }

  func setMenuAvailability(lists availableLists: Bool, insert availableInsert: Bool) {
    lists.isHidden = !availableLists
    insert.isHidden = !availableInsert
  }

  override var intrinsicContentSize: CGSize { CGSize(width: UIView.noIntrinsicMetric, height: 48) }

  func update(format: TextFormat) {
    guard lastFormat != format else { return }
    lastFormat = format
    for (action, type) in formats {
      let selected = format.contains(type.format)
      action.state = selected ? .on : .off
    }
    textFormat.menu = UIMenu(children: [
      UIMenu(options: .displayInline, children: formats.map(\.0)), linkAction,
    ])
    let selected = formats.filter { format.contains($0.1.format) }.map { $0.0.title }
    textFormat.accessibilityValue = selected.isEmpty ? "No text formatting" : ListFormatter.localizedString(byJoining: selected)
  }

  private static func button(_ title: String, symbol: String) -> UIButton {
    var configuration = UIButton.Configuration.plain()
    configuration.image = UIImage(systemName: symbol)
    configuration.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 10, bottom: 8, trailing: 10)
    let button = UIButton(configuration: configuration)
    button.accessibilityLabel = title
    button.accessibilityIdentifier = "editor \(title.lowercased())"
    button.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    return button
  }

  required init?(coder: NSCoder) { fatalError("EditorFormattingBar is made in code") }
}
#endif
