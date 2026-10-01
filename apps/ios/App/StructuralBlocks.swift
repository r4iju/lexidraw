import CSSValues
import EditorModelInterface
import LexicalSwift
import TextKitEditor
import UIKit

/// Panels preview structural bodies; editing them shares the parent model so
/// plugin escapes and repair transforms retain document history and autosave.
@MainActor func configureStructuralBlocks(_ view: EditorView) {
  if view.isEditable && view.supportsRichText {
    let entries: [(String, String)] = [("Callout", "callout"), ("Collapsible section", "collapsible-container"), ("Columns", "layout-container"), ("Page break", "page-break"), ("Sticky note", "sticky"), ("Slide deck", "slide-deck")]
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
  private var viewingSlideOverride: Int?
  private var viewingSlideIndex: Int {
    get {
      if let viewingSlideOverride { return viewingSlideOverride }
      let slides = node["data"]?["slides"]?.arrayValue ?? []
      return slides.firstIndex { $0["id"] == node["data"]?["currentSlideId"] } ?? 0
    }
    set { viewingSlideOverride = newValue }
  }
  private let stack = UIStackView()
  private var columns: NativeColumnsView?
  private var bodies: [EditorView] = []
  private var insets = UIEdgeInsets.zero
  private var dragStart: CGPoint?
  private var viewingSectionOpen: Bool?
  private var selectedSlideElementID: String?

  init(owner: EditorView, key: String) {
    self.owner = owner
    self.key = key
    super.init(frame: .zero)
    stack.axis = .vertical
    stack.spacing = 8
    addSubview(stack)
    let drag = UIPanGestureRecognizer(target: self, action: #selector(dragSticky(_:)))
    drag.delegate = self
    addGestureRecognizer(drag)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func show(_ value: JSONValue) {
    guard value != node else { return }
    if value["data"]?["currentSlideId"] != node["data"]?["currentSlideId"] { selectedSlideElementID = nil }
    node = value
    viewingSectionOpen = nil
    viewingSlideOverride = nil
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
  @discardableResult private func button(_ title: String, viewing: Bool = false, action: @escaping () -> Void) -> UIButton {
    let button = UIButton(type: .system)
    button.setTitle(title, for: .normal)
    button.contentHorizontalAlignment = .leading
    button.addAction(UIAction { _ in action() }, for: .touchUpInside)
    button.isEnabled = viewing || owner?.isEditable == true
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
  private func menu(_ title: String, viewing: Bool = false, entries: [(String, () -> Void)]) {
    let button = button(title, viewing: viewing) {}
    button.showsMenuAsPrimaryAction = true
    button.menu = UIMenu(children: entries.map { name, action in UIAction(title: name) { _ in action() } })
  }
  private func rebuild() {
    for view in stack.arrangedSubviews {
      stack.removeArrangedSubview(view)
      view.removeFromSuperview()
    }
    bodies = []
    columns = nil
    insets = .zero
    layer.cornerRadius = 0
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
    case "slide-deck": slides()
    default: label("Unsupported structural block (#133)")
    }
    setNeedsLayout()
  }

  private func body(
    _ state: JSONValue, parent: UIStackView? = nil, editable: Bool = false, changed: @escaping (JSONValue) -> Void
  ) {
    do {
      let model = Editor(plainText: node["type"] == "sticky")
      try model.load(state)
      let editor =
        owner?.makeNestedEditor(
          model: model, isEditable: editable && owner?.isEditable == true && model.isEditable,
          textSize: node["type"] == "sticky" ? 24 : nil) ?? EditorView(model: model, isEditable: false)
      if owner?.configureNestedEmbeds == nil { configureEmbeddedDrawings(editor) }
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
    backgroundColor = themed(colors).withAlphaComponent(
      StructuralBlockConfiguration.calloutTint[traitCollection.userInterfaceStyle == .dark ? 1 : 0])
    menu(
      title.isEmpty ? StructuralBlockConfiguration.calloutLabels[kind] ?? kind : title,
      entries: StructuralBlockConfiguration.calloutLabels.sorted { $0.key < $1.key }.map { kind, label in
        (label, { [weak self] in self?.field("kind", .string(kind), rebuild: true) })
      })
    button("Edit callout title") { [weak self] in
      self?.rename("Callout title", value: title) { self?.field("title", .string($0), rebuild: true) }
    }
    button("Edit callout body") { [weak self] in self?.editBody() }
    body(document(node["children"]?.arrayValue ?? [])) { _ in }
  }
  private func collapsible() {
    let open = viewingSectionOpen ?? node["open"]?.isTruthy ?? false
    let children = node["children"]?.arrayValue ?? []
    guard children.count == 2, children[0]["type"] == "collapsible-title", children[1]["type"] == "collapsible-content"
    else {
      label("Invalid collapsible structure (#133)")
      return
    }
    button(open ? "Collapse section" : "Expand section", viewing: true) { [weak self] in
      guard let self else { return }
      if self.owner?.isEditable == true { self.field("open", .bool(!open), rebuild: true) }
      else { self.viewingSectionOpen = !open; self.rebuild(); self.owner?.refreshEmbeddedContent() }
    }
    button("Edit section title") { [weak self] in self?.editBody(path: [0]) }
    body(document([paragraph(children[0]["children"]?.arrayValue ?? [])])) { _ in }
    if open {
      button("Edit section content") { [weak self] in self?.editBody(path: [1]) }
      body(document(children[1]["children"]?.arrayValue ?? [])) { _ in }
    }
  }
  private func layoutColumns() {
    menu(
      "Column layout",
      entries: StructuralBlockConfiguration.layouts.map { preset in
        (preset.label, { [weak self] in self?.setColumns(preset.value) })
      })
    let template = node["templateColumns"]?.stringValue ?? ""
    let parts = JSRegExp(StructuralBlockConfiguration.columnWhitespacePattern, flags: "").split(template).filter { !$0.isEmpty }
    let tracks = parts.compactMap(NativeColumnTrack.init)
    let children = node["children"]?.arrayValue ?? []
    guard tracks.count == parts.count, tracks.count == children.count else {
      label("This CSS column template is not supported by native layout (#133): \(template)")
      return
    }
    let columns = NativeColumnsView(tracks: tracks, gap: 8)
    stack.addArrangedSubview(columns)
    self.columns = columns
    for (index, child) in children.enumerated() {
      let column = UIStackView()
      column.axis = .vertical
      columns.addColumn(column)
      let edit = UIButton(type: .system)
      edit.setTitle("Edit column \(index + 1)", for: .normal)
      edit.isEnabled = owner?.isEditable == true
      edit.addAction(UIAction { [weak self] _ in self?.editBody(path: [index]) }, for: .touchUpInside)
      column.addArrangedSubview(edit)
      body(document(child["children"]?.arrayValue ?? []), parent: column) { _ in }
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
    let count = JSRegExp(StructuralBlockConfiguration.columnWhitespacePattern, flags: "").split(value).filter { !$0.isEmpty }.count
    var children = node["children"]?.arrayValue ?? []
    while children.count < count {
      children.append(["type": "layout-item", "version": 1, "children": [paragraph([])]])
    }
    if children.count > count { children.removeSubrange(count...) }
    var fields = node.objectValue ?? [:]
    fields["templateColumns"] = .string(value)
    fields["children"] = .array(children)
    save(.object(fields), rebuild: true)
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
      save(.object(fields))
      owner?.setNeedsLayout()
    case .cancelled, .failed:
      dragStart = nil
      owner?.setNeedsLayout()
    default: break
    }
  }
  private func sticky() {
    let color = node["color"]?.stringValue ?? ""
    backgroundColor = themed(StructuralBlockConfiguration.stickyColors[color] ?? [])
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
    body(node["caption"]?["editorState"] ?? document([]), editable: true) { [weak self] state in
      guard let self else { return }
      var caption = self.node["caption"]?.objectValue ?? [:]
      caption["editorState"] = state
      self.field("caption", .object(caption))
    }
  }
  private func slides() {
    let slides = node["data"]?["slides"]?.arrayValue ?? []
    let index = min(viewingSlideIndex, max(slides.count - 1, 0))
    button("Add slide") { [weak self] in self?.addSlide() }
    guard slides.indices.contains(index) else {
      label("Empty slide deck")
      return
    }
    menu(
      "Edit slide",
      entries: [
        ("Add text", { [weak self] in self?.addSlideElement(kind: "box", slide: index) }),
        ("Add chart", { [weak self] in self?.addSlideElement(kind: "chart", slide: index) }),
        (
          "Add image",
          { [weak self] in
            self?.rename("Image URL", value: "") { self?.addSlideElement(kind: "image", slide: index, url: $0) }
          }
        ),
        (
          "Slide background",
          { [weak self] in
            self?.rename("Slide background (CSS color)", value: slides[index]["backgroundColor"]?.stringValue ?? "") {
              self?.updateSlide(slide: index, field: "backgroundColor", value: .string($0))
            }
          }
        ),
        (
          "Speaker notes",
          { [weak self] in
            self?.rename("Speaker notes", value: slides[index]["slideMetadata"]?["speakerNotes"]?.stringValue ?? "") {
              notes in
              var metadata = slides[index]["slideMetadata"]?.objectValue ?? [:]
              metadata["speakerNotes"] = .string(notes)
              self?.updateSlide(slide: index, field: "slideMetadata", value: .object(metadata))
            }
          }
        ),
        ("Move slide earlier", { [weak self] in self?.moveSlide(index, by: -1) }),
        ("Move slide later", { [weak self] in self?.moveSlide(index, by: 1) }),
        ("Delete slide", { [weak self] in self?.deleteSlide(index) }),
      ])
    menu(
      "Slide \(index + 1) of \(slides.count)", viewing: true,
      entries: slides.enumerated().map { offset, _ in
        (
          "Slide \(offset + 1)",
          { [weak self] in
            guard let self else { return }
            if self.owner?.isEditable == true {
              var data = self.node["data"]?.objectValue ?? [:]
              data["currentSlideId"] = slides[offset]["id"]
              self.field("data", .object(data), rebuild: true)
            } else {
              self.viewingSlideIndex = offset
              self.rebuild()
              self.owner?.refreshEmbeddedContent()
            }
          }
        )
      })
    let canvas = SlideCanvas(
      slide: slides[index],
      makeEditor: { [weak owner] model in
        owner?.makeNestedEditor(model: model, isEditable: false) ?? EditorView(model: model, isEditable: false)
      },
      imageLoader: owner?.mediaImageLoader,
      provider: { [weak owner] node in
        owner?.embeddedContent?("\(self.key)-slide-\(index)-\(node["id"]?.stringValue ?? "")", node)
      })
    canvas.onEdit = { [weak self] element in self?.editSlideElement(slide: index, element: element) }
    let opened = node
    canvas.onGeometryChange = { [weak self] element, updates in
      guard let self, self.node == opened,
        var fields = slides[index]["elements"]?.arrayValue?[element].objectValue else { return }
      for (field, value) in updates { fields[field] = value }
      self.replaceSlideElement(slide: index, element: element, value: .object(fields))
    }
    canvas.onSelection = { [weak self] element in
      self?.selectedSlideElementID = element.flatMap { slides[index]["elements"]?.arrayValue?[$0]["id"]?.stringValue }
    }
    canvas.isEditable = owner?.isEditable == true
    if let selectedSlideElementID {
      canvas.restoreSelection((slides[index]["elements"]?.arrayValue ?? []).firstIndex { $0["id"] == .string(selectedSlideElementID) })
    }
    stack.addArrangedSubview(canvas)
    canvas.heightAnchor.constraint(
      equalTo: canvas.widthAnchor,
      multiplier: StructuralBlockConfiguration.slideHeight / StructuralBlockConfiguration.slideWidth
    ).isActive = true
  }

  private func editSlideElement(slide: Int, element: Int) {
    guard let value = node["data"]?["slides"]?.arrayValue?[slide]["elements"]?.arrayValue?[element] else { return }
    let alert = UIAlertController(
      title: "Edit \(value["kind"]?.stringValue ?? "element")", message: nil, preferredStyle: .actionSheet)
    alert.addAction(
      UIAlertAction(title: "Edit content", style: .default) { [weak self] _ in
        self?.editSlideContent(slide: slide, element: element)
      })
    alert.addAction(
      UIAlertAction(title: "Position and size", style: .default) { [weak self] _ in
        self?.editSlideGeometry(slide: slide, element: element)
      })
    if value["kind"] == "box" {
      alert.addAction(
        UIAlertAction(title: "Background color", style: .default) { [weak self] _ in
          self?.rename("Background (CSS color)", value: value["backgroundColor"]?.stringValue ?? "") {
            self?.updateSlideElement(slide: slide, element: element, field: "backgroundColor", value: .string($0))
          }
        })
    }
    if value["kind"] == "chart" {
      alert.addAction(
        UIAlertAction(title: "Chart options", style: .default) { [weak self] _ in
          self?.rename("Chart configuration", value: value["chartConfig"]?.stringValue ?? "") {
            self?.updateSlideElement(slide: slide, element: element, field: "chartConfig", value: .string($0))
          }
        })
      for kind in StructuralBlockConfiguration.chartTypes {
        alert.addAction(
          UIAlertAction(title: "Use \(kind) chart", style: .default) { [weak self] _ in
            self?.updateSlideElement(slide: slide, element: element, field: "chartType", value: .string(kind))
          })
      }
    }
    alert.addAction(
      UIAlertAction(title: "Bring to front", style: .default) { [weak self] _ in
        guard let self else { return }
        let elements = self.node["data"]?["slides"]?.arrayValue?[slide]["elements"]?.arrayValue ?? []
        let next = (elements.compactMap { $0["zIndex"]?.numberValue }.max() ?? -1) + 1
        self.updateSlideElement(slide: slide, element: element, field: "zIndex", value: .number(next))
      })
    alert.addAction(
      UIAlertAction(title: "Delete element", style: .destructive) { [weak self] _ in
        self?.deleteSlideElement(slide: slide, element: element)
      })
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.popoverPresentationController?.sourceView = self
    alert.popoverPresentationController?.sourceRect = bounds
    parentController()?.present(alert, animated: true)
  }
  private func editSlideGeometry(slide: Int, element: Int) {
    guard let value = node["data"]?["slides"]?.arrayValue?[slide]["elements"]?.arrayValue?[element] else { return }
    let alert = UIAlertController(
      title: "Position and size", message: "Values use slide design coordinates.", preferredStyle: .alert)
    let names = ["x", "y", "width", "height"]
    for name in names {
      alert.addTextField { field in
        field.placeholder = name.capitalized
        field.text = value[name]?.numberValue.map { String($0) } ?? value[name]?.stringValue ?? ""
        field.keyboardType = .numbersAndPunctuation
      }
    }
    let opened = node
    alert.addAction(
      UIAlertAction(title: "Save", style: .default) { [weak self] _ in
        guard let self, self.node == opened else { return }
        var fields = value.objectValue ?? [:]
        for (index, name) in names.enumerated() {
          guard let text = alert.textFields?[index].text, let number = Double(text), number.isFinite,
            index < 2 || number > 0
          else {
            self.presentError(EditorError.invalidState("Position and size must be finite; sizes must be positive"))
            return
          }
          fields[name] = .number(number)
        }
        self.replaceSlideElement(slide: slide, element: element, value: .object(fields))
      })
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    parentController()?.present(alert, animated: true)
  }
  private func editSlideContent(slide: Int, element: Int) {
    guard let value = node["data"]?["slides"]?.arrayValue?[slide]["elements"]?.arrayValue?[element] else { return }
    switch value["kind"]?.stringValue {
    case "box":
      presentBody(value["editorStateJSON"] ?? document([]), title: "Slide text") { [weak self] state in
        self?.updateSlideElement(slide: slide, element: element, field: "editorStateJSON", value: state)
      }
    case "image":
      rename("Image URL", value: value["url"]?.stringValue ?? "") { [weak self] url in
        guard URL(string: url)?.scheme == "https" else {
          self?.presentError(EditorError.invalidState("Images require an HTTPS URL"))
          return
        }
        self?.updateSlideElement(slide: slide, element: element, field: "url", value: .string(url))
      }
    case "chart":
      rename("Chart data", value: value["chartData"]?.stringValue ?? "") { [weak self] data in
        self?.updateSlideElement(slide: slide, element: element, field: "chartData", value: .string(data))
      }
    default: presentError(EditorError.unsupported("Unknown slide element (#133)"))
    }
  }
  private func addSlide() {
    var data = node["data"]?.objectValue ?? [:]
    var slides = data["slides"]?.arrayValue ?? []
    let id = "slide-\(UUID().uuidString)"
    let index = min(viewingSlideIndex + 1, slides.count)
    slides.insert(["id": .string(id), "elements": []], at: index)
    data["slides"] = .array(slides)
    data["currentSlideId"] = .string(id)
    viewingSlideIndex = index
    field("data", .object(data), rebuild: true)
  }
  private func deleteSlide(_ index: Int) {
    var data = node["data"]?.objectValue ?? [:]
    var slides = data["slides"]?.arrayValue ?? []
    guard slides.count > 1, slides.indices.contains(index) else {
      presentError(EditorError.invalidState("A deck needs at least one slide"))
      return
    }
    slides.remove(at: index)
    viewingSlideIndex = min(index, slides.count - 1)
    data["slides"] = .array(slides)
    data["currentSlideId"] = slides[viewingSlideIndex]["id"]
    field("data", .object(data), rebuild: true)
  }
  private func moveSlide(_ index: Int, by offset: Int) {
    var data = node["data"]?.objectValue ?? [:]
    var slides = data["slides"]?.arrayValue ?? []
    guard slides.indices.contains(index), slides.indices.contains(index + offset) else { return }
    slides.swapAt(index, index + offset)
    viewingSlideIndex = index + offset
    data["slides"] = .array(slides)
    field("data", .object(data), rebuild: true)
  }
  private func updateSlide(slide: Int, field name: String, value: JSONValue) {
    var data = node["data"]?.objectValue ?? [:]
    var slides = data["slides"]?.arrayValue ?? []
    guard slides.indices.contains(slide), var fields = slides[slide].objectValue else { return }
    fields[name] = value
    slides[slide] = .object(fields)
    data["slides"] = .array(slides)
    field("data", .object(data), rebuild: true)
  }
  private func addSlideElement(kind: String, slide: Int, url: String? = nil) {
    do {
      guard let template = StructuralBlockConfiguration.slideElements[kind],
        var fields = try JSONValue(parsing: template).objectValue
      else { throw EditorError.unsupported("Unknown slide element (#133)") }
      var elements = node["data"]?["slides"]?.arrayValue?[slide]["elements"]?.arrayValue ?? []
      if kind == "image" {
        guard let url, URL(string: url)?.scheme == "https" else {
          throw EditorError.invalidState("Images require an HTTPS URL")
        }
        fields["url"] = .string(url)
      }
      fields["id"] = .string("\(kind)-\(UUID().uuidString)")
      fields["zIndex"] = .number((elements.compactMap { $0["zIndex"]?.numberValue }.max() ?? -1) + 1)
      elements.append(.object(fields))
      updateSlide(slide: slide, field: "elements", value: .array(elements))
    } catch { presentError(error) }
  }
  private func deleteSlideElement(slide: Int, element: Int) {
    var elements = node["data"]?["slides"]?.arrayValue?[slide]["elements"]?.arrayValue ?? []
    guard elements.indices.contains(element) else { return }
    elements.remove(at: element)
    updateSlide(slide: slide, field: "elements", value: .array(elements))
  }
  private func replaceSlideElement(slide: Int, element: Int, value: JSONValue) {
    var elements = node["data"]?["slides"]?.arrayValue?[slide]["elements"]?.arrayValue ?? []
    guard elements.indices.contains(element) else { return }
    elements[element] = value
    updateSlide(slide: slide, field: "elements", value: .array(elements))
  }
  private func updateSlideElement(slide: Int, element: Int, field: String, value: JSONValue) {
    var data = node["data"]?.objectValue ?? [:]
    var slides = data["slides"]?.arrayValue ?? []
    guard slides.indices.contains(slide) else { return }
    var fields = slides[slide].objectValue ?? [:]
    var elements = fields["elements"]?.arrayValue ?? []
    guard elements.indices.contains(element) else { return }
    var changed = elements[element].objectValue ?? [:]
    changed[field] = value
    elements[element] = .object(changed)
    fields["elements"] = .array(elements)
    slides[slide] = .object(fields)
    data["slides"] = .array(slides)
    self.field("data", .object(data), rebuild: true)
  }
  private func presentBody(_ state: JSONValue, title: String, changed: @escaping (JSONValue) -> Void) {
    do {
      let model = Editor()
      try model.loadKeyed(state)
      let editor =
        owner?.makeNestedEditor(model: model, isEditable: owner?.isEditable == true && model.isEditable)
        ?? EditorView(model: model, isEditable: false)
      if owner?.configureNestedEmbeds == nil { configureEmbeddedDrawings(editor) }
      var opened = node
      editor.onChange = { [weak self] in
        guard let self else { return }
        guard self.node == opened else {
          self.presentError(EditorError.invalidState("The block changed while its editor was open"))
          return
        }
        do {
          changed(try model.serializedKeyedState())
          opened = self.node
        } catch { self.presentError(error) }
      }
      let controller = UIViewController()
      controller.title = title
      controller.view = NativeEditorHost(editor: editor)
      let navigation = UINavigationController(rootViewController: controller)
      controller.navigationItem.rightBarButtonItem = UIBarButtonItem(
        systemItem: .done, primaryAction: UIAction { _ in navigation.dismiss(animated: true) })
      parentController()?.present(navigation, animated: true)
    } catch { presentError(error) }
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
    var responder: UIResponder? = owner
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
  private func themed(_ values: [String]) -> UIColor {
    UIColor { traits in
      guard values.count == 2, let color = CSSColor(values[traits.userInterfaceStyle == .dark ? 1 : 0]) else {
        return .clear
      }
      return UIColor(red: color.red, green: color.green, blue: color.blue, alpha: color.alpha)
    }
  }
  override func contentSize(fitting width: CGFloat) -> CGSize {
    let actualWidth = node["type"] == "sticky" ? min(width, StructuralBlockConfiguration.stickyWidth) : width
    let inner = max(1, actualWidth - insets.left - insets.right)
    columns?.prepare(width: inner, stacked: width <= StructuralBlockConfiguration.stackedColumnsWidth)
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
  }
}

@MainActor private final class SlideCanvas: UIView, UIGestureRecognizerDelegate {
  var onEdit: ((Int) -> Void)?
  var onGeometryChange: ((Int, JSONObject) -> Void)?
  var onSelection: ((Int?) -> Void)?
  var isEditable = false {
    didSet {
      for (view, _) in elements {
        for gesture in view.gestureRecognizers ?? [] where gesture is UIPanGestureRecognizer { gesture.isEnabled = isEditable }
      }
      if !isEditable { selectedElement = nil; showHandles() }
    }
  }
  private var selectedElement: Int?
  private var handles: [(UIView, String)] = []
  private var gestureStart: (index: Int, fields: JSONObject)?
  private var preview: JSONObject?

  private let slide: JSONValue
  private let stage = UIView()
  private var elements: [(UIView, JSONValue)] = []
  private var downloads: [Task<Void, Never>] = []

  init(slide: JSONValue, makeEditor: (any EditorModel) -> EditorView, imageLoader: MediaImageLoader?, provider: (JSONValue) -> EmbeddedContentView?) {
    self.slide = slide
    super.init(frame: .zero)
    clipsToBounds = true
    addSubview(stage)
    let backgroundTap = UITapGestureRecognizer(target: self, action: #selector(deselectElement))
    backgroundTap.delegate = self
    addGestureRecognizer(backgroundTap)
    stage.backgroundColor =
      slide["backgroundColor"]?.stringValue.flatMap(CSSColor.init).map {
        UIColor(red: $0.red, green: $0.green, blue: $0.blue, alpha: $0.alpha)
      } ?? .systemBackground
    let values = slide["elements"]?.arrayValue ?? []
    for (index, value) in values.enumerated().sorted(by: {
      ($0.element["zIndex"]?.numberValue ?? 0) < ($1.element["zIndex"]?.numberValue ?? 0)
    }) {
      let view: UIView
      switch value["kind"]?.stringValue {
      case "box":
        do {
          let model = Editor()
          try model.loadKeyed(value["editorStateJSON"] ?? ["root": ["type": "root", "version": 1, "children": []]])
          let editor = makeEditor(model)
          editor.isUserInteractionEnabled = false
          editor.backgroundColor =
            value["backgroundColor"]?.stringValue.flatMap(CSSColor.init).map {
              UIColor(red: $0.red, green: $0.green, blue: $0.blue, alpha: $0.alpha)
            } ?? .clear
          view = editor
        } catch {
          let label = UILabel()
          label.text = "Invalid slide text: \(error.localizedDescription)"
          label.numberOfLines = 0
          view = label
        }
      case "image":
        let image = UIImageView()
        image.contentMode = .scaleAspectFit
        image.accessibilityLabel = "Slide image"
        view = image
        if let source = value["url"]?.stringValue, let url = URL(string: source), url.scheme == "https" {
          downloads.append(
            Task { [weak image] in
              do {
                let decoded = try await (imageLoader ?? NativeMediaImages.load)(url)
                try Task.checkCancellation()
                image?.image = decoded
              } catch { image?.accessibilityLabel = "Slide image could not load" }
            })
        }
      case "chart":
        var fields = value.objectValue ?? [:]
        fields["type"] = "chart"
        fields["version"] = 1
        if let chart = provider(.object(fields)) {
          chart.show(.object(fields))
          // The synthetic preview key is not a document node. The deck owns editing.
          (chart as? RenderedEmbedView)?.open = nil
          for gesture in chart.gestureRecognizers ?? [] where gesture is UITapGestureRecognizer {
            chart.removeGestureRecognizer(gesture)
          }
          view = chart
        } else {
          let label = UILabel()
          label.text = "Chart rendering requires #132"
          label.numberOfLines = 0
          view = label
        }
      default:
        let label = UILabel()
        label.text = "Unknown slide element (#133)"
        label.numberOfLines = 0
        view = label
      }
      // Cached chart previews may still carry the previous canvas's move recognizer.
      for gesture in view.gestureRecognizers ?? [] where gesture.name == "native-slide-move" {
        view.removeGestureRecognizer(gesture)
      }
      stage.addSubview(view)
      elements.append((view, value))
      let tap = UITapGestureRecognizer(target: self, action: #selector(edit(_:)))
      view.isUserInteractionEnabled = true
      view.tag = index
      view.addGestureRecognizer(tap)
      let pan = UIPanGestureRecognizer(target: self, action: #selector(moveElement(_:)))
      pan.maximumNumberOfTouches = 1
      pan.name = "native-slide-move"
      pan.isEnabled = isEditable
      view.addGestureRecognizer(pan)
      tap.require(toFail: pan)
    }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  deinit { downloads.forEach { $0.cancel() } }
  @objc private func edit(_ recognizer: UITapGestureRecognizer) {
    guard isEditable, let index = recognizer.view?.tag else { return }
    if selectedElement != index {
      selectedElement = index
      onSelection?(index)
      showHandles()
      setNeedsLayout()
    } else { onEdit?(index) }
  }
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    touch.view === self || touch.view === stage
  }
  @objc private func deselectElement() {
    restoreSelection(nil)
    onSelection?(nil)
  }
  func restoreSelection(_ index: Int?) {
    selectedElement = index
    showHandles()
    setNeedsLayout()
  }
  private func showHandles() {
    handles.forEach { $0.0.removeFromSuperview() }
    handles = []
    guard isEditable, let index = selectedElement else { return }
    for corner in ["nw", "ne", "sw", "se"] {
      let handle = UIView()
      handle.backgroundColor = .systemBlue
      handle.layer.cornerRadius = 6
      handle.tag = index
      handle.accessibilityLabel = "Resize slide element \(index + 1), \(corner)"
      handle.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(resize(_:))))
      stage.addSubview(handle)
      handles.append((handle, corner))
    }
  }
  @objc private func moveElement(_ gesture: UIPanGestureRecognizer) { changeGeometry(gesture, corner: nil) }
  @objc private func resize(_ gesture: UIPanGestureRecognizer) {
    guard let corner = handles.first(where: { $0.0 === gesture.view })?.1 else { return }
    changeGeometry(gesture, corner: corner)
  }
  private func changeGeometry(_ gesture: UIPanGestureRecognizer, corner: String?) {
    guard isEditable, let index = gesture.view?.tag,
      let value = slide["elements"]?.arrayValue?[index], let fields = value.objectValue else { return }
    if gesture.state == .began {
      selectedElement = index
      onSelection?(index)
      gestureStart = (index, fields)
      if corner == nil { showHandles() }
    }
    guard let initial = gestureStart, initial.index == index else { return }
    let delta = gesture.translation(in: stage)
    var changed = initial.fields
    let x = initial.fields["x"]?.numberValue ?? 0
    let y = initial.fields["y"]?.numberValue ?? 0
    if let corner {
      if let width = initial.fields["width"]?.numberValue {
        let resized = max(StructuralBlockConfiguration.slideMinimumWidth, width + (corner.contains("w") ? -delta.x : delta.x))
        changed["width"] = .number(resized)
        if corner.contains("w") { changed["x"] = .number(x + width - resized) }
      }
      if let height = initial.fields["height"]?.numberValue {
        let resized = max(StructuralBlockConfiguration.slideMinimumHeight, height + (corner.contains("n") ? -delta.y : delta.y))
        changed["height"] = .number(resized)
        if corner.contains("n") { changed["y"] = .number(y + height - resized) }
      }
    } else {
      changed["x"] = .number(x + delta.x)
      changed["y"] = .number(y + delta.y)
    }
    preview = changed
    setNeedsLayout()
    if gesture.state == .ended {
      let updates = JSONObject(changed.filter { initial.fields[$0.key] != $0.value })
      gestureStart = nil
      preview = nil
      if !updates.isEmpty { onGeometryChange?(index, updates) }
    } else if gesture.state == .cancelled || gesture.state == .failed {
      gestureStart = nil
      preview = nil
    }
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    let scale = bounds.width / StructuralBlockConfiguration.slideWidth
    stage.transform = .identity
    stage.frame = CGRect(
      x: 0, y: 0, width: StructuralBlockConfiguration.slideWidth, height: StructuralBlockConfiguration.slideHeight)
    for (view, stored) in elements {
      let value = view.tag == gestureStart?.index ? preview.map(JSONValue.object) ?? stored : stored
      let width = value["width"] == "inherit" ? StructuralBlockConfiguration.slideWidth : value["width"]?.numberValue ?? 0
      let box = value["kind"] == "box"
      let minimumHeight = value["height"]?.numberValue ?? (box ? 0 : StructuralBlockConfiguration.slideHeight)
      view.frame = CGRect(x: value["x"]?.numberValue ?? 0, y: value["y"]?.numberValue ?? 0,
        width: width, height: minimumHeight)
      view.layoutIfNeeded()
      // Web text boxes have auto height and the stored numeric height as a minimum.
      if box, let editor = view as? EditorView { view.frame.size.height = max(minimumHeight, editor.contentSize.height) }
    }
    if let selected = selectedElement, let view = elements.first(where: { $0.0.tag == selected })?.0 {
      for (handle, corner) in handles {
        let point = CGPoint(x: corner.contains("w") ? view.frame.minX : view.frame.maxX,
          y: corner.contains("n") ? view.frame.minY : view.frame.maxY)
        let size = 24 / max(scale, 0.01)
        handle.frame = CGRect(x: point.x - size / 2, y: point.y - size / 2, width: size, height: size)
        stage.bringSubviewToFront(handle)
      }
    }
    stage.transform = CGAffineTransform(scaleX: scale, y: scale)
    stage.frame.origin = .zero
  }
}

@MainActor extension StructuralPanel: UIGestureRecognizerDelegate {
  func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    node["type"] == "sticky" && owner?.isEditable == true
      && (owner?.bounds.width ?? 0) > StructuralBlockConfiguration.stackedColumnsWidth
      && (touch.view === self || touch.view === stack)
  }
}
