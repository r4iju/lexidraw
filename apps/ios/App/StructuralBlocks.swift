import CSSValues
import EditorModelInterface
import LexicalSwift
import TextKitEditor
import UIKit

/// Panels preview structural bodies; editing them shares the parent model so
/// plugin escapes and repair transforms retain document history and autosave.
@MainActor func configureStructuralBlocks(_ view: EditorView) {
  if view.isEditable && view.supportsRichText {
    let entries: [(String, String)] = [(StructuralBlockConfiguration.dividerLabel, "horizontalrule"), ("Callout", "callout"), ("Collapsible section", "collapsible-container"), ("Columns", "layout-container"), ("Page break", "page-break"), ("Sticky note", "sticky")]
    view.insertionActions.append(UIMenu(title: "Structural blocks", children: entries.map { title, type in
      UIAction(title: title) { [weak view] _ in
        guard let template = StructuralBlockConfiguration.insertionNodes[type] else { preconditionFailure("No registered structural insertion template") }
        do { view?.insertEmbeddedNode(try JSONValue(parsing: template), namespace: editorNamespace) }
        catch { preconditionFailure("Invalid generated structural insertion node: \(error)") }
      }
    }))
  }
  view.accessibleEmbeddedTypes.formUnion(StructuralPanel.types)
  let prior = view.embeddedContent
  let priorFrame = view.floatingEmbeddedFrame
  view.floatingEmbeddedMinimumWidth = StructuralBlockConfiguration.stackedColumnsWidth
  view.floatingEmbeddedTypes.insert("sticky")
  view.floatingEmbeddedFrame = { node, width in
    guard node["type"] == "sticky" else { return priorFrame?(node, width) }
    let x = CGFloat(node["xOffset"]?.numberValue ?? 0)
    let y = CGFloat(node["yOffset"]?.numberValue ?? 0)
    return CGRect(
      x: max(0, min(x, width - StructuralBlockConfiguration.stickyWidth)), y: y,
      width: StructuralBlockConfiguration.stickyWidth, height: StructuralBlockConfiguration.stickyHeight)
  }
  let panels = NSCache<NSString, StructuralPanel>()
  panels.countLimit = 120
  view.embeddedElementTypes.formUnion(["callout", "collapsible-container", "layout-container"])
  view.embeddedContent = { [weak view] key, node in
    guard let view, StructuralPanel.types.contains(node["type"]?.stringValue ?? "") else { return prior?(key, node) }
    if let panel = panels.object(forKey: key as NSString) {
      panel.show(node)
      return panel
    }
    let panel = StructuralPanel(owner: view, key: key)
    panels.setObject(panel, forKey: key as NSString)
    panel.show(node)
    return panel
  }
}

@MainActor private final class StructuralPanel: EmbeddedContentView {
  static let types: Set<String> = [
    "callout", "collapsible-container", "layout-container", "page-break", "sticky", "slide-deck",
  ]
  private weak var owner: EditorView?
  private let key: String
  private var node: JSONValue = .null
  private var saving = false
  private let stack = UIStackView()
  private var columns: NativeColumnsView?
  private var bodies: [EditorView] = []
  /// A body as tall as its text, refitted whenever the panel is measured.
  private var fittedBody: (editor: EditorView, height: NSLayoutConstraint)?
  /// The width the body was last fitted at, and whether a refit is queued.
  private var fittedWidth: CGFloat?
  private var refitPending = false
  private var insets = UIEdgeInsets.zero
  private var dragStart: CGPoint?
  private var viewingSectionOpen: Bool?
  private var section: SectionView?
  private var borderColor: UIColor? { didSet { resolveBorderColor() } }
  /// A dashed border, drawn where `layer`'s own border can only be solid.
  private var outline: CAShapeLayer?
  private func resolveBorderColor() {
    let color = borderColor?.resolvedColor(with: traitCollection).cgColor
    if let outline { outline.strokeColor = color } else { layer.borderColor = color }
  }

