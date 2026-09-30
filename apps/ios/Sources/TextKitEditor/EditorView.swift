#if canImport(UIKit)
import CSSValues
import EditorModelInterface
import OSLog
import UIKit
import UIKit.UIGestureRecognizerSubclass
import UniformTypeIdentifiers

/// A document edited through an `EditorModel`. What UIKit's text input asks
/// for becomes the model's commands, and each command's changes are all the
/// view re-renders. TextKit 2 lays the text out and draws what is on screen,
/// a block at a time (`BlockLayout`).
///
/// Text an input method is still composing lives only here, over the
/// selection it replaces, and reaches the model as one `commitComposition`
/// when it is committed.
public final class EditorView: UIScrollView, UITextInput {
  private static let log = Logger(subsystem: "TextKitEditor", category: "EditorView")

  private let model: any EditorModel
  /// Whether the user may change the document. A view that isn't still
  /// becomes first responder, for its text to be selected and copied, but
  /// UIKit shows no keyboard for it, as `UITextInput.isEditable` asks, and
  /// it sends the model nothing that edits.
  public let isEditable: Bool
  /// App-owned insert actions for nodes whose views or uploaders live outside TextKit.
  public var insertionActions: [UIMenuElement] = [] {
    didSet { if isEditable, model.isEditable { formattingBar.update(format: modelSelection()?.format ?? []) } }
  }
  private lazy var formattingBar = EditorFormattingBar(
    format: { [weak self] in self?.formatText($0) },
    link: { [weak self] in self?.addLink() },
    undo: { [weak self] in self?.history.undo() },
    redo: { [weak self] in self?.history.redo() },
    menus: { [unowned self] in formattingMenus() })

  public override var inputAccessoryView: UIView? { isEditable && model.isEditable && model.supportsRichText ? formattingBar : nil }
  private let document: DocumentText
  private let storage = NSTextStorage()
  private let layout: BlockLayout
  private let typesetting: Typesetting
  private let suppliedStyle: DocumentText.Style?

  public var supportsRichText: Bool { model.supportsRichText }
  public var configureNestedEmbeds: ((EditorView) -> Void)?

  public func makeNestedEditor(model: any EditorModel, isEditable: Bool, textSize: CGFloat? = nil) -> EditorView {
    let style: DocumentText.Style?
    if let textSize {
      style = { [typesetting, suppliedStyle] block, format in
        var attributes = suppliedStyle?(block, format) ?? typesetting.attributes(StyledBlock(block), format)
        if let font = attributes[.font] as? UIFont { attributes[.font] = font.withSize(textSize) }
        return attributes
      }
    } else {
      style = suppliedStyle
    }
    let editor = EditorView(
      model: model, style: style, isEditable: isEditable,
      language: typesetting.language, font: typesetting.documentFont)
    editor.configureNestedEmbeds = configureNestedEmbeds
    editor.uploadImage = uploadImage
    configureNestedEmbeds?(editor)
    return editor
  }

  public func structuralNode(key: String) throws -> JSONValue {
    try model.node(at: model.nodePath(for: key))
  }

  /// A structural body's editing surface shares this document's model, so
  /// plugin operations that leave the body keep their true parent context.
  public func makeStructuralEditor(key: String, childPath: [Int] = []) throws -> EditorView {
    var path = try model.nodePath(for: key) + childPath
    var value = try model.node(at: path)
    while let children = value["children"]?.arrayValue, !children.isEmpty {
      path.append(0)
      value = children[0]
    }
    let editor = makeNestedEditor(model: model, isEditable: isEditable)
    let point = Point(path: path, offset: 0, type: value["text"] != nil ? .text : .element)
    editor.perform(.caret(point), fromInput: false)
    editor.onChange = { [weak self] in
      self?.render(nil)
      self?.onChange?()
    }
    return editor
  }

  /// The selection as UTF-16 offsets into the text; `focus` is the end that
  /// moves.
  private var anchor = 0
  private var focus = 0
  /// Where the model's caret sits at the root, between blocks, as the child
  /// it is before; a caret beside a table is drawn there, not in the text.
  private var caretBeforeBlock: Int?
  /// Whether the model's selection is of nodes, which the web outlines
  /// rather than highlighting their text.
  private var isNodeSelection = false
  private var composition: Composition?
  /// When the model last heard from the view, for the time its history
  /// merges edits by.
  private var lastCommand = ProcessInfo.processInfo.systemUptime

  /// Called after each call a keyboard's input method makes.
  public var onInput: ((TextInputRecord) -> Void)?
  /// An accepted change to stored content, including undo and redo.
  /// The owner can schedule autosave without exporting on every keystroke.
  public var onChange: (() -> Void)?

  public var embeddedElementTypes: Set<String> = [] {
    didSet {
      document.embeddedElementTypes = embeddedElementTypes
      render(nil)
    }
  }

  public func replaceEmbeddedNode(key: String, expected: JSONValue, replacement: JSONValue?) throws {
    guard isEditable else { throw EditorError.unsupported("This document cannot be edited") }
    let change = try model.replaceEmbeddedNode(key: key, expected: expected, replacement: replacement)
    render(change)
    if !change.changed.isEmpty { onChange?() }
  }

  public var embeddedContent: ((String, JSONValue) -> EmbeddedContentView?)? {
    didSet {
      layout.embeddedContent = embeddedContent
      render(nil)
    }
  }

  public var inlineEmbeddedContent: ((String, JSONValue, CGFloat) -> NSTextAttachment?)? {
    didSet { configureInlineAttachments() }
  }

  /// Optional platform decoder/rasterizer; the built-in raster loader is the default.
  public var mediaImageLoader: MediaImageLoader? {
    didSet { layout.mediaImageLoader = mediaImageLoader; configureInlineAttachments() }
  }

  private func configureInlineAttachments() {
    if inlineEmbeddedContent == nil && mediaImageLoader == nil { document.nativeAttachment = nil }
    else {
      document.nativeAttachment = { [weak self] node, path in
        guard let self, let key = nodeKey(at: path) else { return nil }
        if let view = inlineEmbeddedContent?(key, node, max(bounds.width - BlockLayout.margin * 2, 1)) { return view }
        guard let loader = mediaImageLoader, let payload = MediaPayload(node), ["image", "inline-image"].contains(payload.type) else { return nil }
        return MediaAttachment(payload, imageLoader: loader)
      }
    }
    render(nil)
  }
  public var onEmbeddedTap: ((String, JSONValue) -> Bool)?
  private var socialUserID: String?
  private var socialAuthor = "Guest"
  private var hasSocialProvider = false

  public func configureSocialNodes(userID: String?, author: String) {
    socialUserID = userID; socialAuthor = author
    if !hasSocialProvider {
      hasSocialProvider = true
      let previous = embeddedContent
      let previousTap = onEmbeddedTap
      onEmbeddedTap = { [weak self] key, node in
        if node["type"] == "footnote-reference", let label = node["label"]?.stringValue {
          self?.showFootnote(label); return true
        }
        return previousTap?(key, node) == true
      }
      embeddedContent = { [weak self] key, node in
        if let supplied = previous?(key, node) { return supplied }
        guard let self, node["type"] == "poll" else { return nil }
        return NativePollView(node, userID: socialUserID, editable: isEditable,
          changed: { [weak self] replacement in try self?.replaceEmbeddedNode(key: key, expected: node, replacement: replacement) },
          editOption: { [weak self] uid, text in self?.editPollOption(key: key, node: node, uid: uid, text: text) },
          failed: { [weak self] error in self?.showSocialError(error) })
      }
    } else { refreshEmbeddedContent() }
  }

  private func footnoteDefinition(_ label: String) -> (index: Int, node: JSONValue, number: Int)? {
    guard let keys = try? model.childKeys(at: []) else { return nil }
    var labels = Set<String>()
    for index in keys.indices {
      guard let node = try? model.nodeForPresentation(at: [index]), node["type"] == "footnote-definition", let storedLabel = node["label"]?.stringValue else { continue }
      labels.insert(storedLabel)
      if storedLabel == label { return (index, node, labels.count) }
    }
    return nil
  }

