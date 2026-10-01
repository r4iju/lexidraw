#if canImport(UIKit)
import EditorModelInterface
import UIKit

@MainActor final class EditorFormattingBar: UIInputView {
  private let stack = UIStackView()
  private var formats: [(UIButton, TextFormatType)] = []
  private let block: UIButton
  private let lists: UIButton
  private let insert: UIButton
  private var lastFormat: TextFormat?

  init(
    format: @escaping (TextFormatType) -> Void, link: @escaping () -> Void,
    undo: @escaping () -> Void, redo: @escaping () -> Void,
    menus: @escaping () -> (block: UIMenu, lists: UIMenu, insert: UIMenu)
  ) {
    block = Self.button("Block type", symbol: "textformat.size")
    lists = Self.button("Lists", symbol: "list.bullet")
    insert = Self.button("Insert", symbol: "plus")
    super.init(frame: CGRect(x: 0, y: 0, width: 0, height: 48), inputViewStyle: .keyboard)
    allowsSelfSizing = true
    let scroll = UIScrollView()
    scroll.showsHorizontalScrollIndicator = false
    scroll.translatesAutoresizingMaskIntoConstraints = false
    addSubview(scroll)
    stack.axis = .horizontal
    stack.spacing = 2
    stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false
    scroll.addSubview(stack)
    NSLayoutConstraint.activate([
      scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
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
      let button = Self.button(title, symbol: symbol)
      button.addAction(UIAction { _ in format(type) }, for: .touchUpInside)
      stack.addArrangedSubview(button)
      formats.append((button, type))
    }
    for (title, symbol, action) in [
      ("Link", "link", link), ("Undo", "arrow.uturn.backward", undo), ("Redo", "arrow.uturn.forward", redo),
    ] {
      let button = Self.button(title, symbol: symbol)
      button.addAction(UIAction { _ in action() }, for: .touchUpInside)
      stack.addArrangedSubview(button)
    }
    for button in [block, lists, insert] {
      button.showsMenuAsPrimaryAction = true
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
    for (button, type) in formats {
      let selected = format.contains(type.format)
      button.isSelected = selected
      button.accessibilityTraits = selected ? [.button, .selected] : .button
      button.configuration?.background.backgroundColor = selected ? button.tintColor.withAlphaComponent(0.15) : .clear
    }
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
