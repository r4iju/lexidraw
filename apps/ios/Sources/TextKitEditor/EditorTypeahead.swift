#if canImport(UIKit)
import UIKit
import EditorModelInterface
/// The current simple text node prefix; offsets are UTF-16 storage positions.
public struct EditorTypeaheadInput: Equatable, Sendable {
  public let prefix: String
  public let replacementBase: Int
  public let selectionOffset: Int
  public let nodeKey: String
  public let previousSiblingIsTextEntity: Bool
}
@MainActor public struct EditorTypeaheadCandidate {
  public let id: String
  public let label: String
  public let detail: String?
  public let select: (EditorView, NSRange) -> Void
  public init(
    id: String, label: String, detail: String? = nil,
    select: @escaping (EditorView, NSRange) -> Void
  ) {
    self.id = id
    self.label = label
    self.detail = detail
    self.select = select
  }
}
/// Providers own source matching and bounded option counts. The range replaces the trigger.
@MainActor public struct EditorTypeaheadMatch {
  public let range: NSRange
  public let candidates: [EditorTypeaheadCandidate]
  public init(range: NSRange, candidates: [EditorTypeaheadCandidate]) {
    self.range = range
    self.candidates = candidates
  }
}
@MainActor public struct EditorTypeaheadProvider {
  public let id: String
  public let options: (EditorTypeaheadInput) async -> EditorTypeaheadMatch?
  public init(
    id: String, options: @escaping (EditorTypeaheadInput) async -> EditorTypeaheadMatch?
  ) {
    self.id = id
    self.options = options
  }
  static let emoji = Self(id: "emoji") { input in
    guard let match = JSRegExp(WebEmojiPicker.pattern, flags: "").firstMatch(in: input.prefix),
      match.groups.count > 3, let leading = match.groups[1], let replacement = match.groups[2],
      let query = match.groups[3]
    else { return nil }
    let range = NSRange(
      location: input.replacementBase + match.index + leading.utf16.count,
      length: replacement.utf16.count)
    let candidates = WebEmojiPicker.entries.lazy.filter {
      $0.keywords.contains { $0.lowercased().contains(query.lowercased()) }
    }.prefix(WebEmojiPicker.limit).map { entry in
      EditorTypeaheadCandidate(
        id: "emoji-option-\(entry.title)", label: "\(entry.emoji) \(entry.title)"
      ) { editor, range in
        guard
          let node = try? JSONDecoder().decode(
            JSONValue.self, from: Data(WebEmojiPicker.textNodeJSON.utf8))
        else { return }
        guard case .object(var fields) = node else { return }
        fields["text"] = .string(entry.emoji)
        editor.replaceTypeahead(
          range: range,
          with: Clipboard(
            plainText: entry.emoji,
            lexical: LexicalClipboardPayload(namespace: MediaLinks.namespace, nodes: [.object(fields)])), preservingTypingAttributes: true)
      }
    }
    return EditorTypeaheadMatch(range: range, candidates: Array(candidates))
  }
}
@MainActor final class EditorTypeaheadController {
  weak var editor: EditorView?
  private var input: EditorTypeaheadInput?
  private var task: Task<Void, Never>?
  private var popup: UIView?
  private var match: EditorTypeaheadMatch?
  private var selectedIndex = 0
  private var buttons: [UIButton] = []
  var isVisible: Bool {
    guard let popup else { return false }
    return popup.superview != nil && popup.window != nil && !popup.isHidden && popup.alpha > 0
  }
  var accessibilityView: UIView? { popup }
  private var presentedBounds: CGRect?
  func layoutChanged() { if let editor, let presentedBounds, editor.bounds != presentedBounds { clear() } }
  func move(_ direction: Int) -> Bool {
    guard isVisible, let match, !match.candidates.isEmpty, let editor,
      let input, editor.currentTypeaheadInput() == input else { return false }
    selectedIndex = (selectedIndex + direction + match.candidates.count) % match.candidates.count
    highlight()
    return true
  }
  func choose() -> Bool {
    guard isVisible, let match, let editor, let input, editor.currentTypeaheadInput() == input else {
      return false
    }
    let candidate = match.candidates[selectedIndex]
    clear()
    candidate.select(editor, match.range)
    return true
  }
  private func highlight() {
    for (index, button) in buttons.enumerated() {
      button.backgroundColor = index == selectedIndex ? .tertiarySystemFill : .clear
    }
    if buttons.indices.contains(selectedIndex), let scroll = popup as? UIScrollView {
      scroll.scrollRectToVisible(buttons[selectedIndex].frame, animated: false)
    }
  }
  init(editor: EditorView) { self.editor = editor }
  func clear() {
    task?.cancel()
    task = nil
    input = nil
    popup?.removeFromSuperview()
    popup = nil
    match = nil
    buttons = []
  }
  func update(_ input: EditorTypeaheadInput, providers: [EditorTypeaheadProvider]) {
    if self.input == input { return }
    clear()
    self.input = input
    task = Task { [weak self] in
      for provider in providers {
        guard !Task.isCancelled else { return }
        guard let match = await provider.options(input), !match.candidates.isEmpty else {
          continue
        }
        guard !Task.isCancelled, let self, self.input == input else { return }
        if input.previousSiblingIsTextEntity && match.range.location == input.replacementBase { continue }
        self.show(match, input: input)
        return
      }
    }
  }
  private func show(_ match: EditorTypeaheadMatch, input: EditorTypeaheadInput) {
    guard let editor, let host = editor.superview, editor.window != nil,
      editor.currentTypeaheadInput() == input else { return }
    presentedBounds = editor.bounds
    self.match = match
    selectedIndex = 0
    let stack = UIStackView()
    stack.axis = .vertical
    for candidate in match.candidates {
      let button = UIButton(type: .system)
      button.setTitle(candidate.label, for: .normal)
      button.contentHorizontalAlignment = .leading
      button.accessibilityIdentifier = candidate.id
      button.heightAnchor.constraint(equalToConstant: 36).isActive = true
      button.addAction(
        UIAction { [weak self] _ in
          guard let self, self.input == input, let editor = self.editor,
            editor.currentTypeaheadInput() == input
          else { return }
          self.clear()
          candidate.select(editor, match.range)
        }, for: .touchUpInside)
      stack.addArrangedSubview(button)
      buttons.append(button)
    }
    let panel = UIScrollView()
    panel.backgroundColor = .secondarySystemBackground
    panel.layer.cornerRadius = 8
    panel.layer.borderWidth = 1
    panel.layer.borderColor = UIColor.separator.cgColor
    panel.addSubview(stack)
    let width = min(320, max(100, editor.bounds.width - 24))
    let height = min(CGFloat(match.candidates.count) * 36, 216)
    let position =
      editor.position(from: editor.beginningOfDocument, offset: input.selectionOffset)
      ?? editor.beginningOfDocument
    let caret = editor.caretRect(for: position)
    let bottom = editor.bounds.maxY - editor.adjustedContentInset.bottom
    let y =
      caret.maxY + height <= bottom ? caret.maxY : max(editor.bounds.minY, caret.minY - height)
    panel.frame = CGRect(
      x: min(max(editor.bounds.minX + 8, caret.minX), editor.bounds.maxX - width - 8), y: y,
      width: width, height: height)
    stack.frame = CGRect(
      x: 8, y: 0, width: width - 16, height: CGFloat(match.candidates.count) * 36)
    panel.contentSize = stack.frame.size
    panel.frame = editor.convert(panel.frame, to: host)
    host.addSubview(panel)
    popup = panel
    highlight()
  }
}
#endif
