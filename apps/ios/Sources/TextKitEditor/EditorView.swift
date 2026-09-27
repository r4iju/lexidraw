#if canImport(UIKit)
import EditorModelInterface
import OSLog
import UIKit

/// A document edited through an `EditorModel`. What UIKit's text input asks
/// for becomes the model's commands, and each command's changes are all the
/// view re-renders. TextKit 2 lays the text out and draws what is on screen,
/// a block at a time (`BlockLayout`).
///
/// Text an input method is still composing lives only here, over the
/// selection it replaces, and reaches the model as one `insertText` when it
/// is committed.
public final class EditorView: UIScrollView, UITextInput {
  private static let log = Logger(subsystem: "TextKitEditor", category: "EditorView")

  private let model: any EditorModel
  /// Whether the user may change the document. A view that isn't takes no
  /// keyboard, and sends the model nothing that edits.
  public let isEditable: Bool
  private let document: DocumentText
  private let storage = NSTextStorage()
  private let layout: BlockLayout
  private let typesetting: Typesetting

  /// The selection as UTF-16 offsets into the text; `focus` is the end that
  /// moves.
  private var anchor = 0
  private var focus = 0
  private var composition: Composition?
  /// When the model last heard from the view, for the time its history
  /// merges edits by.
  private var lastCommand = ProcessInfo.processInfo.systemUptime

  /// Called after each call a keyboard's input method makes.
  public var onInput: ((TextInputRecord) -> Void)?

  public weak var inputDelegate: (any UITextInputDelegate)?
  public var markedTextStyle: [NSAttributedString.Key: Any]?
  public private(set) lazy var tokenizer: any UITextInputTokenizer = UITextInputStringTokenizer(textInput: self)