  private func showFootnote(_ label: String) {
    let definition = footnoteDefinition(label)
    let message: String
    if let definition, let text = try? model.nodeTextContent(at: [definition.index]) {
      message = JSRegExp(#"^\s+|\s+$"#, flags: "g").replacingMatches(in: text, with: "")
    } else { message = "This footnote has no definition." }
    let alert = UIAlertController(title: definition.map { "Footnote \($0.number)" } ?? "Footnote", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Done", style: .cancel))
    if definition != nil {
      alert.addAction(UIAlertAction(title: "Go to note", style: .default) { [weak self] _ in
        guard let self, let current = footnoteDefinition(label) else { return }
        goToFootnotePoint(Point(path: [current.index], offset: 0, type: .element))
      })
    }
    presenter?.present(alert, animated: true)
  }

  private func goToFootnotePoint(_ point: Point) {
    _ = perform(.caret(point), fromInput: false)
    scrollToCaret()
  }

  private func followFootnoteBacklink(_ label: String) {
    func reference(_ node: JSONValue, at path: [Int]) -> Point? {
      if node["type"] == "footnote-reference", node["label"] == .string(label), let index = path.last {
        return Point(path: Array(path.dropLast()), offset: index, type: .element)
      }
      for (index, child) in (node["children"]?.arrayValue ?? []).enumerated() {
        if let result = reference(child, at: path + [index]) { return result }
      }
      return nil
    }
    if let state = try? model.serializedState(), let root = state["root"], let point = reference(root, at: []) { goToFootnotePoint(point) }
  }

  @discardableResult public func insertPoll(question: String) -> Bool {
    guard isEditable, JSRegExp(#"^\s*$"#, flags: "").firstMatch(in: question) == nil,
      var node = try? JSONValue(parsing: WebPollStyle.insertionNodeJSON).objectValue,
      let defaults = node["options"]?.arrayValue else { return false }
    node["question"] = .string(question)
    node["options"] = .array(defaults.map { option in
      var fields = option.objectValue!; fields["uid"] = .string(UUID().uuidString)
      return .object(fields)
    })
    let clipboard = Clipboard(plainText: "", lexical: LexicalClipboardPayload(namespace: MediaLinks.namespace, nodes: [.object(node)]))
    return perform(.paste(clipboard), fromInput: false, tellsRefusal: true) != nil
  }

  public var socialInsertionActions: [UIMenuElement] {
    [UIAction(title: "Poll", image: UIImage(systemName: "chart.bar")) { [weak self] _ in
      guard let self, isEditable else { return }
      let alert = UIAlertController(title: "Insert poll", message: "Question", preferredStyle: .alert)
      alert.addTextField()
      alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
      let insert = UIAlertAction(title: "Insert", style: .default) { [weak self, weak alert] _ in
        guard let question = alert?.textFields?.first?.text else { return }
        self?.insertPoll(question: question)
      }
      insert.isEnabled = false
      alert.textFields?.first?.addAction(UIAction { [weak insert] action in
        guard let field = action.sender as? UITextField else { return }
        insert?.isEnabled = JSRegExp(#"^\s*$"#, flags: "").firstMatch(in: field.text ?? "") == nil
      }, for: .editingChanged)
      alert.addAction(insert)
      presenter?.present(alert, animated: true)
    }]
  }

  private func showSocialError(_ error: any Error) {
    let message: String
    switch error {
    case EditorError.unsupported(let reason), EditorError.invalidState(let reason): message = reason
    default: message = error.localizedDescription
    }
    let alert = UIAlertController(title: "Couldn’t update poll", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    presenter?.present(alert, animated: true)
  }

  private func editPollOption(key: String, node: JSONValue, uid: String, text: String) {
    guard isEditable else { return }
    let alert = UIAlertController(title: "Edit option", message: nil, preferredStyle: .alert)
    alert.addTextField { $0.text = text }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Save", style: .default) { [weak self, weak alert] _ in
      guard let self, let text = alert?.textFields?.first?.text, var fields = node.objectValue,
        var options = node["options"]?.arrayValue, let index = options.firstIndex(where: { $0["uid"] == .string(uid) }),
        var option = options[index].objectValue else { return }
      option["text"] = .string(text); options[index] = .object(option); fields["options"] = .array(options)
      do { try replaceEmbeddedNode(key: key, expected: node, replacement: .object(fields)) }
      catch { showSocialError(error) }
    })
    presenter?.present(alert, animated: true)
  }
  private var inlineWidth: CGFloat = 0
  /// Floats retain their node in the text's selection tree, with their native
  /// content positioned in document coordinates independently of block flow.
  public var floatingEmbeddedTypes: Set<String> = [] {
    didSet { updateFloatingTypes() }
  }
  public var floatingEmbeddedMinimumWidth: CGFloat = 0 { didSet { updateFloatingTypes() } }
  private func updateFloatingTypes() {
    let active: Set<String> = isEditable && bounds.width > floatingEmbeddedMinimumWidth ? floatingEmbeddedTypes : []
    guard document.floatingEmbeddedTypes != active else { return }
    document.floatingEmbeddedTypes = active
    render(nil)
  }
  public var floatingEmbeddedFrame: ((JSONValue, CGFloat) -> CGRect?)? { didSet { setNeedsLayout() } }
  private var floatingViews: [String: EmbeddedContentView] = [:]
  private func layoutFloatingContent() {
    guard let frame = floatingEmbeddedFrame, let provider = embeddedContent else { return }
    var visible: Set<String> = []
    let viewport = surface.convert(bounds, from: self).insetBy(dx: -192, dy: -192)
    for floating in document.floatingNodes {
      guard let rect = frame(floating.node, surface.bounds.width), rect.intersects(viewport) else { continue }
      let content: EmbeddedContentView
      if let existing = floatingViews[floating.key] {
        content = existing
      } else {
        guard let supplied = provider(floating.key, floating.node) else { continue }
        content = supplied
        floatingViews[floating.key] = content
        surface.addSubview(content)
      }
      content.show(floating.node)
      var positioned = rect
      positioned.size.height = max(rect.height, content.contentSize(fitting: rect.width).height)
      content.frame = positioned
      surface.bringSubviewToFront(content)
      visible.insert(floating.key)
    }
    for key in Array(floatingViews.keys) where !visible.contains(key) {
      floatingViews.removeValue(forKey: key)?.removeFromSuperview()
    }
  }

  public func refreshEmbeddedContent() {
    render(nil)
    setNeedsLayout()
  }

  private func nodeKey(at path: [Int]) -> String? {
    guard let index = path.last, let keys = try? model.childKeys(at: Array(path.dropLast())),
      keys.indices.contains(index)
    else { return nil }
    return keys[index]
  }

  /// Inserts a decorator through the existing clipboard command and opens
  /// only the new node, without mistaking an older drawing for it.
  public func insertEmbeddedNode(_ node: JSONValue, namespace: String, openAfterInsertion: Bool = true) {
    guard isEditable else { return }
    var before = Set<String>()
    var pending: [[Int]] = [[]]
    while let path = pending.popLast() {
      guard let keys = try? model.childKeys(at: path) else { continue }
      for (index, key) in keys.enumerated() {
        before.insert(key)
        pending.append(path + [index])
      }
    }
    let clipboard = Clipboard(plainText: "", lexical: LexicalClipboardPayload(namespace: namespace, nodes: [node]))
    guard let change = perform(.paste(clipboard), fromInput: false, tellsRefusal: true) else { return }
    guard openAfterInsertion else { return }
    for path in change.changed.sorted(by: { $0.count > $1.count }) {
      guard let key = nodeKey(at: path), !before.contains(key),
        let inserted = try? model.nodeForPresentation(at: path), inserted["type"] == node["type"] else { continue }
      _ = onEmbeddedTap?(key, inserted)
      return
    }
  }

  @discardableResult private func openSelectedCodeSource() -> Bool {
    guard let selection = modelSelection(), !selection.anchor.path.isEmpty else { return false }
    var path = selection.anchor.path
    while !path.isEmpty {
      if let node = try? model.nodeForPresentation(at: path), node["type"] == "code", selection.focus.path.starts(with: path), let key = nodeKey(at: path) {
        return onEmbeddedTap?(key, node) == true
      }
      path.removeLast()
    }
    return false
  }

  public func formatCode() {
    if openSelectedCodeSource() { return }
    unmarkText()
    perform(.formatCode, fromInput: false, tellsRefusal: true)
  }

  public func replaceRenderedNode(key: String, expected: JSONValue, replacement: JSONValue) throws {
    guard isEditable else { throw EditorError.unsupported("This document is read only") }
    let change = try model.replaceRenderedNode(key: key, expected: expected, replacement: replacement)
    inputDelegate?.textWillChange(self)
    render(change)
    inputDelegate?.textDidChange(self)
    showModelSelection(fromInput: false)
    if !change.changed.isEmpty { onChange?() }
  }

  /// Commits a drawing edit through the document's history and rendering.
  public func replaceDrawing(key: String, expectedData: String, data: String?) throws {
    guard isEditable else { throw EditorError.unsupported("This document is read only") }
    let change = try model.replaceDrawing(key: key, expectedData: expectedData, data: data)
    inputDelegate?.textWillChange(self)
    render(change)
    inputDelegate?.textDidChange(self)
    showModelSelection(fromInput: false)
    if !change.changed.isEmpty { onChange?() }
  }

  /// Provided by the account-backed document screen; absent in disposable harnesses.
  public var uploadImage: (@MainActor (Data) async throws -> URL)?
  private var imagePicker: NativeImagePicker?

  public weak var inputDelegate: (any UITextInputDelegate)?
  public var markedTextStyle: [NSAttributedString.Key: Any]?
  public private(set) lazy var tokenizer: any UITextInputTokenizer = UITextInputStringTokenizer(textInput: self)

  /// `style` sets the text's attributes in place of the web's typography.
  public init(
    model: any EditorModel, style: DocumentText.Style? = nil, isEditable: Bool = true,
    language: String? = nil, font: DocumentFont? = nil
  ) {
    self.model = model
    suppliedStyle = style
    self.isEditable = isEditable
    let typesetting = Typesetting(.web)
    typesetting.language = language
    typesetting.documentFont = font
    self.typesetting = typesetting
    document = DocumentText(
      model: model, style: style ?? { typesetting.attributes(StyledBlock($0), $1) }, standIn: BlockLayout.standIn)
    document.footnoteSectionTitle = WebFootnoteStyle.titles[language?.lowercased().split(separator: "-").first.map(String.init) ?? ""] ?? WebFootnoteStyle.titles[""]!
    layout = BlockLayout(storage: storage, document: document, typesetting: typesetting)
    super.init(frame: .zero)
    backgroundColor = .systemBackground
    alwaysBounceVertical = true
    keyboardDismissMode = .interactive
    addSubview(surface)

    let interaction = UITextInteraction(for: isEditable ? .editable : .nonEditable)
    interaction.textInput = self
    surface.addInteraction(interaction)
    // A tap on a checklist item's box toggles it and leaves the caret be.
    let checkboxTap = CheckboxTap(target: self, action: #selector(toggleChecked(_:)))
    checkboxTap.isOnCheckbox = { [unowned self] in layout.checklistItem(at: $0) != nil }
    surface.addGestureRecognizer(checkboxTap)
    for gesture in interaction.gesturesForFailureRequirements { gesture.require(toFail: checkboxTap) }
    surface.addGestureRecognizer(tableSelectionPress)
    for gesture in interaction.gesturesForFailureRequirements { gesture.require(toFail: tableSelectionPress) }
    surface.addInteraction(linkMenu)
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    tap.delegate = self
    surface.addGestureRecognizer(tap)
    isAccessibilityElement = true
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: EditorView, _) in
      if view.inlineEmbeddedContent != nil { view.render(nil) }
      else { view.layout.redraw() }
    }
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
  /// model refuses leaves the document as it was, so there is nothing to show,
  /// though where `tellsRefusal` the user is told why.
  /// UIKit's own input calls expect the text and selection they asked for
  /// without being told; anything else tells the input delegate. Returns
  /// what the command changed, where the model took it.
  @discardableResult
  private func perform(_ command: EditorCommand, fromInput: Bool, tellsRefusal: Bool = false) -> ChangeSet? {
    guard isEditable || !command.edits else { return nil }
    switch command {
    case .insertText, .commitComposition, .deleteCharacter, .deleteWord, .deleteLine, .insertParagraph, .insertLineBreak, .formatText, .tab:
      if openSelectedCodeSource() { return nil }
    default: break
    }
    let command: EditorCommand = {
      if !isEditable, case .arrow(_, let extend, let native, _, _, _) = command {
        return .setSelection(anchor: extend ? modelSelection()?.anchor ?? native : native, focus: native)
      }
      return command
    }()
    // A model left with no selection takes the view's before an edit.
    if command.editsAtSelection, modelSelection() == nil { sendSelection() }
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
      if tellsRefusal { tell(refusal: what) }
      return nil
    } catch {
      failed("The model refused \(command.name)", error)
      return nil
    }
    if !fromInput { inputDelegate?.textWillChange(self) }
    render(change)
    if !fromInput { inputDelegate?.textDidChange(self) }
    showModelSelection(fromInput: fromInput)
    if isEditable && !change.changed.isEmpty { onChange?() }
    return change
  }

  /// Something the view relies on the model for went wrong: a bug in one or
  /// the other, so it stops a debug build.
  private func failed(_ what: String, _ error: any Error) {
    Self.log.fault("\(what, privacy: .public): \(String(describing: error), privacy: .public)")
    assertionFailure("\(what): \(error)")
  }

  /// Brings the text up to date with `change`, or renders it afresh.
  private func render(_ change: ChangeSet?) {
    typesetting.withFontMetrics {
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
    let selection = modelSelection()
    if isEditable, model.isEditable { formattingBar.update(format: selection?.format ?? []) }
    let cells = selection.flatMap(selectedCells)
    if selection == nil, layout.tableSelection != nil {
      if !fromInput { inputDelegate?.selectionWillChange(self) }
      anchor = focus
      if !fromInput { inputDelegate?.selectionDidChange(self) }
    }
    layout.tableSelection = cells
    isNodeSelection = if case .node = selection { true } else { false }
    layout.selectedRules = selection.map(selectedRules) ?? []
    layout.selectedCharacters = selection.map(selectedCharacters) ?? []
    guard let selection, let (anchor, focus) = offsets(of: selection) else { return }
    if !fromInput { inputDelegate?.selectionWillChange(self) }
    self.anchor = anchor
    self.focus = focus
    caretBeforeBlock = selection.isCollapsed && selection.focus.path.isEmpty ? selection.focus.offset : nil
    if !fromInput { inputDelegate?.selectionDidChange(self) }
    scrollToCaret()
  }

  /// Where the view has `selection`. Selected cells run from the start of
  /// the first of the anchor and focus cells to the end of the other, where
  /// their handles are.
  private func offsets(of selection: Selection) -> (anchor: Int, focus: Int)? {
    // Selected nodes have no caret, so the view selects the first one's text.
    if case .node(let nodes) = selection {
      guard let first = nodes.first, let range = document.range(of: first) else { return nil }
      return (range.location, NSMaxRange(range))
    }
    guard case .table(_, let anchorCell, let focusCell, _) = selection else {
      guard let anchor = document.offset(of: selection.anchor), let focus = document.offset(of: selection.focus) else {
        return nil
      }
      return (anchor, focus)
    }
    guard let anchor = document.range(of: anchorCell), let focus = document.range(of: focusCell) else { return nil }
    return anchor.location <= focus.location
      ? (anchor.location, NSMaxRange(focus)) : (NSMaxRange(anchor), focus.location)
  }

  /// The table block a table selection is in, and the cells it has.
  private func selectedCells(_ selection: Selection) -> (block: Int, cells: Set<TableView.CellIndex>)? {
    guard case .table(let path, _, _, let cells) = selection, path.count == 1, path[0] < document.blockCount,
      case .table = document.kind(ofBlock: path[0])
    else { return nil }
    return (path[0], Set(cells.filter { $0.count == 3 }.map { TableView.CellIndex(row: $0[1], index: $0[2]) }))
  }

  /// The rule blocks among the nodes a node selection has.
  private func selectedRules(_ selection: Selection) -> Set<Int> {
    guard case .node(let nodes) = selection else { return [] }
    return Set(
      nodes.compactMap { path in
        guard path.count == 1, path[0] < document.blockCount,
          document.kind(ofBlock: path[0]) == .embedded(type: StyledBlock.ruleType)
        else { return nil }
        return path[0]
      })
  }

  /// Where the nodes a node selection has stand in a line of text, as the
  /// one character each is there.
  private func selectedCharacters(_ selection: Selection) -> Set<Int> {
    guard case .node(let nodes) = selection else { return [] }
    let text = storage.string as NSString
    return Set(
      nodes.compactMap { path in
        guard path.count > 1, let range = document.range(of: path), range.length == 1,
          text.character(at: range.location) == 0xFFFC
        else { return nil }
        return range.location
      })
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
    guard let selection = modelSelection(), let offsets = offsets(of: selection), offsets == (anchor, focus) else {
      return sendSelection()
    }
  }

  /// Text typed, pasted or `composed`, each newline a new paragraph as
  /// Return makes.
  private func insert(_ text: String, fromInput: Bool, composed: Bool = false) {
    let lines = text.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline)
    for (index, line) in lines.enumerated() {
      if index > 0 { perform(.insertParagraph, fromInput: fromInput) }
      guard !line.isEmpty || lines.count == 1 else { continue }
      let isCommit = composed && index == lines.count - 1
      perform(isCommit ? .commitComposition(String(line)) : .insertText(String(line)), fromInput: fromInput)
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
    // Selected nodes have no caret to compose at, as a browser shows none.
    if isNodeSelection, composition == nil { return report(.setMarkedText(text, selectedRange: selectedRange)) }
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
    insert(text, fromInput: true, composed: true)
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
      guard composition != nil || snapped != selected || caretBeforeBlock != nil else { return }
      caretBeforeBlock = nil
      anchor = snapped.location
      focus = NSMaxRange(snapped)
      if composition == nil { sendSelection() }
      scrollToCaret()
    }
  }

  /// Moves the caret by keyboard, or extends the selection's moving end.
  private func move(to offset: Int, extending: Bool) {
    caretBeforeBlock = nil
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
    caretBeforeBlock = nil
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
  {
    guard let position = position as? TextPosition else { return .natural }
    var path = document.point(at: position.offset).path
    while !path.isEmpty {
      if let direction = (try? model.node(at: path))?["direction"]?.stringValue {
        return direction == "rtl" ? .rightToLeft : .leftToRight
      }
      path.removeLast()
    }
    // Reporting resolved LTR/RTL here makes UIKit apply an explicit override while typing.
    // Arrow handling reads the resolved layout separately.
    return .natural
  }

  public func setBaseWritingDirection(_ writingDirection: NSWritingDirection, for range: UITextRange) {
    // UIKit reapplies the inferred direction when typing replaces a selection.
    // Preserve automatic mode when this does not change how the paragraph reads.
    if writingDirection != .natural,
      baseWritingDirection(for: range.start, in: .forward) == .natural,
      let range = range as? TextRange,
      layout.writingDirection(at: range.range.location) == writingDirection
    { return }
    setWritingDirection(writingDirection, for: range)
  }

  private func setWritingDirection(_ writingDirection: NSWritingDirection, for range: UITextRange) {
    guard let range = range as? TextRange else { return }
    perform(.setSelection(anchor: document.point(at: range.range.location), focus: document.point(at: NSMaxRange(range.range))), fromInput: false)
    let direction: EditorCommand.WritingDirection = writingDirection == .natural ? .auto : writingDirection == .rightToLeft ? .rtl : .ltr
    perform(.setWritingDirection(direction), fromInput: false)
  }

  private static let newline = "\n".utf16.first!

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
    guard let position = position as? TextPosition else { return .zero }
    if let caretBeforeBlock, anchor == focus, position.offset == focus,
      let caret = layout.caret(beforeBlock: caretBeforeBlock)
    {
      return caret
    }
    guard let frame = segments(NSRange(location: clamp(position.offset), length: 0)).first else { return .zero }
    return CGRect(x: frame.minX, y: frame.minY, width: 2, height: frame.height)
  }

  /// Selected table cells are tinted instead, as on the web, with a handle
  /// at each end.
  public func selectionRects(for range: UITextRange) -> [UITextSelectionRect] {
    guard let range = range as? TextRange else { return [] }
    if isNodeSelection { return [] }
    if layout.tableSelection != nil {
      let ends = [range.range.location, NSMaxRange(range.range)].compactMap {
        segments(NSRange(location: $0, length: 0)).first
      }
      guard ends.count == 2 else { return [] }
      return [
        SelectionRect(ends[0], containsStart: true, containsEnd: false),
        SelectionRect(ends[1], containsStart: false, containsEnd: true),
      ]
    }
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
    let offset = position.offset
    // The newline ending a block or a cell isn't where a tap lands: UIKit
    // would put the caret past it, in what comes next.
    if offset < storage.length, (storage.string as NSString).character(at: offset) == Self.newline {
      let start = character(before: offset)
      let isLineStart = start == offset || (storage.string as NSString).character(at: start) == Self.newline
      return TextRange(NSRange(location: isLineStart ? offset : start, length: isLineStart ? 0 : offset - start))
    }
    let end = character(after: offset)
    return TextRange(NSRange(location: offset, length: end - offset))
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
      command(UIKeyCommand.inputLeftArrow, [.command, .shift], #selector(extendToLineStart)),
      command(UIKeyCommand.inputRightArrow, .command, #selector(moveToLineEnd)),
      command(UIKeyCommand.inputRightArrow, [.command, .shift], #selector(extendToLineEnd)),
    ]
    guard isEditable else { return moves }
    return moves + [
      command("\r", .shift, #selector(insertLineBreak)),
      command(UIKeyCommand.inputDelete, .alternate, #selector(deleteWordBackward)),
      command(UIKeyCommand.inputDelete, .command, #selector(deleteLineBackward)),
      command(Self.forwardDelete, [], #selector(deleteForward)),
      command(Self.forwardDelete, .alternate, #selector(deleteWordForward)),
      command("\t", [], #selector(tab)),
      command("\t", .shift, #selector(tabBackward)),
    ] + webKeyboardShortcuts.compactMap { binding in
      guard binding.action.isImplemented else { return nil }
      let key = command(binding.input, binding.modifiers, #selector(performWebShortcut(_:)))
      key.allowsAutomaticMirroring = false
      return key
    }
  }

  /// What the Forward Delete key gives; `UIKeyCommand.inputDelete` is
  /// Backspace.
  private static let forwardDelete = "\u{7F}"

  @objc private func insertLineBreak() { perform(.insertLineBreak, fromInput: false) }

  @objc private func moveLeft() {
    arrow(.left, extend: false, to: anchor == focus ? character(before: focus) : selected.location)
  }

  @objc private func moveRight() {
    arrow(.right, extend: false, to: anchor == focus ? character(after: focus) : NSMaxRange(selected))
  }

  @objc private func moveUp() { arrow(.up, extend: false, to: line(from: focus, .up) ?? 0) }
  @objc private func moveDown() { arrow(.down, extend: false, to: line(from: focus, .down) ?? lastOffset) }
  @objc private func extendLeft() { arrow(.left, extend: true, to: character(before: focus)) }
  @objc private func extendRight() { arrow(.right, extend: true, to: character(after: focus)) }
  @objc private func extendUp() { arrow(.up, extend: true, to: line(from: focus, .up) ?? 0) }
  @objc private func extendDown() { arrow(.down, extend: true, to: line(from: focus, .down) ?? lastOffset) }

  /// An arrow key, which the model answers as Lexical does, given `offset`,
  /// where the platform would move the focus. A model that can't edit the
  /// document can't move its selection either, so the view moves its own.
  private func arrow(_ key: ArrowKey, extend: Bool, to offset: Int) {
    guard model.isEditable else { return move(to: offset, extending: extend) }
    let atCellEdge =
      switch key {
      case .up: layout.isAtCellEdge(focus, .up)
      case .down: layout.isAtCellEdge(focus, .down)
      case .left, .right: false
      }
    let native = document.point(at: clamp(offset))
    let selection = try? model.selection()
    let path: [Int]
    if case .node(let nodes) = selection { path = nodes.first ?? [] } else { path = selection?.anchor.path ?? [] }
    let parent = Array(path.dropLast())
    var parentRTL = false
    if !parent.isEmpty, let range = document.range(of: parent), range.length > 0 {
      parentRTL = layout.writingDirection(at: range.location) == .rightToLeft
      var ancestor = parent
      while !ancestor.isEmpty {
        if let direction = (try? model.node(at: ancestor))?["direction"]?.stringValue {
          parentRTL = direction == "rtl"
          break
        }
        ancestor.removeLast()
      }
    }
    var anchorRTL = parentRTL
    if case .range(let anchor, _, _, _) = selection {
      anchorRTL = !anchor.path.isEmpty && layout.writingDirection(at: document.offset(of: anchor) ?? focus) == .rightToLeft
    }
    perform(.arrow(key, extend: extend, native: native, atCellEdge: atCellEdge, parentRTL: parentRTL, anchorRTL: anchorRTL), fromInput: false)
  }
  @objc private func extendToLineStart() { move(to: lineBoundary(backward: true) ?? focus, extending: true) }
  @objc private func moveToLineStart() { move(to: lineBoundary(backward: true) ?? focus, extending: false) }
  @objc private func extendToLineEnd() { move(to: lineBoundary(backward: false) ?? focus, extending: true) }
  @objc private func moveToLineEnd() { move(to: lineBoundary(backward: false) ?? focus, extending: false) }
  @objc private func deleteWordBackward() { perform(.deleteWord(backward: true), fromInput: false) }
  @objc private func deleteWordForward() { perform(.deleteWord(backward: false), fromInput: false) }
  @objc private func deleteForward() { perform(.deleteCharacter(backward: false), fromInput: false) }
  @objc private func tab() { perform(.tab(backward: false), fromInput: false) }
  @objc private func tabBackward() { perform(.tab(backward: true), fromInput: false) }

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
    case #selector(copy(_:)): selected.length > 0
    case #selector(cut(_:)): isEditable && selected.length > 0
    case #selector(paste(_:)):
      isEditable && (pasteboard.hasStrings || pasteboard.contains(pasteboardTypes: [LexicalClipboardPayload.mimeType]))
    case #selector(makeTextWritingDirectionLeftToRight(_:)), #selector(makeTextWritingDirectionRightToLeft(_:)):
      isEditable
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

  private func formattingMenus() -> (block: UIMenu, lists: UIMenu, insert: UIMenu) {
    let selection = modelSelection()
    var path = selection?.anchor.path ?? []
    var selectedType: String?
    while !path.isEmpty {
      if let node = try? model.node(at: path) {
        if node["type"] == "list" { selectedType = node["listType"]?.stringValue; break }
        if let type = node["type"]?.stringValue, type == "code" || BlockType(rawValue: type) != nil {
          selectedType = type
        } else if node["type"] == "heading" { selectedType = node["tag"]?.stringValue }
      }
      path.removeLast()
    }
    let choices = webBlockChoices.map { choice in
      let supported = choice.type == "code" || BlockType(rawValue: choice.type) != nil || EditorCommand.ListType(rawValue: choice.type) != nil
      return UIAction(title: choice.label, attributes: supported ? [] : .disabled,
        state: choice.type == selectedType ? .on : .off) { [weak self] _ in
        guard let self else { return }
        unmarkText()
        if let list = EditorCommand.ListType(rawValue: choice.type) {
          if selectedType == choice.type { removeList() } else { insertList(list) }
        } else if choice.type == "code" { formatCode() }
        else if let block = BlockType(rawValue: choice.type) { setBlockType(block) }
      }
    }
    return (
      UIMenu(title: "Block type", children: choices.filter { action in
        !webBlockChoices.contains { $0.label == action.title && EditorCommand.ListType(rawValue: $0.type) != nil }
      } + [UIMenu(title: "Alignment", children: EditorCommand.ElementAlignment.allCases.map { alignment in
        UIAction(title: alignment.rawValue.capitalized) { [weak self] _ in
          guard let self else { return }
          unmarkText()
          _ = perform(.formatElement(alignment), fromInput: false, tellsRefusal: true)
        }
      }), UIMenu(title: "Text formatting", children: [
        UIAction(title: "Increase font size") { [weak self] _ in
          guard let self else { return }; unmarkText()
          _ = perform(.changeFontSize(increase: true), fromInput: false, tellsRefusal: true)
        },
        UIAction(title: "Decrease font size") { [weak self] _ in
          guard let self else { return }; unmarkText()
          _ = perform(.changeFontSize(increase: false), fromInput: false, tellsRefusal: true)
        },
        UIAction(title: "Clear formatting") { [weak self] _ in
          guard let self else { return }; unmarkText()
          _ = perform(.clearFormatting, fromInput: false, tellsRefusal: true)
        },
      ])]),
      UIMenu(title: "Lists", children: choices.filter { action in
        webBlockChoices.contains { $0.label == action.title && EditorCommand.ListType(rawValue: $0.type) != nil }
      }),
      UIMenu(title: "Insert", children: [tableMenu()] + insertionActions))
  }

  @objc private func performWebShortcut(_ key: UIKeyCommand) {
    guard let binding = webKeyboardShortcuts.first(where: { $0.input == key.input && $0.modifiers == key.modifierFlags }) else {
      preconditionFailure("A web shortcut without a generated binding")
    }
    unmarkText()
    switch binding.action {
    case .formatParagraph: setBlockType(.paragraph)
    case .formatHeading:
      guard let type = BlockType(rawValue: "h\(binding.input)") else { preconditionFailure("Unknown generated heading shortcut") }
      setBlockType(type)
    case .formatQuote: setBlockType(.quote)
    case .formatBulletList: toggleList(.bullet)
    case .formatNumberedList: toggleList(.number)
    case .formatCheckList: toggleList(.check)
    case .lowercase: formatText(.lowercase)
    case .uppercase: formatText(.uppercase)
    case .capitalize: formatText(.capitalize)
    case .strikeThrough: formatText(.strikethrough)
    case .indent: indent()
    case .outdent: outdent()
    case .subscript: formatText(.subscript)
    case .superscript: formatText(.superscript)
    case .insertCodeBlock: formatText(.code)
    case .insertLink: linkFromKeyboard()
    case .centerAlign: _ = perform(.formatElement(.center), fromInput: false, tellsRefusal: true)
    case .leftAlign: _ = perform(.formatElement(.left), fromInput: false, tellsRefusal: true)
    case .rightAlign: _ = perform(.formatElement(.right), fromInput: false, tellsRefusal: true)
    case .justifyAlign: _ = perform(.formatElement(.justify), fromInput: false, tellsRefusal: true)
    case .increaseFontSize: _ = perform(.changeFontSize(increase: true), fromInput: false, tellsRefusal: true)
    case .decreaseFontSize: _ = perform(.changeFontSize(increase: false), fromInput: false, tellsRefusal: true)
    case .clearFormatting: _ = perform(.clearFormatting, fromInput: false, tellsRefusal: true)
    case .formatCode: formatCode()
    }
  }

  private func toggleList(_ type: EditorCommand.ListType) {
    var path = modelSelection()?.anchor.path ?? []
    while !path.isEmpty {
      if let node = try? model.node(at: path), node["type"] == "list" {
        if node["listType"]?.stringValue == type.rawValue { removeList(); return }
        break
      }
      path.removeLast()
    }
    insertList(type)
  }

  /// The edit menu with the link actions for the range, and a Table menu
  /// where the document can be edited: the web's insert-table dialog, or its
  /// table menu's row and column actions in a table. They follow UIKit's
  /// cut, copy and paste, as Link follows the web context menu's clipboard
  /// actions; at the end, a narrow screen's menu pages them out of sight, or
  /// its list runs them under the keyboard.
  public func editMenu(for textRange: UITextRange, suggestedActions: [UIMenuElement]) -> UIMenu? {
    guard let range = textRange as? TextRange else { return nil }
    let own = linkActions(in: range.range) + (isEditable ? [writingDirectionMenu(for: textRange), tableMenu()] + (uploadImage == nil ? [] : [imageMenu()]) : [])
    func withoutSystemDirection(_ elements: [UIMenuElement]) -> [UIMenuElement] {
      elements.compactMap { element in
        guard let menu = element as? UIMenu else { return element }
        if menu.identifier == .writingDirection { return nil }
        return menu.replacingChildren(withoutSystemDirection(menu.children))
      }
    }
    var children = withoutSystemDirection(suggestedActions)
    let clipboard = children.firstIndex { ($0 as? UIMenu)?.identifier == .standardEdit }
    children.insert(contentsOf: own, at: clipboard.map { $0 + 1 } ?? children.endIndex)
    return UIMenu(children: children)
  }

  public override func makeTextWritingDirectionLeftToRight(_ sender: Any?) {
    guard let range = selectedTextRange else { return }
    setWritingDirection(.leftToRight, for: range)
  }

  public override func makeTextWritingDirectionRightToLeft(_ sender: Any?) {
    guard let range = selectedTextRange else { return }
    setWritingDirection(.rightToLeft, for: range)
  }

  /// Actions the native formatting bar can include in its insertion menu.
  public var imageInsertionActions: [UIMenuElement] {
    isEditable && uploadImage != nil ? imageMenu().children : []
  }

  private func imageMenu() -> UIMenu {
    let enabled = uploadImage != nil
    return UIMenu(title: "Image", children: [
      UIAction(title: "Choose from Photos…", image: UIImage(systemName: "photo"), attributes: enabled ? [] : .disabled) { [weak self] _ in self?.chooseImage(camera: false) },
      UIAction(title: "Take Photo…", image: UIImage(systemName: "camera"), attributes: enabled && UIImagePickerController.isSourceTypeAvailable(.camera) ? [] : .disabled) { [weak self] _ in self?.chooseImage(camera: true) },
    ])
  }

  /// Inserts a media payload through the same model transaction as rich paste.
  @discardableResult public func insertMedia(_ node: JSONValue) -> Bool {
    guard MediaPayload(node) != nil else { return false }
    return perform(.paste(Clipboard(plainText: "", lexical: LexicalClipboardPayload(namespace: MediaLinks.namespace, nodes: [node]))), fromInput: false, tellsRefusal: true) != nil
  }

  private func chooseImage(camera: Bool) {
    guard isEditable, let uploadImage, let presenter else { return }
    let picker = NativeImagePicker(presenter: presenter, upload: uploadImage) { [weak self] node in
      guard let self else { return }
      insertMedia(node)
      imagePicker = nil
    }
    imagePicker = picker
    picker.present(camera: camera)
  }

  private func writingDirectionMenu(for range: UITextRange) -> UIMenu {
    let choices: [(String, NSWritingDirection)] = [
      ("Automatic", .natural), ("Left to Right", .leftToRight), ("Right to Left", .rightToLeft),
    ]
    return UIMenu(title: "Writing Direction", children: choices.map { title, direction in
      UIAction(title: title) { [weak self] _ in self?.setWritingDirection(direction, for: range) }
    })
  }

  private func tableMenu() -> UIMenu {
    func action(_ title: String, _ command: EditorCommand, destructive: Bool = false) -> UIAction {
      UIAction(title: title, attributes: destructive ? .destructive : []) { [weak self] _ in
        self?.perform(command, fromInput: false)
      }
    }
    let counts = tableMenuCounts
    let rowLabel = counts.rows == 1 ? "Row" : "\(counts.rows) Rows"
    let columnLabel = counts.columns == 1 ? "Column" : "\(counts.columns) Columns"
    var actions: [UIMenuElement] =
      isInTable
      ? [
        action("Insert \(rowLabel) Above", .insertTableRow(after: false)),
        action("Insert \(rowLabel) Below", .insertTableRow(after: true)),
        action("Insert \(columnLabel) Left", .insertTableColumn(after: false)),
        action("Insert \(columnLabel) Right", .insertTableColumn(after: true)),
        UIAction(title: "Cell Background Colour…") { [weak self] _ in self?.askForCellBackground() },
        action("Header Row", .toggleTableRowHeader),
        action("Header Column", .toggleTableColumnHeader),
        action("Delete Table", .deleteTable, destructive: true),
        action("Delete Column", .deleteTableColumn, destructive: true),
        action("Delete Row", .deleteTableRow, destructive: true),
      ]
      : [UIAction(title: "Insert Table…") { [weak self] _ in self?.askForTable() }]
    if canMergeTableCells(counts: counts) {
      actions.insert(action("Merge Cells", .mergeTableCells), at: 0)
    } else if canUnmergeTableCell {
      actions.insert(action("Unmerge Cells", .unmergeTableCell), at: 0)
    }
    return UIMenu(title: "Table", image: UIImage(systemName: "tablecells"), children: actions)
  }

  private var tableMenuCounts: (rows: Int, columns: Int) {
    guard case .table(let table, let anchor, let focus, _) = modelSelection() else { return (1, 1) }
    do {
      let rows = try model.node(at: table)["children"]?.arrayValue ?? []
      var occupied: [Int: Set<Int>] = [:]
      var rectangles: [[Int]: (row: Int, column: Int, rows: Int, columns: Int)] = [:]
      for (row, node) in rows.enumerated() {
        var column = 0
        for (index, cell) in (node["children"]?.arrayValue ?? []).enumerated() {
          while occupied[row, default: []].contains(column) { column += 1 }
          let rowSpan = cell["rowSpan"]?.intValue ?? 1
          let colSpan = cell["colSpan"]?.intValue ?? 1
          guard rowSpan > 0, colSpan > 0 else { throw EditorError.invalidState("Expected positive table cell spans") }
          rectangles[table + [row, index]] = (row, column, rowSpan, colSpan)
          for r in row..<(row + rowSpan) {
            for c in column..<(column + colSpan) { occupied[r, default: []].insert(c) }
          }
          column += colSpan
        }
      }
      guard let a = rectangles[anchor], let b = rectangles[focus] else {
        throw EditorError.invalidState("getCellRect: expected to find selection cell")
      }
      let rowEnd = max(a.row + a.rows - 1, b.row + b.rows - 1)
      let columnEnd = max(a.column + a.columns - 1, b.column + b.columns - 1)
      return (rowEnd - min(a.row, b.row) + 1, columnEnd - min(a.column, b.column) + 1)
    } catch {
      failed("The table menu couldn't count its selection", error)
      return (1, 1)
    }
  }

  private var tableMenuCell: JSONValue? {
    guard let selection = modelSelection() else { return nil }
    var path = selection.anchor.path
    do {
      while !path.isEmpty {
        let node = try model.node(at: path)
        if node["type"] == "tablecell" { return node }
        path.removeLast()
      }
      return nil
    } catch {
      failed("The table menu couldn't read its cell", error)
      return nil
    }
  }

  private var canUnmergeTableCell: Bool {
    guard let selection = modelSelection() else { return false }
    switch selection {
    case .range where !selection.isCollapsed: return false
    case .table(_, let anchor, let focus, _) where anchor != focus: return false
    case .node: return false
    default: break
    }
    guard let cell = tableMenuCell else { return false }
    return (cell["colSpan"]?.intValue ?? 1) > 1 || (cell["rowSpan"]?.intValue ?? 1) > 1
  }

  private func canMergeTableCells(counts: (rows: Int, columns: Int)) -> Bool {
    guard case .table(_, _, _, let paths) = modelSelection(), counts.rows > 1 || counts.columns > 1 else { return false }
    do {
      var heights: [Int] = []
      var currentRow: [Int]?
      var expectedColumns: Int?
      var columns = 0
      for path in paths {
        let node = try model.node(at: path)
        let colSpan = node["colSpan"]?.intValue ?? 1
        let rowSpan = node["rowSpan"]?.intValue ?? 1
        let row = Array(path.dropLast())
        if row != currentRow {
          if let expectedColumns, columns != expectedColumns { return false }
          if currentRow != nil { expectedColumns = columns }
          currentRow = row
          columns = 0
        }
        for index in columns..<(columns + colSpan) {
          while heights.count <= index { heights.append(0) }
          heights[index] += rowSpan
        }
        columns += colSpan
      }
      return (expectedColumns == nil || columns == expectedColumns) && Set(heights).count == 1
    } catch {
      failed("The table menu couldn't read its selection", error)
      return false
    }
  }

  private func askForCellBackground() {
    let alert = UIAlertController(title: "Cell Background Colour", message: nil, preferredStyle: .alert)
    var apply: UIAlertAction?
    let current = tableMenuCell?["backgroundColor"]?.stringValue ?? ""
    alert.addTextField { field in
      field.text = current
      field.accessibilityLabel = "Colour"
      field.placeholder = "Hex, RGB, or colour name"
      field.keyboardType = .asciiCapable
      field.autocorrectionType = .no
      field.autocapitalizationType = .none
      field.addAction(UIAction { [weak field] _ in
        let value = field?.text ?? ""
        apply?.isEnabled = value.isEmpty || CSSColor(value) != nil
      }, for: .editingChanged)
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    apply = UIAlertAction(title: "Apply", style: .default) { [weak self, weak alert] _ in
      self?.perform(.setTableCellBackground(color: alert?.textFields?.first?.text ?? ""), fromInput: false)
    }
    alert.addAction(apply!)
    alert.preferredAction = apply
    presenter?.present(alert, animated: true)
  }

  private var isInTable: Bool {
    guard let selection = modelSelection(), let block = selection.anchor.path.first, block < document.blockCount,
      case .table = document.kind(ofBlock: block)
    else { return false }
    return true
  }

  /// The web's insert-table dialog: rows and columns, five of each to begin
  /// with, up to 500 rows and 50 columns.
  private func askForTable() {
    let alert = UIAlertController(title: "Insert Table", message: nil, preferredStyle: .alert)
    var insert: UIAlertAction?
    func count(_ index: Int) -> Int? { alert.textFields?[index].text.flatMap { Int($0) } }
    func isValid() -> Bool {
      guard let rows = count(0), let columns = count(1) else { return false }
      return (1...500).contains(rows) && (1...50).contains(columns)
    }
    for (name, limit) in [("Rows", 500), ("Columns", 50)] {
      alert.addTextField { field in
        field.text = "5"
        field.placeholder = "# of \(name.lowercased()) (1-\(limit))"
        field.accessibilityLabel = name
        field.keyboardType = .numberPad
        field.addAction(UIAction { _ in insert?.isEnabled = isValid() }, for: .editingChanged)
      }
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    insert = UIAlertAction(title: "Insert Table", style: .default) { [weak self] _ in
      guard let rows = count(0), let columns = count(1) else { return }
      self?.perform(.insertTable(rows: rows, columns: columns), fromInput: false)
    }
    alert.addAction(insert!)
    alert.preferredAction = insert
    var responder: UIResponder? = self
    while let current = responder, !(current is UIViewController) { responder = current.next }
    var presenter = responder as? UIViewController
    while let presented = presenter?.presentedViewController { presenter = presented }
    presenter?.present(alert, animated: true)
  }

  public func formatText(_ format: TextFormatType) {
    unmarkText()
    perform(.formatText(format), fromInput: false, tellsRefusal: true)
  }

  public override func toggleBoldface(_ sender: Any?) { formatText(.bold) }
  public override func toggleItalics(_ sender: Any?) { formatText(.italic) }
  public override func toggleUnderline(_ sender: Any?) { formatText(.underline) }
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

  // MARK: Lists and indents

  /// Makes the selected blocks a list of `listType`, or the list they are
  /// in one.
  public func insertList(_ listType: EditorCommand.ListType) { perform(.insertList(listType), fromInput: false) }
  public func removeList() { perform(.removeList, fromInput: false) }
  public func indent() { perform(.indent, fromInput: false) }
  public func outdent() { perform(.outdent, fromInput: false) }

  @objc private func toggleChecked(_ tap: UITapGestureRecognizer) {
    guard let path = layout.checklistItem(at: tap.location(in: surface)) else { return }
    perform(.toggleChecked(path: path), fromInput: false)
  }

  // MARK: Clipboard

  /// Where copy and cut put the selection and paste takes from.
  public var pasteboard = UIPasteboard.general

  public override func copy(_ sender: Any?) { copySelection(.copy) }
  public override func cut(_ sender: Any?) { copySelection(.cut) }

  private func copySelection(_ command: EditorCommand) {
    commitMarkedText()
    syncSelection()
    guard let clipboard = perform(command, fromInput: false)?.clipboard else { return }
    var item: [String: Any] = [UTType.utf8PlainText.identifier: clipboard.plainText]
    if let lexical = clipboard.lexical, let data = try? JSONEncoder().encode(lexical) {
      item[LexicalClipboardPayload.mimeType] = data
    }
    pasteboard.setItems([item])
  }

  public override func paste(_ sender: Any?) {
    commitMarkedText()
    syncSelection()
    let lexical = pasteboard.data(forPasteboardType: LexicalClipboardPayload.mimeType).flatMap {
      try? JSONDecoder().decode(LexicalClipboardPayload.self, from: $0)
    }
    var html = pasteboard.data(forPasteboardType: UTType.html.identifier).map { String(decoding: $0, as: UTF8.self) }
    if lexical == nil, html == nil, let rtf = pasteboard.data(forPasteboardType: UTType.rtf.identifier) {
      do {
        // Pages and Notes publish native RTF rather than HTML. Normalize it
        // through the OS document reader/writer, as browser paste does, then
        // use the same registered HTML converters as every other rich paste.
        let attributed = try NSAttributedString(data: rtf, options: [.documentType: NSAttributedString.DocumentType.rtf], documentAttributes: nil)
        let data = try attributed.data(
          from: NSRange(location: 0, length: attributed.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.html]
        )
        html = String(decoding: data, as: UTF8.self)
      } catch {
        tell(refusal: "Reading rich-text clipboard content isn't supported for this RTF payload (#168)")
        return
      }
    }
    perform(
      .paste(Clipboard(plainText: pasteboard.string ?? "", html: html, lexical: lexical)), fromInput: false,
      tellsRefusal: true)
  }

  /// Tells the user why an edit they asked for wasn't made. Unless set, an
  /// alert tells.
  public var tellRefusal: ((_ reason: String) -> Void)?

  private func tell(refusal reason: String) {
    if let tellRefusal { return tellRefusal(reason) }
    let alert = UIAlertController(title: "Not Supported Yet", message: reason, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    presenter?.present(alert, animated: true)
  }

  // MARK: Links

  /// Asks for a link's URL, starting from `current`, and answers with what
  /// was entered, or nil where the question was cancelled. Unless set, an
  /// alert asks.
  public var askForURL: ((_ current: String, _ answer: @escaping (String?) -> Void) -> Void)?

  /// Opens a link's URL, in the browser unless set.
  public var open: (URL) -> Void = { UIApplication.shared.open($0) }

  /// UIKit's word selection replaces the selection needed by table actions,
  /// so this press preserves selected cells and a merged cell's collapsed caret.
  private lazy var tableSelectionPress: UILongPressGestureRecognizer = {
    let press = UILongPressGestureRecognizer(target: self, action: #selector(showSelectedTableMenu(_:)))
    press.delegate = self
    return press
  }()

  @objc private func showSelectedTableMenu(_ press: UILongPressGestureRecognizer) {
    guard press.state == .began else { return }
    linkMenu.presentEditMenu(with: UIEditMenuConfiguration(identifier: "table" as NSString, sourcePoint: press.location(in: surface)))
  }

  private lazy var linkMenu = UIEditMenuInteraction(delegate: self)

  /// Where the link a caret at `offset` is in goes. The caret is in the
  /// text before it where there is some, as a browser resolves it.
  public func link(at offset: Int) -> URL? {
    let text = storage.string as NSString
    let isAfterText = offset > 0 && offset <= text.length && text.character(at: offset - 1) != 0x0A
    let character = isAfterText ? offset - 1 : offset
    guard character < storage.length else { return nil }
    return storage.attribute(.link, at: character, effectiveRange: nil) as? URL
  }

  /// The link the selection starts in.
  private var selectedLink: URL? { link(at: selected.location) }

  /// Links the selection to a URL asked for, as the web's link button does.
  public func addLink() {
    ask(for: "https://") { [self] url in perform(.toggleLink(url: url), fromInput: false) }
  }

  /// Changes the URL of the link the selection is in to one asked for, as
  /// the web's link editor saves it.
  public func editLink() {
    guard let url = selectedLink else { return }
    ask(for: url.absoluteString) { [self] url in perform(.editLink(url: url), fromInput: false) }
  }

  /// Leaves the text of the link the selection is in, unlinked.
  public func removeLink() {
    syncSelection()
    perform(.toggleLink(url: nil), fromInput: false)
  }

  public func openLink() {
    if let url = selectedLink, Self.webOpens(url) { open(url) }
  }

  /// Whether the web opens a link to `url`, which it does only with a
  /// protocol it supports.
  private static func webOpens(_ url: URL) -> Bool {
    url.scheme.map { supportedURLProtocols.contains($0.lowercased() + ":") } ?? false
  }

  @objc private func linkFromKeyboard() {
    if selectedLink != nil { editLink() } else if selected.length > 0 { addLink() }
  }

  private func ask(for current: String, then act: @escaping (String) -> Void) {
    commitMarkedText()
    syncSelection()
    let answer: (String?) -> Void = { url in if let url { act(url) } }
    if let askForURL { return askForURL(current, answer) }
    let alert = UIAlertController(title: "Link", message: nil, preferredStyle: .alert)
    alert.addTextField { field in
      field.text = current
      field.keyboardType = .URL
      field.autocapitalizationType = .none
      field.autocorrectionType = .no
    }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Save", style: .default) { _ in answer(alert.textFields?.first?.text ?? "") })
    presenter?.present(alert, animated: true)
  }

  /// The view controller the view is shown by, to ask from.
  private var presenter: UIViewController? {
    var responder: UIResponder? = self
    while let current = responder {
      if let controller = current as? UIViewController { return controller }
      responder = current.next
    }
    return nil
  }

  /// What the edit menu offers for links: to link a selection, or for a
  /// selection in a link, to open it where the web would, edit or unlink
  /// it. `caret`, where given, is where the caret goes first.
  private func linkActions(in range: NSRange, caret: Int? = nil) -> [UIMenuElement] {
    func action(_ title: String, _ symbol: String, _ act: @escaping (EditorView) -> Void) -> UIAction {
      UIAction(title: title, image: UIImage(systemName: symbol)) { [weak self] _ in
        guard let self else { return }
        if let caret { selectedTextRange = TextRange(NSRange(location: caret, length: 0)) }
        act(self)
      }
    }
    if let url = link(at: caret ?? range.location) {
      let open = Self.webOpens(url) ? [action("Open Link", "safari") { $0.openLink() }] : []
      guard isEditable else { return open }
      return open + [
        action("Edit Link…", "pencil") { $0.editLink() },
        action("Remove Link", "link.badge.minus") { $0.removeLink() },
      ]
    }
    guard isEditable, range.length > 0 else { return [] }
    return [action("Add Link…", "link") { $0.addLink() }]
  }

  /// The character of a link's text a tap is on, which the caret goes after.
  private func linkCharacter(at point: CGPoint) -> NSRange? {
    guard let character = characterRange(at: point) as? TextRange, character.range.length > 0,
      storage.attribute(.link, at: character.range.location, effectiveRange: nil) != nil
    else { return nil }
    return character.range
  }

  /// A tap on a link's text puts the caret there, as any tap does, and
  /// offers to open or edit the link.
  @objc private func tapped(_ tap: UITapGestureRecognizer) {
    let point = tap.location(in: surface)
    if let label = layout.footnoteBacklink(at: point) { followFootnoteBacklink(label); return }
    if let offset = layout.offset(closestTo: point), let path = document.embeddedPath(at: offset),
      let key = nodeKey(at: path), let node = try? model.nodeForPresentation(at: path) {
      if onEmbeddedTap?(key, node) == true { return }
      if let media = MediaPayload(node), let source = media.source, ["http", "https"].contains(source.scheme ?? "") {
        UIApplication.shared.open(source)
        return
      }
    }
    guard linkCharacter(at: point) != nil else { return }
    linkMenu.presentEditMenu(with: UIEditMenuConfiguration(identifier: nil, sourcePoint: point))
  }

  // MARK: Layout

  public override func layoutSubviews() {
    super.layoutSubviews()
    updateFloatingTypes()
    if inlineEmbeddedContent != nil, inlineWidth != bounds.width {
      inlineWidth = bounds.width
      render(nil)
    }
    if composition == nil {
      let changed = typesetting.setWidth(bounds.width)
      let paths = (0..<document.blockCount).filter { changed.contains(document.type(ofBlock: $0)) }.map { [$0] }
      if !paths.isEmpty { render(ChangeSet(changed: Set(paths))) }
    }
    typesetting.withFontMetrics { layout.layoutViewport(of: self) }
    layoutFloatingContent()
  }
}

extension EditorCommand {
  /// Whether the command acts at the selection, so the model needs one.
  fileprivate var editsAtSelection: Bool {
    switch self {
    case .setSelection, .wait, .undo, .redo, .selectAll: false
    default: true
    }
  }
}

extension WebShortcutAction {
  fileprivate var isImplemented: Bool {
    switch self {
    case .formatCode: true
    case .increaseFontSize, .decreaseFontSize, .clearFormatting: true
    case .centerAlign, .leftAlign, .rightAlign, .justifyAlign: true
    case .formatParagraph, .formatHeading, .formatBulletList, .formatNumberedList, .formatCheckList, .formatQuote,
      .lowercase, .uppercase, .capitalize, .strikeThrough, .indent, .outdent, .subscript, .superscript,
      .insertCodeBlock, .insertLink: true
    }
  }
}

extension EditorCommand {
  /// Whether the command can change the document, not only where the
  /// selection is.
  fileprivate var edits: Bool {
    switch self {
    case .setSelection, .selectAll, .arrow, .wait, .copy: false
    default: true
    }
  }
}

/// A tap on a checklist item's box, which fails as soon as a touch lands
/// anywhere else, so the text interaction waiting on it needn't wait long.
private final class CheckboxTap: UITapGestureRecognizer {
  var isOnCheckbox: (CGPoint) -> Bool = { _ in false }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    guard let view, touches.allSatisfy({ isOnCheckbox($0.location(in: view)) }) else {
      state = .failed
      return
    }
    super.touchesBegan(touches, with: event)
  }
}

extension EditorView: UIGestureRecognizerDelegate, @MainActor UIEditMenuInteractionDelegate {
  public func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    if gestureRecognizer === tableSelectionPress {
      if case .table = modelSelection() { return isEditable }
      if isEditable, canUnmergeTableCell, let selection = modelSelection(),
        let offset = layout.offset(closestTo: touch.location(in: surface))
      {
        let touched = document.point(at: offset).path
        var path = selection.anchor.path
        while !path.isEmpty {
          if (try? model.node(at: path))?["type"] == "tablecell" {
            return touched.starts(with: path)
          }
          path.removeLast()
        }
      }
      return false
    }
    return true
  }

  /// The tap that offers a link's actions leaves the text interaction's own
  /// taps to place the caret.
  public func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool { gestureRecognizer !== tableSelectionPress && other !== tableSelectionPress }

  public func editMenuInteraction(
    _ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration,
    suggestedActions: [UIMenuElement]
  ) -> UIMenu? {
    if configuration.identifier as? String == "table" {
      return UIMenu(children: suggestedActions + [tableMenu()])
    }
    guard let character = linkCharacter(at: configuration.sourcePoint) else { return nil }
    return UIMenu(children: linkActions(in: character, caret: NSMaxRange(character)))
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