  init(owner: EditorView, key: String) {
    self.owner = owner
    self.key = key
    super.init(frame: .zero)
    stack.axis = .vertical
    stack.spacing = 8
    addSubview(stack)
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (self: Self, _) in
      self.resolveBorderColor()
    }
    let drag = UIPanGestureRecognizer(target: self, action: #selector(dragSticky(_:)))
    drag.delegate = self
    addGestureRecognizer(drag)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func show(_ value: JSONValue) {
    guard value != node else { return }
    node = value
    viewingSectionOpen = nil
    guard !saving else { return }
    rebuild()
  }

  private func save(_ replacement: JSONValue, rebuild: Bool = false) {
    guard let owner else { return }
    saving = true
    defer { saving = false }
    do {
      try owner.replaceEmbeddedNode(key: key, expected: node, replacement: replacement)
      node = try owner.structuralNode(key: key)
      if rebuild {
        self.rebuild()
        owner.refreshEmbeddedContent()
      }
    } catch { presentError(error) }
  }
  private func field(_ name: String, _ value: JSONValue, rebuild: Bool = false) {
    var fields = node.objectValue ?? [:]
    fields[name] = value
    save(.object(fields), rebuild: rebuild)
  }
  @discardableResult private func button(_ title: String, action: @escaping () -> Void) -> UIButton {
    let button = UIButton(type: .system)
    button.setTitle(title, for: .normal)
    button.contentHorizontalAlignment = .leading
    button.addAction(UIAction { _ in action() }, for: .touchUpInside)
    button.isEnabled = owner?.isEditable == true
    stack.addArrangedSubview(button)
    return button
  }
  private func label(_ text: String) {
    let label = UILabel()
    label.text = text
    label.numberOfLines = 0
    label.textColor = .secondaryLabel
    stack.addArrangedSubview(label)
  }
  private func menu(_ title: String, entries: [(String, () -> Void)]) {
    let button = button(title) {}
    button.showsMenuAsPrimaryAction = true
    button.menu = UIMenu(children: entries.map { name, action in UIAction(title: name) { _ in action() } })
  }
  private func rebuild() {
    for view in stack.arrangedSubviews {
      stack.removeArrangedSubview(view)
      view.removeFromSuperview()
    }
    bodies = []
    fittedBody = nil
    fittedWidth = nil
    columns = nil
    section?.removeFromSuperview()
    section = nil
    insets = .zero
    layer.cornerRadius = 0
    layer.borderWidth = 0
    outline?.removeFromSuperlayer()
    outline = nil
    borderColor = nil
    backgroundColor = .clear
    accessibilityLabel = node["type"]?.stringValue
    switch node["type"]?.stringValue {
    case "callout": callout()
    case "collapsible-container": collapsible()
    case "layout-container": layoutColumns()
    case "sticky": sticky()
    case "page-break":
      let line = UIView()
      line.backgroundColor = .separator
      line.heightAnchor.constraint(equalToConstant: 1).isActive = true
      stack.addArrangedSubview(line)
      label("Page break")
    case "slide-deck": legacySlideDeck()
    default: label("Unsupported structural block (#133)")
    }
    setNeedsLayout()
  }

  private func nestedEditor(
    _ state: JSONValue, editable: Bool = false, textWeight: CGFloat? = nil, textLineHeight: CGFloat? = nil, contextPath: [Int]? = nil,
    shareDocumentMetadata: Bool = false
  ) throws -> (model: Editor, view: EditorView) {
    let model = Editor(plainText: node["type"] == "sticky")
    try model.load(state)
    let editor =
      owner?.makeNestedEditor(
        model: model, isEditable: editable && owner?.isEditable == true && model.isEditable,
        textSize: node["type"] == "sticky" ? 24 : nil, textWeight: textWeight, textLineHeight: textLineHeight, shareDocumentMetadata: shareDocumentMetadata)
      ?? EditorView(model: model, isEditable: false)
    if let contextPath, let owner {
      try editor.inheritElementFormatting(from: owner, key: key, childPath: contextPath)
    }
    if owner?.configureNestedEmbeds == nil { configureEmbeddedDrawings(editor) }
    return (model, editor)
  }

  private func body(
    _ state: JSONValue, parent: UIStackView? = nil, editable: Bool = false, contextPath: [Int]? = nil, shareDocumentMetadata: Bool = false, changed: @escaping (JSONValue) -> Void
  ) {
    do {
      let (model, editor) = try nestedEditor(state, editable: editable, contextPath: contextPath, shareDocumentMetadata: shareDocumentMetadata)
      let height = editor.heightAnchor.constraint(equalToConstant: node["type"] == "sticky" ? 90 : 150)
      height.isActive = true
      var opened = node
      editor.onChange = { [weak self, weak editor] in
        guard let self, let editor else { return }
        guard self.node == opened else {
          self.presentError(EditorError.invalidState("The block changed while its editor was open"))
          return
        }
        do {
          changed(try model.serializedState())
          opened = self.node
          let contentHeight = self.node["type"] == "sticky" ? 90 : max(80, min(editor.contentSize.height, 600))
          if abs(height.constant - contentHeight) > 1 {
            height.constant = contentHeight
            self.owner?.refreshEmbeddedContent()
          }
        } catch { self.presentError(error) }
      }
      bodies.append(editor)
      (parent ?? stack).addArrangedSubview(editor)
      if !model.isEditable { label("This nested document contains an unported node and is read-only.") }
    } catch { label("Cannot open this block: \(error.localizedDescription)") }
  }
  private func document(_ children: [JSONValue]) -> JSONValue {
    ["root": ["type": "root", "version": 1, "children": .array(children)]]
  }
  private func paragraph(_ children: [JSONValue]) -> JSONValue {
    ["type": "paragraph", "version": 1, "children": .array(children)]
  }
  private func replaceChildren(_ children: [JSONValue], at path: [Int] = []) {
    var replacement = node
    func replacing(_ value: JSONValue, _ path: ArraySlice<Int>) -> JSONValue {
      var fields = value.objectValue ?? [:]
      if let index = path.first {
        var nested = fields["children"]?.arrayValue ?? []
        guard nested.indices.contains(index) else { return value }
        nested[index] = replacing(nested[index], path.dropFirst())
        fields["children"] = .array(nested)
      } else {
        fields["children"] = .array(children)
      }
      return .object(fields)
    }
    replacement = replacing(replacement, path[...])
    save(replacement)
  }
  private func callout() {
    let kind = node["kind"]?.stringValue ?? ""
    let title = node["title"]?.stringValue ?? ""
    insets = UIEdgeInsets(
      top: StructuralBlockConfiguration.calloutPaddingY, left: StructuralBlockConfiguration.calloutPaddingX,
      bottom: StructuralBlockConfiguration.calloutPaddingY, right: StructuralBlockConfiguration.calloutPaddingX)
    layer.cornerRadius = StructuralBlockConfiguration.calloutRadius
    let colors = StructuralBlockConfiguration.calloutColors[kind] ?? []
    let accent: UIColor
    do {
      backgroundColor = try themed(colors, opacity: StructuralBlockConfiguration.calloutTint)
      accent = try themed(colors)
    } catch { label("Cannot render this callout (#133): \(structuralReason(error))"); return }
    let header = calloutHeader(
      kind: kind, title: title.isEmpty ? StructuralBlockConfiguration.calloutLabels[kind] ?? kind : title, color: accent)
    stack.addArrangedSubview(header)
    stack.setCustomSpacing(StructuralBlockConfiguration.calloutHeaderAfter, after: header)
    body(document(node["children"]?.arrayValue ?? []), contextPath: [], shareDocumentMetadata: true) { _ in }
    // The callout's tint shows through its body, its padding is the body's
    // only inset, and the body is as tall as its text, as on the web.
    guard let body = bodies.last else { return }
    body.backgroundColor = .clear
    body.contentMargin = 0
    body.dropsTrailingSpace = true
    if let height = body.constraints.first(where: { $0.firstAttribute == .height && $0.secondItem == nil }) {
      fittedBody = (body, height)
      body.onContentHeightChange = { [weak self] in self?.bodyHeightChanged() }
    }
  }
  /// The web draws the kind's icon and the title in the kind's colour. Where
  /// the reader may edit, the header is the menu that changes the callout.
  private func calloutHeader(kind: String, title: String, color: UIColor) -> UIView {
    let size = owner?.points(webPixels: 16) ?? 16
    let font = owner?.documentFont(webPixels: 16, weight: Int(StructuralBlockConfiguration.calloutHeaderWeight))
      ?? .systemFont(ofSize: size, weight: .semibold)
    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = size * StructuralBlockConfiguration.calloutHeaderLineHeight
    paragraph.maximumLineHeight = paragraph.minimumLineHeight
    let text = NSAttributedString(string: title, attributes: [.font: font, .foregroundColor: color, .paragraphStyle: paragraph])
    let icon = Self.calloutSymbols[StructuralBlockConfiguration.calloutIcons[kind] ?? ""].flatMap {
      UIImage(systemName: $0, withConfiguration: UIImage.SymbolConfiguration(pointSize: owner?.points(webPixels: StructuralBlockConfiguration.calloutIconSize) ?? 18, weight: .medium))
    }
    let gap = owner?.points(webPixels: StructuralBlockConfiguration.calloutHeaderGap) ?? 8
    guard owner?.isEditable == true else {
      let label = UILabel()
      label.attributedText = text
      label.numberOfLines = 0
      label.accessibilityTraits.insert(.header)
      let row = UIStackView(arrangedSubviews: [label])
      if let icon {
        let image = UIImageView(image: icon)
        image.tintColor = color
        image.setContentHuggingPriority(.required, for: .horizontal)
        image.isAccessibilityElement = false
        row.insertArrangedSubview(image, at: 0)
      }
      row.spacing = gap
      row.alignment = .center
      return row
    }
    var configuration = UIButton.Configuration.plain()
    configuration.attributedTitle = try? AttributedString(text, including: \.uiKit)
    configuration.image = icon
    configuration.imagePadding = gap
    configuration.baseForegroundColor = color
    configuration.contentInsets = .zero
    configuration.titleAlignment = .leading
    let button = UIButton(configuration: configuration)
    button.contentHorizontalAlignment = .leading
    button.accessibilityHint = "Changes the callout’s kind, title or content"
    button.showsMenuAsPrimaryAction = true
    let kinds = StructuralBlockConfiguration.calloutLabels.sorted { $0.key < $1.key }.map { value, name in
      UIAction(title: name, state: value == kind ? .on : .off) { [weak self] _ in
        self?.field("kind", .string(value), rebuild: true)
      }
    }
    let current = node["title"]?.stringValue ?? ""
    button.menu = UIMenu(children: [
      UIMenu(title: "Kind", options: .displayInline, children: kinds),
      UIAction(title: "Edit callout title") { [weak self] _ in
        self?.rename("Callout title", value: current) { self?.field("title", .string($0), rebuild: true) }
      },
      UIAction(title: "Edit callout body") { [weak self] _ in self?.editBody() },
    ])
    return button
  }
  /// Images load after the body was fitted; the parent re-measures the
  /// callout once, after its own layout, if the body's height really changed.
  private func bodyHeightChanged() {
    guard fittedWidth != nil, !refitPending else { return }
    refitPending = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.refitPending = false
      guard let fittedBody = self.fittedBody, let width = self.fittedWidth else { return }
      if abs(fittedBody.editor.fittingHeight(width: width) - fittedBody.height.constant) > 0.5 { self.owner?.refreshEmbeddedContent() }
    }
  }
  /// SF Symbols for the web's Lucide callout icons.
  private static let calloutSymbols: [String: String] = [
    "info": "info.circle", "lightbulb": "lightbulb", "message-square-warning": "exclamationmark.bubble",
    "triangle-alert": "exclamationmark.triangle", "octagon-alert": "exclamationmark.octagon",
  ]
  private func collapsible() {
    let open = viewingSectionOpen ?? node["open"]?.isTruthy ?? false
    let children = node["children"]?.arrayValue ?? []
    guard children.count == 2, children[0]["type"] == "collapsible-title", children[1]["type"] == "collapsible-content"
    else {
      label("Invalid collapsible structure (#133)")
      return
    }
    let chevron: UIColor
    do { chevron = try themed(StructuralBlockConfiguration.sectionChevronColors) }
    catch { label("Cannot render this section (#133): \(structuralReason(error))"); return }
    // The title is one paragraph or heading; a title stored before titles
    // were blocks holds its text directly.
    let titleChildren = children[0]["children"]?.arrayValue ?? []
    let titleBlock = titleChildren.first.flatMap { ["paragraph", "heading"].contains($0["type"]?.stringValue) ? $0 : nil }
    let level = titleBlock?["type"] == "heading" ? titleBlock?["tag"]?.stringValue ?? "paragraph" : "paragraph"
    let title: EditorView, content: EditorView?
    do {
      title = try nestedEditor(
        document(titleBlock == nil ? [paragraph(titleChildren)] : titleChildren), contextPath: [0], shareDocumentMetadata: true
      ).view
      content = open
        ? try nestedEditor(document(children[1]["children"]?.arrayValue ?? []), contextPath: [1], shareDocumentMetadata: true).view
        : nil
    } catch { label("Cannot open this block: \(error.localizedDescription)"); return }
    func text(_ node: JSONValue) -> String { node["text"]?.stringValue ?? (node["children"]?.arrayValue ?? []).map(text).joined() }
    let actions = owner?.isEditable == true ? [
      UIAction(title: "Edit section title") { [weak self] _ in self?.editBody(path: [0]) },
      UIAction(title: "Edit section content") { [weak self] _ in self?.editBody(path: [1]) },
    ] : []
    let section = SectionView(
      title: title, content: content, open: open, level: level, label: text(children[0]).trimmingCharacters(in: .whitespaces),
      chevronColor: chevron, actions: actions)
    section.onToggle = { [weak self] in
      guard let self else { return }
      if self.owner?.isEditable == true { self.field("open", .bool(!open), rebuild: true) }
      else { self.viewingSectionOpen = !open; self.rebuild(); self.owner?.refreshEmbeddedContent() }
    }
    section.onHeightChange = { [weak self] in self?.owner?.refreshEmbeddedContent() }
    addSubview(section)
    self.section = section
  }
  private func layoutColumns() {
    menu(
      "Column layout",
      entries: StructuralBlockConfiguration.layouts.map { preset in
        (preset.label, { [weak self] in self?.setColumns(preset.value) })
      })
    let template = node["templateColumns"]?.stringValue ?? ""
    let children = node["children"]?.arrayValue ?? []
    guard let tracks = NativeColumnTrack.parse(template) else {
      label("This CSS column template is not supported by native layout (#133): \(template)")
      return
    }
    let rightToLeft: Bool
    do { rightToLeft = try owner?.elementWritingDirection(for: key) == .rtl }
    catch { label("Cannot read the column direction: \(error.localizedDescription)"); return }
    let columns = NativeColumnsView(tracks: tracks, gap: StructuralBlockConfiguration.columnGap, rightToLeft: rightToLeft)
    stack.addArrangedSubview(columns)
    self.columns = columns
    for (index, child) in children.enumerated() {
      let column: NativeColumnBox
      do { column = try NativeColumnBox(editable: owner?.isEditable == true) }
      catch { label("Cannot draw this column: \(error.localizedDescription)"); return }
      column.axis = .vertical
      let inset = StructuralBlockConfiguration.columnPadding + StructuralBlockConfiguration.columnBorderWidth
      column.isLayoutMarginsRelativeArrangement = true
      column.layoutMargins = UIEdgeInsets(top: inset, left: inset, bottom: inset, right: inset)
      columns.addColumn(column)
      let edit = UIButton(type: .system)
      edit.setTitle("Edit column \(index + 1)", for: .normal)
      edit.isEnabled = owner?.isEditable == true
      edit.addAction(UIAction { [weak self] _ in self?.editBody(path: [index]) }, for: .touchUpInside)
      column.addArrangedSubview(edit)
      body(document(child["children"]?.arrayValue ?? []), parent: column, contextPath: [index], shareDocumentMetadata: true) { _ in }
    }
  }
  private func setColumns(_ value: String) {
    let count = JSRegExp(StructuralBlockConfiguration.columnWhitespacePattern, flags: "").split(value).filter { !$0.isEmpty }.count
    if (node["children"]?.arrayValue?.count ?? 0) > count {
      let opened = node
      let alert = UIAlertController(
        title: "Remove extra columns?", message: "Their content will be removed. You can undo this change.",
        preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
      alert.addAction(
        UIAlertAction(title: "Remove columns", style: .destructive) { [weak self] _ in
          guard let self, self.node == opened else { return }
          self.applyColumns(value)
        })
      parentController()?.present(alert, animated: true)
    } else {
      applyColumns(value)
    }
  }
  private func applyColumns(_ value: String) {
    do {
      try owner?.updateStructuralFields(key: key, expected: node, fields: ["templateColumns": .string(value)])
      if let owner { node = try owner.structuralNode(key: key) }
      rebuild()
      owner?.setNeedsLayout()
    } catch { presentError(error) }
  }
  @objc private func dragSticky(_ gesture: UIPanGestureRecognizer) {
    guard node["type"] == "sticky", owner?.isEditable == true,
      (owner?.bounds.width ?? 0) > StructuralBlockConfiguration.stackedColumnsWidth else { return }
    switch gesture.state {
    case .began: dragStart = CGPoint(x: node["xOffset"]?.numberValue ?? 0, y: node["yOffset"]?.numberValue ?? 0)
    case .changed:
      guard let start = dragStart else { return }
      let delta = gesture.translation(in: superview)
      frame.origin = CGPoint(
        x: max(
          0,
          min(
            start.x + delta.x,
            (superview?.bounds.width ?? CGFloat(StructuralBlockConfiguration.stickyWidth))
              - CGFloat(StructuralBlockConfiguration.stickyWidth))), y: start.y + delta.y)
    case .ended:
      guard let start = dragStart else { return }
      let delta = gesture.translation(in: superview)
      var fields = node.objectValue ?? [:]
      fields["xOffset"] = .number(Double(start.x + delta.x))
      fields["yOffset"] = .number(Double(start.y + delta.y))
      dragStart = nil
      do {
        try owner?.updateStructuralFields(key: key, expected: node, fields: ["xOffset": fields["xOffset"]!, "yOffset": fields["yOffset"]!])
        if let owner { node = try owner.structuralNode(key: key) }
      } catch { presentError(error) }
      owner?.setNeedsLayout()
    case .cancelled, .failed:
      dragStart = nil
      owner?.setNeedsLayout()
    default: break
    }
  }
  private func sticky() {
    let color = node["color"]?.stringValue ?? ""
    do { backgroundColor = try themed(StructuralBlockConfiguration.stickyColors[color] ?? []) }
    catch { label("Cannot render this sticky (#133): \(structuralReason(error))"); return }
    insets = UIEdgeInsets(top: 12, left: 12, bottom: 12, right: 12)
    button("Delete sticky note") { [weak self] in
      guard let self, let owner = self.owner else { return }
      do { try owner.replaceEmbeddedNode(key: self.key, expected: self.node, replacement: nil) } catch {
        self.presentError(error)
      }
    }
    menu(
      "Sticky color",
      entries: StructuralBlockConfiguration.stickyColors.keys.sorted().map { color in
        (color.capitalized, { [weak self] in self?.field("color", .string(color), rebuild: true) })
      })
    if let owner, owner.isEditable {
      do {
        let editor = try owner.makeCaptionEditor(key: key, textSize: 24)
        editor.heightAnchor.constraint(equalToConstant: 90).isActive = true
        bodies.append(editor)
        stack.addArrangedSubview(editor)
      } catch { label("Cannot open this caption: \(error.localizedDescription)") }
    } else {
      body(node["caption"]?["editorState"] ?? document([])) { _ in }
    }
  }
  /// A deck saved before slides were removed (#253), drawn as the web draws
  /// it: what it said, and no way to change it. The editor selects and
  /// deletes it as any block.
  private func legacySlideDeck() {
    let title = "Slide deck (no longer supported)"
    accessibilityLabel = title
    insets = UIEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
    layer.cornerRadius = 6
    let outline = CAShapeLayer()
    outline.fillColor = UIColor.clear.cgColor
    outline.lineWidth = 1
    outline.lineDashPattern = [3, 3]
    layer.addSublayer(outline)
    self.outline = outline
    borderColor = .separator
    func text(_ value: String, weight: Int) -> UILabel {
      let label = UILabel()
      label.text = value
      label.numberOfLines = 0
      label.textColor = .secondaryLabel
      label.font = owner?.documentFont(webPixels: 14, weight: weight) ?? .systemFont(ofSize: 14, weight: weight == 500 ? .medium : .regular)
      return label
    }
    let icon = UIImageView(image: UIImage(systemName: "play.rectangle"))
    icon.tintColor = .secondaryLabel
    icon.setContentHuggingPriority(.required, for: .horizontal)
    icon.isAccessibilityElement = false
    let header = UIStackView(arrangedSubviews: [icon, text(title, weight: 500)])
    header.spacing = 8
    header.alignment = .center
    stack.addArrangedSubview(header)
    let lines = Self.slideDeckText(node["data"])
    if !lines.isEmpty { stack.setCustomSpacing(8, after: header) }
    for (index, line) in lines.enumerated() {
      let label = text(line, weight: 400)
      stack.addArrangedSubview(label)
      if index < lines.count - 1 { stack.setCustomSpacing(4, after: label) }
    }
  }
  /// The text a stored deck's text boxes hold, a line per block, slide by
  /// slide, as the web's `slideDeckText` reads it. A box stored as a JSON
  /// string reads as its parsed state.
  private static func slideDeckText(_ data: JSONValue?) -> [String] {
    func list(_ value: JSONValue?, _ key: String) -> [JSONValue] { value?[key]?.arrayValue ?? [] }
    func text(_ node: JSONValue) -> String {
      if let text = node["text"]?.stringValue { return text }
      if node["type"] == "linebreak" { return "\n" }
      return list(node, "children").map(text).joined()
    }
    func lines(_ node: JSONValue) -> [String] {
      let children = list(node, "children")
      let holdsText = children.isEmpty || children.contains {
        $0["text"]?.stringValue != nil || $0["type"] == "linebreak"
      }
      return holdsText ? [text(node)] : children.flatMap(lines)
    }
    return list(data, "slides").flatMap { slide in
      list(slide, "elements").flatMap { element -> [String] in
        guard element["kind"] == "box" else { return [] }
        var state = element["editorStateJSON"]
        if let source = state?.stringValue {
          guard let parsed = try? JSONValue(parsing: source) else { return [] }
          state = parsed
        }
        return list(state?["root"], "children").flatMap(lines)
          .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
          .filter { !$0.isEmpty }
      }
    }
  }
  private func editBody(path: [Int] = []) {
    do {
      guard let owner else { return }
      owner.resignFirstResponder()
      let editor = try owner.makeStructuralEditor(key: key, childPath: path)
      // Keep this family's parent context as editable text rather than opening
      // another panel recursively. Decorators retain their native providers.
      let provider = editor.embeddedContent
      editor.embeddedElementTypes = []
      editor.embeddedContent = { key, node in
        guard !["callout", "layout-container", "collapsible-container"].contains(node["type"]?.stringValue ?? "") else { return nil }
        return provider?(key, node)
      }
      let controller = UIViewController()
      controller.title = "Edit block content"
      controller.view = NativeEditorHost(editor: editor)
      let navigation = UINavigationController(rootViewController: controller)
      controller.navigationItem.rightBarButtonItem = UIBarButtonItem(
        systemItem: .done, primaryAction: UIAction { _ in navigation.dismiss(animated: true) })
      parentController()?.present(navigation, animated: true) { editor.becomeFirstResponder() }
    } catch { presentError(error) }
  }
  private func parentController() -> UIViewController? {
    var responder: UIResponder? = self
    while responder != nil, !(responder is UIViewController) { responder = responder?.next }
    return responder as? UIViewController
  }
  private func rename(_ title: String, value: String, saved: @escaping (String) -> Void) {
    let alert = UIAlertController(title: title, message: nil, preferredStyle: .alert)
    alert.addTextField { $0.text = value }
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    let opened = node
    alert.addAction(
      UIAlertAction(title: "Save", style: .default) { [weak self] _ in
        guard let self else { return }
        guard self.node == opened else {
          self.presentError(EditorError.invalidState("The block changed while its editor was open"))
          return
        }
        saved(alert.textFields?.first?.text ?? "")
      })
    parentController()?.present(alert, animated: true)
  }
  private func presentError(_ error: any Error) {
    let alert = UIAlertController(
      title: "Block update failed", message: error.localizedDescription, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    parentController()?.present(alert, animated: true)
  }
  private func structuralReason(_ error: Error) -> String {
    if let error = error as? EditorError, case .unsupported(let reason) = error { return reason }
    return error.localizedDescription
  }

  private func themed(_ values: [String], opacity: [Double] = [1, 1]) throws -> UIColor {
    guard values.count == 2, let light = CSSColor(values[0]), let dark = CSSColor(values[1]),
      opacity.count == 2, opacity.allSatisfy({ $0.isFinite && $0 >= 0 && $0 <= 1 }) else {
      throw EditorError.unsupported("The structural theme color cannot be represented natively (#133)")
    }
    return UIColor { traits in
      let index = traits.userInterfaceStyle == .dark ? 1 : 0
      let color = index == 1 ? dark : light
      return UIColor(red: color.red, green: color.green, blue: color.blue, alpha: color.alpha * opacity[index])
    }
  }
  override func contentSize(fitting width: CGFloat) -> CGSize {
    if let section { return CGSize(width: width, height: section.height(fitting: width)) }
    let actualWidth = node["type"] == "sticky" ? min(width, StructuralBlockConfiguration.stickyWidth) : width
    let inner = max(1, actualWidth - insets.left - insets.right)
    columns?.prepare(width: inner, stacked: width <= StructuralBlockConfiguration.stackedColumnsWidth)
    if let fittedBody {
      fittedBody.height.constant = fittedBody.editor.fittingHeight(width: inner)
      fittedWidth = inner
    }
    let size = stack.systemLayoutSizeFitting(
      CGSize(width: inner, height: UIView.layoutFittingCompressedSize.height), withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel)
    return CGSize(
      width: node["type"] == "sticky" ? min(width, StructuralBlockConfiguration.stickyWidth) : width,
      height: max(
        node["type"] == "sticky" ? StructuralBlockConfiguration.stickyHeight : 1,
        size.height + insets.top + insets.bottom))
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    stack.frame = bounds.inset(by: insets)
    section?.frame = bounds
    if let outline {
      outline.frame = bounds
      outline.path = UIBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), cornerRadius: layer.cornerRadius).cgPath
      resolveBorderColor()
    }
  }
}

