#if canImport(UIKit)
import EditorModelInterface
import UIKit

/// A document edited through an `EditorModel`. What UIKit's text input asks
/// for becomes the model's commands, and each command's changes are all the
/// view re-renders. TextKit 2 lays the text out and draws what is on screen.
///
/// Text an input method is still composing lives only here, over the
/// selection it replaces, and reaches the model as one `insertText` when it
/// is committed: the web editor saves the same document for a composition as
/// for typing its result, and history keeps it as one step.
public final class EditorView: UIScrollView, UITextInput {
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
    registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) { (view: EditorView, _) in
      guard view.composition == nil else { return }
      try? view.editText { try view.document.reload(view.storage) }
    }
    try? editText { try document.reload(storage) }
  }

  required init?(coder: NSCoder) { fatalError("EditorView is made in code") }

  // MARK: Commands

  /// Sends `command` to the model and shows what it changed. A command the
  /// model refuses leaves the document as it was, so there is nothing to show.
  /// UIKit's own input calls expect the text and selection they asked for
  /// without being told; anything else tells the input delegate.
  @discardableResult
  private func perform(_ command: EditorCommand, fromInput: Bool) -> Bool {
    let now = ProcessInfo.processInfo.systemUptime
    let elapsed = Int((now - lastCommand) * 1000)
    lastCommand = now
    if elapsed > 0 { _ = try? model.apply(.wait(milliseconds: elapsed)) }
    guard let change = try? model.apply(command) else { return false }
    if !fromInput { inputDelegate?.textWillChange(self) }
    do {
      try editText { try document.update(storage, after: change) }
    } catch {
      try? editText { try document.reload(storage) }
    }
    if !fromInput { inputDelegate?.textDidChange(self) }
    showModelSelection(fromInput: fromInput)
    return true
  }

  private func showModelSelection(fromInput: Bool) {
    guard let selection = try? model.selection(), let anchor = document.offset(of: selection.anchor),
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

  /// Text typed or pasted, each newline a new paragraph as Return makes.
  private func insert(_ text: String, fromInput: Bool) {
    let lines = text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline)
    for (index, line) in lines.enumerated() {
      if index > 0 { perform(.insertParagraph, fromInput: fromInput) }
      if !line.isEmpty || lines.count == 1 { perform(.insertText(String(line)), fromInput: fromInput) }
    }
  }

  private func editText(_ body: () throws -> Void) throws {
    var failure: (any Error)?
    contentStorage.performEditingTransaction {
      do { try body() } catch { failure = error }
    }
    setNeedsLayout()
    if let failure { throw failure }
  }

  // MARK: UIKeyInput

  public var hasText: Bool { storage.length > 1 }

  public func insertText(_ text: String) {
    if composition != nil { return commit(text) }
    insert(text, fromInput: true)
  }

  public func deleteBackward() {
    if composition != nil { unmarkText() }
    perform(.deleteCharacter(backward: true), fromInput: true)
  }

  public override var canBecomeFirstResponder: Bool { true }

  /// A model with no selection yet takes the view's, so typing has
  /// somewhere to go.
  public override func becomeFirstResponder() -> Bool {
    guard super.becomeFirstResponder() else { return false }
    if (try? model.selection()) == nil { sendSelection() }
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
    let replaced = selectedRange
    var composition =
      self.composition
      ?? Composition(replaced: replaced, original: storage.attributedSubstring(from: replaced), marked: replaced)
    var attributes = document.attributes(
      at: composition.replaced.location, format: (try? model.selection())?.format ?? [])
    attributes.merge(markedTextStyle ?? [.underlineStyle: NSUnderlineStyle.single.rawValue]) { $1 }
    let marked = composition.marked
    try? editText { storage.replaceCharacters(in: marked, with: NSAttributedString(string: text, attributes: attributes)) }
    composition.marked.length = text.utf16.count
    self.composition = composition
    let start = composition.marked.location + min(selectedRange.location, composition.marked.length)
    anchor = start
    focus = min(start + selectedRange.length, NSMaxRange(composition.marked))
    scrollToCaret()
  }

  public func unmarkText() {
    guard let composition else { return }
    commit(storage.attributedSubstring(from: composition.marked).string)
  }

  private func commit(_ text: String) {
    guard let composition else { return }
    self.composition = nil
    try? editText { storage.replaceCharacters(in: composition.marked, with: composition.original) }
    anchor = composition.replaced.location
    focus = NSMaxRange(composition.replaced)
    if text.isEmpty, composition.replaced.length == 0 { return }
    insert(text, fromInput: true)
  }

  // MARK: Selection

  private var selectedRange: NSRange { NSRange(location: min(anchor, focus), length: abs(focus - anchor)) }

  public var selectedTextRange: UITextRange? {
    get { TextRange(selectedRange) }
    set {
      guard let range = newValue as? TextRange else { return }
      let selected = wholeCharacters(range.range)
      guard composition != nil || selected != selectedRange else { return }
      anchor = selected.location
      focus = NSMaxRange(selected)
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
    if composition != nil { unmarkText() }
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

  public func setBaseWritingDirection(_ writingDirection: NSWritingDirection, for range: UITextRange) {}

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
      command("\u{8}", .alternate, #selector(deleteWordBackward)),
      command("\u{8}", .command, #selector(deleteLineBackward)),
      command(UIKeyCommand.inputDelete, [], #selector(deleteForward)),
      command(UIKeyCommand.inputDelete, .alternate, #selector(deleteWordForward)),
    ]
  }

  @objc private func insertLineBreak() { perform(.insertLineBreak, fromInput: false) }

  @objc private func moveLeft() {
    move(to: anchor == focus ? character(before: focus) : selectedRange.location, extending: false)
  }

  @objc private func moveRight() {
    move(to: anchor == focus ? character(after: focus) : NSMaxRange(selectedRange), extending: false)
  }

  @objc private func moveUp() { move(to: line(from: focus, .up) ?? 0, extending: false) }
  @objc private func moveDown() { move(to: line(from: focus, .down) ?? lastOffset, extending: false) }
  @objc private func extendLeft() { move(to: character(before: focus), extending: true) }
  @objc private func extendRight() { move(to: character(after: focus), extending: true) }
  @objc private func extendUp() { move(to: line(from: focus, .up) ?? 0, extending: true) }
  @objc private func extendDown() { move(to: line(from: focus, .down) ?? lastOffset, extending: true) }
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

  public override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
    switch action {
    case #selector(toggleBoldface(_:)), #selector(toggleItalics(_:)), #selector(toggleUnderline(_:)),
      #selector(selectAll(_:)), #selector(paste(_:)):
      true
    case #selector(copy(_:)), #selector(cut(_:)): anchor != focus
    default: super.canPerformAction(action, withSender: sender)
    }
  }

  public override func toggleBoldface(_ sender: Any?) { perform(.formatText(.bold), fromInput: false) }
  public override func toggleItalics(_ sender: Any?) { perform(.formatText(.italic), fromInput: false) }
  public override func toggleUnderline(_ sender: Any?) { perform(.formatText(.underline), fromInput: false) }
  public override func selectAll(_ sender: Any?) { perform(.selectAll, fromInput: false) }

  /// The selection as plain text, a line break a newline and whatever has
  /// no text left out.
  public override func copy(_ sender: Any?) {
    UIPasteboard.general.string = (storage.string as NSString).substring(with: selectedRange)
      .replacingOccurrences(of: "\u{2028}", with: "\n").replacingOccurrences(of: "\u{FFFC}", with: "")
  }

  public override func cut(_ sender: Any?) {
    copy(sender)
    perform(.deleteCharacter(backward: true), fromInput: false)
  }

  public override func paste(_ sender: Any?) {
    guard let text = UIPasteboard.general.string else { return }
    insert(text, fromInput: false)
  }

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
    let body = UIFont.preferredFont(forTextStyle: blockType == "heading" ? .title2 : .body)
    var traits = body.fontDescriptor.symbolicTraits
    if format.contains(.bold) || blockType == "heading" { traits.insert(.traitBold) }
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
#endif
