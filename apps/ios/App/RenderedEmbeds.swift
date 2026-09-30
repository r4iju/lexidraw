import LexicalSwift
import EditorModelInterface
import LexidrawKit
import SwiftUI
import TextKitEditor
import UIKit

@MainActor func configureRenderedEmbeds(_ view: EditorView, session: Session, fontFamily: String = RenderedEmbedStyle.defaultFontFamily) {
  let previousContent = view.embeddedContent
  let previousInline = view.inlineEmbeddedContent
  let previousTap = view.onEmbeddedTap
  let images = NSCache<NSString, RenderedEmbedView>()
  images.countLimit = 100
  let supported: Set<String> = ["mermaid", "equation", "chart", "code"]
  let open: (String, JSONValue) -> Bool = { [weak view] key, node in
    guard let view, let type = node["type"]?.stringValue, supported.contains(type) else { return false }
    var responder: UIResponder? = view
    while responder != nil, !(responder is UIViewController) { responder = responder?.next }
    guard let parent = responder as? UIViewController else { return false }
    view.resignFirstResponder()
    let host = UIHostingController(rootView: RenderedSourceEditor(node: node, editable: view.isEditable) { [weak view] replacement in
      guard let view else { throw EditorError.invalidState("The document closed") }
      try view.replaceRenderedNode(key: key, expected: node, replacement: replacement)
    })
    host.modalPresentationStyle = .pageSheet
    parent.present(host, animated: true)
    return true
  }
  let image: (String, JSONValue) -> RenderedEmbedView? = { [weak view] key, node in
    guard let view else { return nil }
    guard let type = node["type"]?.stringValue, supported.contains(type) else { return nil }
    let result: RenderedEmbedView
    if let cached = images.object(forKey: key as NSString) { result = cached }
    else {
      result = RenderedEmbedView(session: session, fontFamily: fontFamily)
      result.onRendered = { [weak view] in view?.refreshEmbeddedContent() }
      images.setObject(result, forKey: key as NSString)
    }
    result.open = { _ = open(key, node) }
    result.overrideUserInterfaceStyle = view.traitCollection.userInterfaceStyle
    result.show(node)
    return result
  }
  view.embeddedContent = { key, node in image(key, node) ?? previousContent?(key, node) }
  view.inlineEmbeddedContent = { key, node, width in
    guard node["type"] == "equation", node["inline"] == true else { return previousInline?(key, node, width) }
    let attachment = RenderedEquationAttachment(cached: images.object(forKey: key as NSString), width: width) { image(key, node) }
    return attachment
  }
  view.onEmbeddedTap = { key, node in open(key, node) || previousTap?(key, node) == true }
}

@MainActor final class RenderedEmbedView: EmbeddedContentView {
  let session: Session
  let fontFamily: String
  var node: JSONValue = .null
  var image: UIImage?
  var open: (() -> Void)?
  var onRendered: (() -> Void)?
  private let picture = UIImageView()
  private let status = UILabel()
  private var task: Task<Void, Never>?
  private var signature: String?
  private var natural = CGSize(width: 320, height: 180)