/// A collapsible section as the web draws its toggle: the chevron in a gutter
/// of its own, centred on the title's first line, the title beside it and the
/// content under the title when open. Nested editors keep their margin, so
/// each is placed that far outside the box its text has on the web.
@MainActor private final class SectionView: UIView {
  private typealias Style = StructuralBlockConfiguration
  var onToggle: (() -> Void)?
  var onHeightChange: (() -> Void)?
  private let title: EditorView
  private let content: EditorView?
  private let chevron = UIView()
  private let trigger = UIButton(type: .custom)
  private let actionsButton: UIButton?
  /// The title's text size and leading, in ems of the document's text.
  private let level: (fontSize: Double, lineHeight: Double)
  private var lastMeasurement: (width: CGFloat, height: CGFloat)?
  private var resizePending = false

  init(title: EditorView, content: EditorView?, open: Bool, level: String, label: String, chevronColor: UIColor, actions: [UIAction]) {
    self.title = title
    self.level = Style.sectionLevels[level] ?? Style.sectionLevels["paragraph"] ?? (1, 1.6)
    self.content = content
    actionsButton = actions.isEmpty ? nil : UIButton(type: .system)
    super.init(frame: .zero)
    for editor in [content, title].compactMap(\.self) {
      // The web drops the title's margins and the content's last one.
      editor.dropsTrailingSpace = true
      editor.backgroundColor = .clear
      editor.isScrollEnabled = false
      editor.onContentHeightChange = { [weak self] in self?.contentHeightChanged() }
      addSubview(editor)
    }
    // The whole title line opens and closes a read-only section.
    title.isUserInteractionEnabled = false
    title.accessibilityElementsHidden = true
    let size = chevronSize, inset = Style.sectionChevronInset * Self.em
    let scale = (size - 2 * inset) / Style.sectionChevronViewBox
    let path = UIBezierPath()
    for (index, point) in Style.sectionChevronPoints.enumerated() {
      let point = CGPoint(x: inset + point.x * scale, y: inset + point.y * scale)
      if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
    }
    let stroke = CAShapeLayer()
    stroke.path = path.cgPath
    stroke.fillColor = nil
    stroke.lineWidth = Style.sectionChevronStrokeWidth * scale
    stroke.lineCap = .round
    stroke.lineJoin = .round
    chevron.layer.addSublayer(stroke)
    chevron.bounds = CGRect(x: 0, y: 0, width: size, height: size)
    chevron.transform = open ? CGAffineTransform(rotationAngle: .pi / 2) : .identity
    chevron.isUserInteractionEnabled = false
    let paint = { (view: UIView) in stroke.strokeColor = chevronColor.resolvedColor(with: view.traitCollection).cgColor }
    paint(self)
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: Self, _) in paint(view) }
    addSubview(chevron)
    trigger.accessibilityLabel = label
    trigger.accessibilityTraits = .button
    trigger.accessibilityValue = open ? "Expanded" : "Collapsed"
    trigger.addAction(UIAction { [weak self] _ in self?.onToggle?() }, for: .primaryActionTriggered)
    addSubview(trigger)
    if let actionsButton {
      actionsButton.setImage(UIImage(systemName: "ellipsis"), for: .normal)
      actionsButton.tintColor = chevronColor
      actionsButton.accessibilityLabel = "Section actions"
      actionsButton.showsMenuAsPrimaryAction = true
      actionsButton.menu = UIMenu(children: actions)
      addSubview(actionsButton)
    }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  /// Where everything goes in a section `width` wide.
  private struct Layout {
    var height: CGFloat
    var title, trigger, actions, content: CGRect
    var chevronCenter: CGPoint
  }
  /// The document's text size, the web's 16px.
  private static var em: CGFloat { UIFont.preferredFont(forTextStyle: .body).pointSize }
  private var chevronSize: CGFloat { (Style.sectionChevronEm * level.fontSize + Style.sectionChevronRem) * Self.em }
  private func layout(_ width: CGFloat) -> Layout {
    let margin = EditorView.defaultContentMargin, em = Self.em
    let line = level.fontSize * level.lineHeight * em, gutter = Style.sectionGutter * em
    let actionsWidth = actionsButton == nil ? 0 : line
    let titleWidth = max(1, width - gutter - actionsWidth + 2 * margin)
    let titleHeight = max(0, title.fittingHeight(width: titleWidth) - 2 * margin)
    let contentWidth = max(1, width - gutter + 2 * margin)
    let contentHeight = content.map { max(0, $0.fittingHeight(width: contentWidth) - 2 * margin) } ?? 0
    let contentY = titleHeight + (content == nil ? 0 : Style.sectionContentGap * em)
    return Layout(
      height: contentY + contentHeight,
      title: CGRect(x: gutter - margin, y: -margin, width: titleWidth, height: titleHeight + 2 * margin),
      trigger: CGRect(x: 0, y: 0, width: width - actionsWidth, height: titleHeight),
      actions: CGRect(x: width - actionsWidth, y: 0, width: actionsWidth, height: line),
      content: CGRect(x: gutter - margin, y: contentY - margin, width: contentWidth, height: contentHeight + 2 * margin),
      chevronCenter: CGPoint(x: chevronSize / 2, y: line / 2))
  }

  func height(fitting width: CGFloat) -> CGFloat {
    let height = layout(width).height
    lastMeasurement = (width, height)
    return height
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let layout = layout(bounds.width)
    title.frame = layout.title
    chevron.center = layout.chevronCenter
    trigger.frame = layout.trigger
    actionsButton?.frame = layout.actions
    content?.frame = layout.content
  }

  /// Images load after the section was measured; the parent re-measures it
  /// once their height settles.
  private func contentHeightChanged() {
    guard lastMeasurement != nil, !resizePending else { return }
    resizePending = true
    DispatchQueue.main.async { [weak self] in
      guard let self, let measured = self.lastMeasurement else { return }
      self.resizePending = false
      if abs(self.height(fitting: measured.width) - measured.height) > 0.5 { self.onHeightChange?() }
    }
  }
}

@MainActor extension StructuralPanel: UIGestureRecognizerDelegate {
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    node["type"] == "sticky" && owner?.isEditable == true
      && (owner?.bounds.width ?? 0) > StructuralBlockConfiguration.stackedColumnsWidth
      && (touch.view === self || touch.view === stack)
  }
}
