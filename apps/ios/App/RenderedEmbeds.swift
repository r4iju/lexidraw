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
  func image(_ key: String, _ node: JSONValue) -> RenderedEmbedView? {
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
    guard let rendered = image(key, node) else { return previousInline?(key, node, width) }
    let size = rendered.contentSize(fitting: width)
    let attachment = NSTextAttachment()
    attachment.image = rendered.image
    attachment.bounds = CGRect(x: 0, y: -3, width: size.width, height: size.height)
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
  override func contentSize(fitting width: CGFloat) -> CGSize {
    let inline = node["type"] == "equation" && node["inline"] == true
    let target = inline ? min(width, natural.width) : min(width, CGFloat(node["width"]?.numberValue ?? Double(width)))
    render(width: max(target, 100))
    let height = min(target * natural.height / max(natural.width, 1), CGFloat(node["height"]?.numberValue ?? .greatestFiniteMagnitude))
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
  @objc private func tap() { open?() }
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
          if !line.isEmpty { nodes.append(["type": "text", "version": 1, "text": .string(line), "format": 0, "detail": 0, "mode": "normal", "style": ""]) }
          return nodes
        })
      default: throw EditorError.unsupported("Unknown rendered node")
      }
      if .object(fields) != node { try save(.object(fields)) }
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}