  /// `style` sets the text's attributes in place of the web's typography.
  public init(model: any EditorModel, style: DocumentText.Style? = nil, isEditable: Bool = true) {
    self.model = model
    self.isEditable = isEditable
    let typesetting = Typesetting(.web)
    self.typesetting = typesetting
    document = DocumentText(
      model: model, style: style ?? { typesetting.attributes($0, $1) }, standIn: BlockLayout.standIn)
    layout = BlockLayout(storage: storage, document: document, typesetting: typesetting)
    super.init(frame: .zero)
    backgroundColor = .systemBackground
    alwaysBounceVertical = true
    keyboardDismissMode = .interactive
    addSubview(surface)

    let interaction = UITextInteraction(for: isEditable ? .editable : .nonEditable)
    interaction.textInput = self
    surface.addInteraction(interaction)
    isAccessibilityElement = true
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: EditorView, _) in view.layout.redraw() }
    // UIKit redraws the caret and selection only when told the selection
    // changed, though here only where it is drawn did.
    layout.onScrollSideways = { [weak self] in
      guard let self else { return }
      inputDelegate?.selectionWillChange(self)
      inputDelegate?.selectionDidChange(self)
    }
    render(nil)
  }

  private var surface: UIView { layout.surface }

  required init?(coder: NSCoder) { fatalError("EditorView is made in code") }

  // MARK: Commands

  /// Sends `command` to the model and shows what it changed. A command the
  /// model refuses leaves the document as it was, so there is nothing to show.
  /// UIKit's own input calls expect the text and selection they asked for
  /// without being told; anything else tells the input delegate.
  private func perform(_ command: EditorCommand, fromInput: Bool) {
    guard isEditable || !command.edits else { return }
    let now = ProcessInfo.processInfo.systemUptime
    let elapsed = Int((now - lastCommand) * 1000)
    lastCommand = now
    if elapsed > 0 {
      do { try model.apply(.wait(milliseconds: elapsed)) } catch { failed("The model refused to wait", error) }
    }
    let change: ChangeSet
    do {
      change = try model.apply(command)
    } catch EditorError.unsupported(let what) {
      Self.log.notice("The model can't \(command.name, privacy: .public) here yet: \(what, privacy: .public)")
      return
    } catch {
      failed("The model refused \(command.name)", error)
      return
    }
    if !fromInput { inputDelegate?.textWillChange(self) }
    render(change)
    if !fromInput { inputDelegate?.textDidChange(self) }
    showModelSelection(fromInput: fromInput)
  }

  /// Something the view relies on the model for went wrong: a bug in one or
  /// the other, so it stops a debug build.
  private func failed(_ what: String, _ error: any Error) {
    Self.log.fault("\(what, privacy: .public): \(String(describing: error), privacy: .public)")
    assertionFailure("\(what): \(error)")
  }

  /// Brings the text up to date with `change`, or renders it afresh.
  private func render(_ change: ChangeSet?) {
    layout.edit {
      do {
        if let change { return try document.update(storage, after: change) }
        return try document.reload(storage)
      } catch {
        failed("The model's update couldn't be shown", error)
        if change != nil {
          do { try document.reload(storage) } catch { failed("The document couldn't be shown", error) }
        }
        return nil
      }
    }
    setNeedsLayout()
  }

  /// A change to the text that is only the view's, as composition is.
  private func editText(in range: NSRange, with text: NSAttributedString) {
    layout.edit { document.replace(storage, in: range, with: text) }
    setNeedsLayout()
  }

  private func modelSelection() -> Selection? {
    do { return try model.selection() } catch {
      failed("The model has no document", error)
      return nil
    }
  }

  private func showModelSelection(fromInput: Bool) {
    guard let selection = modelSelection(), let anchor = document.offset(of: selection.anchor),
      let focus = document.offset(of: selection.focus)
    else { return }
    if !fromInput { inputDelegate?.selectionWillChange(self) }
    self.anchor = anchor
    self.focus = focus
    if !fromInput { inputDelegate?.selectionDidChange(self) }
    scrollToCaret()
  }

  /// Tells the model where the view's selection is, which it needs before
  /// any edit.
  private func sendSelection() {
    perform(.setSelection(anchor: document.point(at: anchor), focus: document.point(at: focus)), fromInput: true)
  }

  /// Tells the model the view's selection unless it already has it. Placing
  /// a selection anew would reset the format a caret types in, which a
  /// shortcut such as ⌘B may just have set.
  private func syncSelection() {
    guard let selection = modelSelection(), document.offset(of: selection.anchor) == anchor,
      document.offset(of: selection.focus) == focus
    else { return sendSelection() }
  }

  /// Text typed or pasted, each newline a new paragraph as Return makes.
  private func insert(_ text: String, fromInput: Bool) {
    let lines = text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline)
    for (index, line) in lines.enumerated() {
      if index > 0 { perform(.insertParagraph, fromInput: fromInput) }
      if !line.isEmpty || lines.count == 1 { perform(.insertText(String(line)), fromInput: fromInput) }
    }
  }

  // MARK: UIKeyInput

  public var hasText: Bool { storage.length > 1 }

  public func insertText(_ text: String) {
    if composition != nil {
      commit(text)
    } else {
      insert(text, fromInput: true)
    }
    report(.insertText(text))
  }

  public func deleteBackward() {
    commitMarkedText()
    perform(.deleteCharacter(backward: true), fromInput: true)
    report(.deleteBackward)
  }

  private func report(_ call: TextInputRecord.Call) {
    onInput?(TextInputRecord(call: call, text: storage.string, marked: composition?.marked))
  }

  public override var canBecomeFirstResponder: Bool { isEditable }

  /// A model with no selection yet takes the view's, so typing has
  /// somewhere to go.
  public override func becomeFirstResponder() -> Bool {
    guard super.becomeFirstResponder() else { return false }
    if modelSelection() == nil { sendSelection() }
    return true
  }

  // MARK: Composition

  private struct Composition {
    /// The selection the composed text replaces.
    var replaced: NSRange
    /// What was there before, put back when the composition ends.
    var original: NSAttributedString
    var marked: NSRange
  }

  public var markedTextRange: UITextRange? { composition.map { TextRange($0.marked) } }

  public func setMarkedText(_ markedText: String?, selectedRange: NSRange) {
    let text = markedText ?? ""
    let replaced = selected
    var composition =
      self.composition
      ?? Composition(replaced: replaced, original: storage.attributedSubstring(from: replaced), marked: replaced)
    var attributes = document.attributes(at: composition.replaced.location, format: modelSelection()?.format ?? [])
    attributes.merge(markedTextStyle ?? [.underlineStyle: NSUnderlineStyle.single.rawValue]) { $1 }
    editText(in: composition.marked, with: NSAttributedString(string: text, attributes: attributes))
    composition.marked.length = text.utf16.count
    self.composition = composition
    let start = composition.marked.location + min(selectedRange.location, composition.marked.length)
    anchor = start
    focus = min(start + selectedRange.length, NSMaxRange(composition.marked))
    scrollToCaret()
    report(.setMarkedText(text, selectedRange: selectedRange))
  }

  public func unmarkText() {
    commitMarkedText()
    report(.unmarkText)
  }

  private func commitMarkedText() {
    guard let composition else { return }
    commit(storage.attributedSubstring(from: composition.marked).string)
  }

  /// Ends the composition with `text` in place of what it replaced, which
  /// only then reaches the model.
  private func commit(_ text: String) {
    guard let composition else { return }
    self.composition = nil
    editText(in: composition.marked, with: composition.original)
    anchor = composition.replaced.location
    focus = NSMaxRange(composition.replaced)
    if text.isEmpty, composition.replaced.length == 0 { return }
    syncSelection()
    insert(text, fromInput: true)
  }

  // MARK: Selection

  /// The view's selection in the document, which during a composition is
  /// inside the marked text.
  private var selected: NSRange { NSRange(location: min(anchor, focus), length: abs(focus - anchor)) }

  public var selectedTextRange: UITextRange? {
    get { TextRange(selected) }
    set {
      guard let range = newValue as? TextRange else { return }
      let snapped = wholeCharacters(range.range)
      guard composition != nil || snapped != selected else { return }
      anchor = snapped.location
      focus = NSMaxRange(snapped)
      if composition == nil { sendSelection() }
      scrollToCaret()
    }
  }

  /// Moves the caret by keyboard, or extends the selection's moving end.
  private func move(to offset: Int, extending: Bool) {
    inputDelegate?.selectionWillChange(self)
    focus = clamp(offset)
    if !extending { anchor = focus }
    inputDelegate?.selectionDidChange(self)
    sendSelection()
    scrollToCaret()
  }

  // MARK: Positions

  /// The last caret position is before the newline ending the last block.
  private var lastOffset: Int { max(storage.length - 1, 0) }

  private func clamp(_ offset: Int) -> Int { min(max(offset, 0), lastOffset) }

  public var beginningOfDocument: UITextPosition { TextPosition(0) }
  public var endOfDocument: UITextPosition { TextPosition(lastOffset) }

  public func text(in range: UITextRange) -> String? {
    guard let range = range as? TextRange else { return nil }
    let start = min(range.range.location, storage.length)
    return (storage.string as NSString).substring(
      with: NSRange(location: start, length: min(NSMaxRange(range.range), storage.length) - start))
  }

  public func replace(_ range: UITextRange, withText text: String) {
    guard let range = range as? TextRange else { return }
    commitMarkedText()
    let replaced = wholeCharacters(range.range)
    anchor = replaced.location
    focus = NSMaxRange(replaced)
    sendSelection()
    insert(text, fromInput: true)
  }

  public func textRange(from fromPosition: UITextPosition, to toPosition: UITextPosition) -> UITextRange? {
    guard let from = fromPosition as? TextPosition, let to = toPosition as? TextPosition else { return nil }
    return TextRange(NSRange(location: min(from.offset, to.offset), length: abs(to.offset - from.offset)))
  }

  public func position(from position: UITextPosition, offset: Int) -> UITextPosition? {
    guard let position = position as? TextPosition else { return nil }
    let moved = position.offset + offset
    return (0...lastOffset).contains(moved) ? TextPosition(moved) : nil
  }

  public func position(from position: UITextPosition, in direction: UITextLayoutDirection, offset: Int)
    -> UITextPosition?
  {
    guard let position = position as? TextPosition else { return nil }
    var moved = position.offset
    for _ in 0..<offset {
      switch direction {
      case .left: moved = character(before: moved)
      case .right: moved = character(after: moved)
      case .up: moved = line(from: moved, .up) ?? moved
      case .down: moved = line(from: moved, .down) ?? moved
      @unknown default: return nil
      }
    }
    return TextPosition(moved)
  }

  public func compare(_ position: UITextPosition, to other: UITextPosition) -> ComparisonResult {
    guard let position = position as? TextPosition, let other = other as? TextPosition else { return .orderedSame }
    return position.offset < other.offset ? .orderedAscending : position.offset > other.offset ? .orderedDescending : .orderedSame
  }

  public func offset(from: UITextPosition, to toPosition: UITextPosition) -> Int {
    guard let from = from as? TextPosition, let to = toPosition as? TextPosition else { return 0 }
    return to.offset - from.offset
  }

  public func position(within range: UITextRange, farthestIn direction: UITextLayoutDirection) -> UITextPosition? {
    direction == .left || direction == .up ? range.start : range.end
  }

  public func characterRange(byExtending position: UITextPosition, in direction: UITextLayoutDirection)
    -> UITextRange?
  {
    guard let position = position as? TextPosition else { return nil }
    let other = direction == .left || direction == .up ? character(before: position.offset) : character(after: position.offset)
    return TextRange(NSRange(location: min(position.offset, other), length: abs(other - position.offset)))
  }

  public func baseWritingDirection(for position: UITextPosition, in direction: UITextStorageDirection)
    -> NSWritingDirection
  { .natural }

  /// Refused: each paragraph reads in the direction of its own text, as on
  /// the web, and neither editor sets one yet (#149).
  public func setBaseWritingDirection(_ writingDirection: NSWritingDirection, for range: UITextRange) {
    guard writingDirection != .natural else { return }
    Self.log.notice("Setting a writing direction isn't supported yet (#149)")
  }

  /// The offset one user-perceived character on, so a joined emoji or flag
  /// is passed over whole.
  private func character(after offset: Int) -> Int {
    guard offset < storage.length else { return offset }
    return clamp(NSMaxRange((storage.string as NSString).rangeOfComposedCharacterSequence(at: offset)))
  }

  private func character(before offset: Int) -> Int {
    guard offset > 0 else { return offset }
    return (storage.string as NSString).rangeOfComposedCharacterSequence(at: offset - 1).location
  }

  /// `range` grown to whole user-perceived characters, as a browser keeps a
  /// selection. UIKit asks to delete what it takes for the last character
  /// by selecting it first, and takes only the last emoji of a joined one.
  private func wholeCharacters(_ range: NSRange) -> NSRange {
    let start = clamp(range.location)
    let end = clamp(NSMaxRange(range))
    let text = storage.string as NSString
    let wholeStart = start < text.length ? text.rangeOfComposedCharacterSequence(at: start).location : start
    guard end > start else { return NSRange(location: wholeStart, length: 0) }
    let wholeEnd = NSMaxRange(text.rangeOfComposedCharacterSequence(at: end - 1))
    return NSRange(location: wholeStart, length: clamp(wholeEnd) - wholeStart)
  }

  private func line(from offset: Int, _ direction: NSTextSelectionNavigation.Direction) -> Int? {
    layout.offset(movingVerticallyFrom: offset, direction).map(clamp)
  }

  // MARK: Geometry

  public var textInputView: UIView { surface }

  private func segments(_ range: NSRange) -> [CGRect] { layout.segments(range) }

  public func firstRect(for range: UITextRange) -> CGRect {
    guard let range = range as? TextRange else { return .null }
    return segments(range.range).first ?? .null
  }

  public func caretRect(for position: UITextPosition) -> CGRect {
    guard let position = position as? TextPosition,
      let frame = segments(NSRange(location: clamp(position.offset), length: 0)).first
    else { return .zero }
    return CGRect(x: frame.minX, y: frame.minY, width: 2, height: frame.height)
  }

  public func selectionRects(for range: UITextRange) -> [UITextSelectionRect] {
    guard let range = range as? TextRange else { return [] }
    let frames = segments(range.range).filter { $0.width > 0 }
    return frames.enumerated().map { index, frame in
      SelectionRect(frame, containsStart: index == 0, containsEnd: index == frames.count - 1)
    }
  }

  public func closestPosition(to point: CGPoint) -> UITextPosition? {
    TextPosition(clamp(layout.offset(closestTo: point) ?? lastOffset))
  }

  public func closestPosition(to point: CGPoint, within range: UITextRange) -> UITextPosition? {
    guard let position = closestPosition(to: point) as? TextPosition, let range = range as? TextRange else {
      return nil
    }
    return TextPosition(min(max(position.offset, range.range.location), NSMaxRange(range.range)))
  }

  public func characterRange(at point: CGPoint) -> UITextRange? {
    guard let position = closestPosition(to: point) as? TextPosition else { return nil }
    let end = character(after: position.offset)
    return TextRange(NSRange(location: position.offset, length: end - position.offset))
  }

  private func scrollToCaret() {
    layout.scrollToShow(focus)
    let caret = caretRect(for: TextPosition(focus))
    guard caret != .zero else { return }
    scrollRectToVisible(surface.convert(caret, to: self).insetBy(dx: 0, dy: -BlockLayout.margin), animated: false)
  }

  // MARK: Hardware keyboard

  public override var keyCommands: [UIKeyCommand]? {
    func command(_ input: String, _ modifiers: UIKeyModifierFlags, _ action: Selector) -> UIKeyCommand {
      let command = UIKeyCommand(input: input, modifierFlags: modifiers, action: action)
      command.wantsPriorityOverSystemBehavior = true
      return command
    }
    let moves = [
      command(UIKeyCommand.inputLeftArrow, [], #selector(moveLeft)),
      command(UIKeyCommand.inputRightArrow, [], #selector(moveRight)),
      command(UIKeyCommand.inputUpArrow, [], #selector(moveUp)),
      command(UIKeyCommand.inputDownArrow, [], #selector(moveDown)),
      command(UIKeyCommand.inputLeftArrow, .shift, #selector(extendLeft)),
      command(UIKeyCommand.inputRightArrow, .shift, #selector(extendRight)),
      command(UIKeyCommand.inputUpArrow, .shift, #selector(extendUp)),
      command(UIKeyCommand.inputDownArrow, .shift, #selector(extendDown)),
      command(UIKeyCommand.inputLeftArrow, .command, #selector(moveToLineStart)),
      command(UIKeyCommand.inputRightArrow, .command, #selector(moveToLineEnd)),
    ]
    guard isEditable else { return moves }
    return moves + [
      command("\r", .shift, #selector(insertLineBreak)),
      command(UIKeyCommand.inputDelete, .alternate, #selector(deleteWordBackward)),
      command(UIKeyCommand.inputDelete, .command, #selector(deleteLineBackward)),
      command(Self.forwardDelete, [], #selector(deleteForward)),
      command(Self.forwardDelete, .alternate, #selector(deleteWordForward)),
      // The web's block shortcuts.
      command("0", [.command, .alternate], #selector(makeParagraph)),
      command("1", [.command, .alternate], #selector(makeHeading1)),
      command("2", [.command, .alternate], #selector(makeHeading2)),
      command("3", [.command, .alternate], #selector(makeHeading3)),
      command("q", [.command, .alternate], #selector(makeQuote)),
    ]
  }

  /// What the Forward Delete key gives; `UIKeyCommand.inputDelete` is
  /// Backspace.
  private static let forwardDelete = "\u{7F}"

  @objc private func insertLineBreak() { perform(.insertLineBreak, fromInput: false) }

  @objc private func moveLeft() {
    move(to: anchor == focus ? character(before: focus) : selected.location, extending: false)
  }

  @objc private func moveRight() {
    move(to: anchor == focus ? character(after: focus) : NSMaxRange(selected), extending: false)
  }

  @objc private func moveUp() { move(to: line(from: focus, .up) ?? 0, extending: false) }
  @objc private func moveDown() { move(to: line(from: focus, .down) ?? lastOffset, extending: false) }
  @objc private func extendLeft() { move(to: character(before: focus), extending: true) }
  @objc private func extendRight() { move(to: character(after: focus), extending: true) }
  @objc private func extendUp() { move(to: line(from: focus, .up) ?? 0, extending: true) }
  @objc private func extendDown() { move(to: line(from: focus, .down) ?? lastOffset, extending: true) }
  @objc private func moveToLineStart() { move(to: lineBoundary(backward: true) ?? focus, extending: false) }
  @objc private func moveToLineEnd() { move(to: lineBoundary(backward: false) ?? focus, extending: false) }
  @objc private func deleteWordBackward() { perform(.deleteWord(backward: true), fromInput: false) }
  @objc private func deleteWordForward() { perform(.deleteWord(backward: false), fromInput: false) }
  @objc private func deleteForward() { perform(.deleteCharacter(backward: false), fromInput: false) }

  @objc private func deleteLineBackward() {
    guard let boundary = lineBoundary(backward: true) else { return }
    perform(.deleteLine(backward: true, lineBoundary: document.point(at: boundary)), fromInput: false)
  }

  /// Where the caret's line starts as laid out, or where it ends going
  /// forward, before the newline or line break that ends it.
  private func lineBoundary(backward: Bool) -> Int? {
    layout.lineBoundary(at: focus, backward: backward).map(clamp)
  }

  // MARK: Edit menu and formatting

  private lazy var history = ModelHistory(
    undo: { [unowned self] in perform(.undo, fromInput: false) },
    redo: { [unowned self] in perform(.redo, fromInput: false) })

  /// The model's history, which ⌘Z, ⇧⌘Z and the system's undo gestures
  /// reach through.
  public override var undoManager: UndoManager? { history }

  public override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    switch action {
    case #selector(toggleBoldface(_:)), #selector(toggleItalics(_:)), #selector(toggleUnderline(_:)):
      isEditable
    case #selector(selectAll(_:)):
      true
    case #selector(makeTextWritingDirectionLeftToRight(_:)), #selector(makeTextWritingDirectionRightToLeft(_:)):
      false
    default: super.canPerformAction(action, withSender: sender)
    }
  }

  /// Makes each block the selection touches a block of `type`, as the web's
  /// block menu does, which leaves a heading or quote already of that type
  /// as it is.
  public func setBlockType(_ type: BlockType) {
    if type != .paragraph, document.blockCount > 0, document.type(ofBlock: document.blockIndex(at: anchor)) == type.rawValue {
      return
    }
    perform(.setBlockType(type), fromInput: false)
  }

  @objc private func makeParagraph() { setBlockType(.paragraph) }
  @objc private func makeHeading1() { setBlockType(.h1) }
  @objc private func makeHeading2() { setBlockType(.h2) }
  @objc private func makeHeading3() { setBlockType(.h3) }
  @objc private func makeQuote() { setBlockType(.quote) }

  public override func toggleBoldface(_ sender: Any?) { perform(.formatText(.bold), fromInput: false) }
  public override func toggleItalics(_ sender: Any?) { perform(.formatText(.italic), fromInput: false) }
  public override func toggleUnderline(_ sender: Any?) { perform(.formatText(.underline), fromInput: false) }
  public override func selectAll(_ sender: Any?) { perform(.selectAll, fromInput: false) }

  // MARK: Accessibility

  /// The text, with each block the editor can't show yet named by its type
  /// in place of the one character that stands for it.
  public override var accessibilityValue: String? {
    get {
      let text = NSMutableString(string: storage.string)
      for index in (0..<document.blockCount).reversed() {
        guard case .embedded(let type) = document.kind(ofBlock: index) else { continue }
        let block = document.range(ofBlock: index)
        text.replaceOccurrences(of: "\u{FFFC}", with: type, range: block)
      }
      return text as String
    }
    set {}
  }

  // MARK: Layout

  public override func layoutSubviews() {
    super.layoutSubviews()
    let narrow = bounds.width <= typesetting.typography.narrowWidth
    if narrow != typesetting.isNarrow, composition == nil {
      typesetting.isNarrow = narrow
      render(nil)
    }
    layout.layoutViewport(of: self)
  }
}

extension EditorCommand {
  /// Whether the command can change the document, not only where the
  /// selection is.
  fileprivate var edits: Bool {
    switch self {
    case .setSelection, .selectAll, .wait: false
    default: true
    }
  }
}

final class TextPosition: UITextPosition {
  let offset: Int
  init(_ offset: Int) { self.offset = offset }
}

final class TextRange: UITextRange {
  let range: NSRange
  init(_ range: NSRange) { self.range = range }
  override var start: UITextPosition { TextPosition(range.location) }
  override var end: UITextPosition { TextPosition(NSMaxRange(range)) }
  override var isEmpty: Bool { range.length == 0 }
}

final class SelectionRect: UITextSelectionRect {
  private let frame: CGRect
  private let isStart: Bool
  private let isEnd: Bool

  init(_ frame: CGRect, containsStart: Bool, containsEnd: Bool) {
    self.frame = frame
    isStart = containsStart
    isEnd = containsEnd
  }

  override var rect: CGRect { frame }
  override var writingDirection: NSWritingDirection { .natural }
  override var containsStart: Bool { isStart }
  override var containsEnd: Bool { isEnd }
  override var isVertical: Bool { false }
}

/// An undo manager that is only a way to the model's undo and redo. The
/// model doesn't say whether there is anything to undo; with nothing, undo
/// changes nothing.
private final class ModelHistory: UndoManager {
  private let undoEdit: () -> Void
  private let redoEdit: () -> Void

  init(undo: @escaping () -> Void, redo: @escaping () -> Void) {
    undoEdit = undo
    redoEdit = redo
    super.init()
  }

  override var canUndo: Bool { true }
  override var canRedo: Bool { true }
  override func undo() { undoEdit() }
  override func redo() { redoEdit() }
}
#endif