  init(session: Session, fontFamily: String) {
    self.session = session
    self.fontFamily = fontFamily
    super.init(frame: .zero)
    picture.contentMode = .scaleAspectFit
    status.numberOfLines = 0
    status.textAlignment = .center
    status.font = .preferredFont(forTextStyle: .footnote)
    addSubview(picture)
    addSubview(status)
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tap)))
    accessibilityTraits = .button
    registerForTraitChanges([UITraitUserInterfaceStyle.self, UITraitPreferredContentSizeCategory.self]) { (view: RenderedEmbedView, _: UITraitCollection) in
      view.signature = nil
      view.setNeedsLayout()
      view.onRendered?()
    }
  }
  required init?(coder: NSCoder) { fatalError("RenderedEmbedView is made in code") }
  override func show(_ node: JSONValue) {
    if self.node != node { signature = nil; self.node = node }
    accessibilityLabel = "\(node["type"]?.stringValue ?? "Rendered node"). Edit source"
    setNeedsLayout()
  }
  func cachedSize(fitting width: CGFloat) -> CGSize {
    CGSize(width: min(width, natural.width), height: max(min(width, natural.width) * natural.height / max(natural.width, 1), 20))
  }
  override func contentSize(fitting width: CGFloat) -> CGSize {
    let inline = node["type"] == "equation" && node["inline"] == true
    let em = UIFont.preferredFont(forTextStyle: .body).pointSize
    var column = min(width, FigureStyle.columnRem * em)
    if let figureWidth = node["$"]?["figure"]?["width"]?.stringValue {
      switch figureWidth {
      case "wide": column = min(width, FigureStyle.wideRem * em)
      case "full": column = width
      default:
        if figureWidth.hasSuffix("%"), let share = Double(figureWidth.dropLast()) {
          let least = width <= FigureStyle.phoneWidth ? width : min(width, FigureStyle.minimumShareRem * em)
          column = min(width, max(column * share / 100, least))
        }
      }
    }
    let target = inline ? min(width, natural.width) : min(column, CGFloat(node["width"]?.numberValue ?? Double(column)))
    render(width: max(target, 100))
    let height = target * natural.height / max(natural.width, 1)
    return CGSize(width: target, height: max(height, 20))
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    picture.frame = bounds
    status.frame = bounds.insetBy(dx: 8, dy: 8)
    _ = contentSize(fitting: max(bounds.width, 100))
  }
  private func render(width: CGFloat) {
    let dark = traitCollection.userInterfaceStyle == .dark
    let size = UIFont.preferredFont(forTextStyle: .body).pointSize
    let next = "\(node.stringified)|\(dark)|\(Int(width))|\(size)"
    guard signature != next else { return }
    signature = next
    task?.cancel()
    status.text = "Rendering…"
    task = Task { [weak self, session, fontFamily, node] in
      do {
        let result = try await session.renderEmbed(node: node, dark: dark, width: min(max(Int(width), 100), 2048), fontFamily: fontFamily, fontSize: Double(size))
        guard !Task.isCancelled, let self, self.signature == next else { return }
        guard let image = UIImage(data: result.png) else { throw EditorError.invalidState("The renderer returned an unreadable image") }
        self.image = image
        picture.image = image
        natural = CGSize(width: result.width, height: result.height)
        status.text = nil
        onRendered?()
      } catch {
        guard !Task.isCancelled, let self, self.signature == next else { return }
        status.text = "Couldn’t render. Tap to edit the source.\n\(error.localizedDescription)"
        image = nil
        picture.image = nil
      }
    }
  }
  deinit { task?.cancel() }
  @objc private func tap() { open?() }
}

@MainActor private final class RenderedEquationAttachment: NSTextAttachment, LazyTextAttachment {
  private let makeRendered: () -> RenderedEmbedView?
  let width: CGFloat
  private var started = false
  init(cached: RenderedEmbedView?, width: CGFloat, makeRendered: @escaping () -> RenderedEmbedView?) {
    self.makeRendered = makeRendered
    self.width = width
    super.init(data: nil, ofType: nil)
    image = cached?.image ?? UIImage(systemName: "function")
    let size = cached?.cachedSize(fitting: width) ?? CGSize(width: 20, height: 20)
    bounds = CGRect(x: 0, y: -3, width: size.width, height: size.height)
  }
  required init?(coder: NSCoder) { fatalError("Equation attachment is made in code") }
  func load(onChange: @escaping @MainActor () -> Void) {
    guard !started else { return }
    started = true
    _ = makeRendered()?.contentSize(fitting: width)
    // Provider completion refreshes EditorView so the attachment is rebuilt
    // with the measured image. No document-wide network work starts here.
  }
}

