#if canImport(UIKit)
import EditorModelInterface
import OSLog
import UIKit

/// A document edited through an `EditorModel`. What UIKit's text input asks
/// for becomes the model's commands, and each command's changes are all the
/// view re-renders. TextKit 2 lays the text out and draws what is on screen.
///
/// Text an input method is still composing lives only here, over the
/// selection it replaces, and reaches the model as one `insertText` when it
/// is committed.
public final class EditorView: UIScrollView, UITextInput {
  private static let log = Logger(subsystem: "TextKitEditor", category: "EditorView")

  private let model: any EditorModel
  private let document: DocumentText
  private let storage = NSTextStorage()
  private let contentStorage = NSTextContentStorage()
  private let layoutManager = NSTextLayoutManager()
  private let textContainer = NSTextContainer(size: .zero)
  private let surface = UIView()
  private var fragmentLayers: [ObjectIdentifier: FragmentLayer] = [:]
  private let margin: CGFloat = 16

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

  public init(model: any EditorModel, style: @escaping DocumentText.Style = EditorView.defaultStyle) {
    self.model = model
    document = DocumentText(model: model, style: style)
    super.init(frame: .zero)
    backgroundColor = .systemBackground
    alwaysBounceVertical = true
    keyboardDismissMode = .interactive

    contentStorage.textStorage = storage
    contentStorage.addTextLayoutManager(layoutManager)
    textContainer.lineFragmentPadding = 0
    layoutManager.textContainer = textContainer
    layoutManager.textViewportLayoutController.delegate = self
    addSubview(surface)

    let interaction = UITextInteraction(for: .editable)
    interaction.textInput = self
    surface.addInteraction(interaction)
    isAccessibilityElement = true
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: EditorView, _) in view.redraw() }
    render(nil)
  }

  required init?(coder: NSCoder) { fatalError("EditorView is made in code") }

  // MARK: Commands

  /// Sends `command` to the model and shows what it changed. A command the
  /// model refuses leaves the document as it was, so there is nothing to show.
  /// UIKit's own input calls expect the text and selection they asked for
  /// without being told; anything else tells the input delegate.
  private func perform(_ command: EditorCommand, fromInput: Bool) {
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
    contentStorage.performEditingTransaction {
      do {
        if let change {
          try document.update(storage, after: change)
        } else {
          try document.reload(storage)
        }
      } catch {
        failed("The model's update couldn't be shown", error)
        if change != nil {
          do { try document.reload(storage) } catch { failed("The document couldn't be shown", error) }
        }
      }
    }
    setNeedsLayout()
  }

  /// A change to the text that is only the view's, as composition is.
  private func editStorage(_ body: () -> Void) {
    contentStorage.performEditingTransaction(body)
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

  public override var canBecomeFirstResponder: Bool { true }

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
    let marked = composition.marked
    editStorage { storage.replaceCharacters(in: marked, with: NSAttributedString(string: text, attributes: attributes)) }
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
    editStorage { storage.replaceCharacters(in: composition.marked, with: composition.original) }
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
    guard let location = location(offset),
      let moved = layoutManager.textSelectionNavigation.destinationSelection(
        for: NSTextSelection(location, affinity: .downstream), direction: direction, destination: .character,
        extending: false, confined: false),
      let destination = moved.textRanges.first?.location
    else { return nil }
    return clamp(self.offset(destination))
  }

  // MARK: Geometry

  public var textInputView: UIView { surface }

  private func location(_ offset: Int) -> (any NSTextLocation)? {
    contentStorage.location(contentStorage.documentRange.location, offsetBy: offset)
  }

  private func offset(_ location: any NSTextLocation) -> Int {
    contentStorage.offset(from: contentStorage.documentRange.location, to: location)
  }

  private func textRange(_ range: NSRange) -> NSTextRange? {
    guard let start = location(range.location), let end = location(NSMaxRange(range)) else { return nil }
    return NSTextRange(location: start, end: end)
  }

  private func segments(_ range: NSRange) -> [CGRect] {
    guard let textRange = textRange(range) else { return [] }
    var frames: [CGRect] = []
    layoutManager.enumerateTextSegments(in: textRange, type: .selection, options: .rangeNotRequired) {
      _, frame, _, _ in
      frames.append(frame)
      return true
    }
    return frames
  }

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
    guard
      let selection = layoutManager.textSelectionNavigation.textSelections(
        interactingAt: point, inContainerAt: layoutManager.documentRange.location, anchors: [], modifiers: [],
        selecting: false, bounds: .zero
      ).first,
      let location = selection.textRanges.first?.location
    else { return TextPosition(lastOffset) }
    return TextPosition(clamp(offset(location)))
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
    let caret = caretRect(for: TextPosition(focus))
    guard caret != .zero else { return }
    scrollRectToVisible(surface.convert(caret, to: self).insetBy(dx: 0, dy: -margin), animated: false)
  }

  // MARK: Hardware keyboard

  public override var keyCommands: [UIKeyCommand]? {
    func command(_ input: String, _ modifiers: UIKeyModifierFlags, _ action: Selector) -> UIKeyCommand {
      let command = UIKeyCommand(input: input, modifierFlags: modifiers, action: action)
      command.wantsPriorityOverSystemBehavior = true
      return command
    }
    return [
      command("\r", .shift, #selector(insertLineBreak)),
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
      command(UIKeyCommand.inputDelete, .alternate, #selector(deleteWordBackward)),
      command(UIKeyCommand.inputDelete, .command, #selector(deleteLineBackward)),
      command(Self.forwardDelete, [], #selector(deleteForward)),
      command(Self.forwardDelete, .alternate, #selector(deleteWordForward)),
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
    guard let location = location(focus), let fragment = layoutManager.textLayoutFragment(for: location) else {
      return nil
    }
    let start = offset(fragment.rangeInElement.location)
    let lines = fragment.textLineFragments
    guard
      let line = lines.first(where: { NSLocationInRange(focus - start, $0.characterRange) }) ?? lines.last
    else { return nil }
    if backward { return start + line.characterRange.location }
    let end = start + NSMaxRange(line.characterRange)
    let last = end > 0 ? (storage.string as NSString).character(at: end - 1) : 0
    return last == 0x0A || last == 0x2028 ? end - 1 : end
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
    case #selector(toggleBoldface(_:)), #selector(toggleItalics(_:)), #selector(toggleUnderline(_:)),
      #selector(selectAll(_:)):
      true
    case #selector(makeTextWritingDirectionLeftToRight(_:)), #selector(makeTextWritingDirectionRightToLeft(_:)):
      false
    default: super.canPerformAction(action, withSender: sender)
    }
  }

  public override func toggleBoldface(_ sender: Any?) { perform(.formatText(.bold), fromInput: false) }
  public override func toggleItalics(_ sender: Any?) { perform(.formatText(.italic), fromInput: false) }
  public override func toggleUnderline(_ sender: Any?) { perform(.formatText(.underline), fromInput: false) }
  public override func selectAll(_ sender: Any?) { perform(.selectAll, fromInput: false) }

  // MARK: Layout

  public override func layoutSubviews() {
    super.layoutSubviews()
    let width = max(bounds.width - 2 * margin, 0)
    if textContainer.size.width != width {
      textContainer.size = CGSize(width: width, height: 0)
    }
    layoutManager.textViewportLayoutController.layoutViewport()
  }

  /// Draws every fragment again, for colors that follow the appearance.
  private func redraw() {
    fragmentLayers = [:]
    layoutManager.textViewportLayoutController.layoutViewport()
  }

  /// The text's height as laid out so far, which TextKit estimates past the
  /// viewport.
  private func updateContentSize() {
    var height: CGFloat = 0
    layoutManager.enumerateTextLayoutFragments(
      from: layoutManager.documentRange.endLocation, options: [.reverse, .ensuresLayout]
    ) { fragment in
      height = fragment.layoutFragmentFrame.maxY
      return false
    }
    let visible = bounds.height - adjustedContentInset.top - adjustedContentInset.bottom
    // A tap anywhere below the text lands on the surface and puts the caret
    // at the end.
    let surfaceHeight = max(height, visible - 2 * margin)
    let frame = CGRect(x: margin, y: margin, width: textContainer.size.width, height: surfaceHeight)
    if surface.frame != frame { surface.frame = frame }
    let size = CGSize(width: bounds.width, height: surfaceHeight + 2 * margin)
    if contentSize != size { contentSize = size }
  }

  // MARK: Style

  /// Body text in the system font, formats as the web editor shows them.
  nonisolated public static func defaultStyle(_ blockType: String, _ format: TextFormat) -> [NSAttributedString.Key: Any] {
    let body = UIFont.preferredFont(forTextStyle: .body)
    var traits = body.fontDescriptor.symbolicTraits
    if format.contains(.bold) { traits.insert(.traitBold) }
    if format.contains(.italic) { traits.insert(.traitItalic) }
    var font =
      format.contains(.code)
      ? UIFont.monospacedSystemFont(ofSize: body.pointSize * 0.9, weight: traits.contains(.traitBold) ? .bold : .regular)
      : UIFont(descriptor: body.fontDescriptor.withSymbolicTraits(traits) ?? body.fontDescriptor, size: 0)
    let paragraph = NSMutableParagraphStyle()
    paragraph.paragraphSpacing = body.pointSize * 0.5
    var attributes: [NSAttributedString.Key: Any] = [.foregroundColor: UIColor.label, .paragraphStyle: paragraph]
    if format.contains(.subscript) || format.contains(.superscript) {
      font = font.withSize(font.pointSize * 0.75)
      attributes[.baselineOffset] = (format.contains(.superscript) ? 0.4 : -0.2) * body.pointSize
    }
    attributes[.font] = font
    if format.contains(.underline) { attributes[.underlineStyle] = NSUnderlineStyle.single.rawValue }
    if format.contains(.strikethrough) { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
    if format.contains(.code) { attributes[.backgroundColor] = UIColor.secondarySystemFill }
    if format.contains(.highlight) { attributes[.backgroundColor] = UIColor.systemYellow.withAlphaComponent(0.4) }
    return attributes
  }
}

extension EditorView: @preconcurrency NSTextViewportLayoutControllerDelegate {
  public func viewportBounds(for textViewportLayoutController: NSTextViewportLayoutController) -> CGRect {
    let visible = CGRect(origin: contentOffset, size: bounds.size).offsetBy(dx: -margin, dy: -margin)
    return visible.insetBy(dx: 0, dy: -bounds.height / 2)
  }

  public func textViewportLayoutControllerWillLayout(_ textViewportLayoutController: NSTextViewportLayoutController) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    surface.layer.sublayers?.filter { $0 is FragmentLayer }.forEach { $0.removeFromSuperlayer() }
  }

  public func textViewportLayoutController(
    _ textViewportLayoutController: NSTextViewportLayoutController,
    configureRenderingSurfaceFor textLayoutFragment: NSTextLayoutFragment
  ) {
    let id = ObjectIdentifier(textLayoutFragment)
    let layer = fragmentLayers[id] ?? FragmentLayer(textLayoutFragment, traits: traitCollection)
    layer.contentsScale = traitCollection.displayScale
    layer.place()
    fragmentLayers[id] = layer
    surface.layer.insertSublayer(layer, at: 0)
  }

  public func textViewportLayoutControllerDidLayout(_ textViewportLayoutController: NSTextViewportLayoutController) {
    let shown = Set((surface.layer.sublayers ?? []).compactMap { $0 as? FragmentLayer }.map(\.id))
    fragmentLayers = fragmentLayers.filter { shown.contains($0.key) }
    CATransaction.commit()
    updateContentSize()
  }
}

/// One laid-out paragraph, drawn by TextKit.
private final class FragmentLayer: CALayer {
  let fragment: NSTextLayoutFragment
  let traits: UITraitCollection

  var id: ObjectIdentifier { ObjectIdentifier(fragment) }

  init(_ fragment: NSTextLayoutFragment, traits: UITraitCollection) {
    self.fragment = fragment
    self.traits = traits
    super.init()
    setNeedsDisplay()
  }

  override init(layer: Any) {
    guard let layer = layer as? FragmentLayer else { fatalError("A FragmentLayer copies only its own kind") }
    fragment = layer.fragment
    traits = layer.traits
    super.init(layer: layer)
  }

  required init?(coder: NSCoder) { fatalError("FragmentLayer is made in code") }

  /// Sized to what the fragment draws, which can reach outside its frame,
  /// with the fragment's origin at the layer's.
  func place() {
    let surface = fragment.renderingSurfaceBounds
    bounds = surface
    anchorPoint = CGPoint(
      x: surface.width > 0 ? -surface.minX / surface.width : 0,
      y: surface.height > 0 ? -surface.minY / surface.height : 0)
    position = fragment.layoutFragmentFrame.origin
  }

  override func draw(in context: CGContext) {
    traits.performAsCurrent {
      UIGraphicsPushContext(context)
      fragment.draw(at: .zero, in: context)
      UIGraphicsPopContext()
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