private struct RenderedSourceEditor: View {
  let node: JSONValue
  let editable: Bool
  let save: (JSONValue) throws -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var source: String
  @State private var secondary: String
  @State private var language: String
  @State private var error: String?
  init(node: JSONValue, editable: Bool, save: @escaping (JSONValue) throws -> Void) {
    self.node = node
    self.editable = editable
    self.save = save
    let type = node["type"]?.stringValue
    _source = State(initialValue: type == "mermaid" ? node["schema"]?.stringValue ?? "" : type == "equation" ? node["equation"]?.stringValue ?? "" : type == "chart" ? node["chartData"]?.stringValue ?? "[]" : (node["children"]?.arrayValue ?? []).map { $0["type"] == "linebreak" ? "\n" : $0["type"] == "tab" ? "\t" : $0["text"]?.stringValue ?? "" }.joined())
    _secondary = State(initialValue: node["chartConfig"]?.stringValue ?? "{}")
    _language = State(initialValue: node["type"] == "chart" ? node["chartType"]?.stringValue ?? "bar" : node["language"]?.stringValue ?? "")
  }
  var body: some View {
    NavigationStack {
      Form {
        if node["type"] == "chart" {
          Picker("Chart type", selection: $language) {
            ForEach(RenderedEmbedStyle.chartTypes, id: \.self) { Text($0.capitalized).tag($0) }
          }.disabled(!editable)
        } else if node["type"] == "code" {
          TextField("Language", text: $language).disabled(!editable)
        }
        Section(node["type"] == "chart" ? "Data (JSON)" : "Source") {
          TextEditor(text: $source).font(.system(.body, design: .monospaced)).frame(minHeight: 240).disabled(!editable)
        }
        if node["type"] == "chart" {
          Section("Configuration (JSON)") { TextEditor(text: $secondary).font(.system(.body, design: .monospaced)).frame(minHeight: 160).disabled(!editable) }
        }
      }
      .navigationTitle("\(node["type"]?.stringValue?.capitalized ?? "Node") source")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button(editable ? "Cancel" : "Done") { dismiss() } }
        if editable { ToolbarItem(placement: .confirmationAction) { Button("Save") { commit() } } }
      }
      .alert("Couldn’t save", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("OK") { error = nil } } message: { Text(error ?? "") }
    }
  }
  private func commit() {
    do {
      let originalSource = node["type"] == "code" ? (node["children"]?.arrayValue ?? []).map { $0["type"] == "linebreak" ? "\n" : $0["type"] == "tab" ? "\t" : $0["text"]?.stringValue ?? "" }.joined() : nil
      if node["type"] == "code", source == originalSource, language == (node["language"]?.stringValue ?? "") { dismiss(); return }
      guard var fields = node.objectValue else { throw EditorError.invalidState("Invalid node") }
      switch node["type"]?.stringValue {
      case "mermaid":
        fields["schema"] = .string(source)
        if source != node["schema"]?.stringValue, var state = fields["$"]?.objectValue {
          state["natural"] = nil
          fields["$"] = state.isEmpty ? nil : .object(state)
        }
      case "equation": fields["equation"] = .string(source)
      case "chart":
        guard try JSONValue(parsing: source).arrayValue != nil, try JSONValue(parsing: secondary).objectValue != nil else { throw EditorError.invalidState("Chart data must be an array and configuration an object") }
        fields["chartData"] = .string(source)
        fields["chartConfig"] = .string(secondary)
        fields["chartType"] = .string(language)
      case "code":
        fields["language"] = language.isEmpty ? nil : .string(language)
        fields["children"] = .array(source.components(separatedBy: "\n").enumerated().flatMap { index, line -> [JSONValue] in
          var nodes: [JSONValue] = index > 0 ? [["type": "linebreak", "version": 1]] : []
          for (tabIndex, part) in line.components(separatedBy: "\t").enumerated() {
            if tabIndex > 0 { nodes.append(["type": .string(SerializedTabNode.type), "version": .number(Double(SerializedTabNode.version)), "text": "\t", "format": 0, "detail": 0, "mode": "normal", "style": ""]) }
            if !part.isEmpty { nodes.append(["type": .string(SerializedTextNode.type), "version": .number(Double(SerializedTextNode.version)), "text": .string(part), "format": 0, "detail": 0, "mode": "normal", "style": ""]) }
          }
          return nodes
        })
      default: throw EditorError.unsupported("Unknown rendered node")
      }
      if .object(fields) != node { try save(.object(fields)) }
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}

@MainActor func renderedInsertionActions(for view: EditorView) -> [UIAction] {
  [("mermaid", "Mermaid"), ("chart", "Chart"), ("equation", "Equation")].map { type, title in
    UIAction(title: title) { [weak view] _ in
      guard let json = RenderedEmbedStyle.insertionNodeJSON[type], let node = try? JSONValue(parsing: json) else { return }
      view?.insertEmbeddedNode(node, namespace: editorNamespace)
    }
  }
}
