import LexicalSwift
import EditorModelInterface
import LexidrawKit
import SwiftUI
import TextKitEditor
import UIKit
import Synchronization

@MainActor func configureRenderedEmbeds(_ view: EditorView, session: Session, fontFamily: String = RenderedEmbedStyle.defaultFontFamily) {
  let previousContent = view.embeddedContent
  let previousInline = view.inlineEmbeddedContent
  let previousTap = view.onEmbeddedTap
  let images = NSCache<NSString, RenderedEmbedView>()
  images.countLimit = 100
  let supported: Set<String> = ["mermaid", "equation", "chart", "code"]
  let open: (String, JSONValue) -> Bool = { [weak view] key, node in
    guard let view, let type = node["type"]?.stringValue, supported.contains(type) else { return false }
    images.object(forKey: key as NSString)?.retryIfFailed()
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
  view.embeddedContent = { key, node in
    guard let rendered = image(key, node) else { return previousContent?(key, node) }
    rendered.fontSizeOverride = nil
    return rendered
  }
  view.inlineEmbeddedContent = { key, node, width in
    guard let type = node["type"]?.stringValue, supported.contains(type) else { return previousInline?(key, node, width) }
    let attachment = RenderedAttachment(cached: images.object(forKey: key as NSString), width: width) { image(key, node) }
    return attachment
  }
  view.onEmbeddedTap = { key, node in open(key, node) || previousTap?(key, node) == true }
}

@MainActor final class RenderedEmbedView: EmbeddedContentView, UIContextMenuInteractionDelegate {
  let session: Session
  let fontFamily: String
  var node: JSONValue = .null
  var fontSizeOverride: CGFloat?
  var image: UIImage?
  private(set) var failed = false
  var open: (() -> Void)?
  var onRendered: (() -> Void)?
  var failureDescription = "Couldn’t render. Tap to edit the source."
  private var links: [RenderedEmbed.Link] = []
  var articleImageLoader: MediaImageLoader?
  private var articleImageTask: Task<Void, Never>?
  private var articleImageViews: [(UIImageView, [Double], UIImage)] = []
  private var articleText: String?
  private var articleElements: [(ArticleAccessibilityElement, [Double])] = []
  private let picture = UIImageView()
  private let status = UILabel()
  private var task: Task<Void, Never>?
  private var signature: String?
  private var natural = CGSize(width: 320, height: 180)
  private var availableWidth: CGFloat?
  private let statusInset: CGFloat = 8

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
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tap(_:))))
    addInteraction(UIContextMenuInteraction(delegate: self))
    accessibilityTraits = .button
    registerForTraitChanges([UITraitUserInterfaceStyle.self, UITraitPreferredContentSizeCategory.self]) { (view: RenderedEmbedView, _: UITraitCollection) in
      view.signature = nil
      view.setNeedsLayout()
      view.onRendered?()
    }
  }
  required init?(coder: NSCoder) { fatalError("RenderedEmbedView is made in code") }
  override func show(_ node: JSONValue) {
    if self.node != node {
      signature = nil; self.node = node
      clearArticleImages()
      if node["type"] == "article" { links = []; articleText = nil; articleElements = []; accessibilityElements = nil; isAccessibilityElement = true; image = nil; picture.image = nil }
    }
    accessibilityLabel = "\(node["type"]?.stringValue ?? "Rendered node"). Edit source"
    setNeedsLayout()
  }
  func cachedSize(fitting width: CGFloat) -> CGSize {
    CGSize(width: min(width, natural.width), height: max(min(width, natural.width) * natural.height / max(natural.width, 1), 20))
  }
  override func contentSize(fitting width: CGFloat) -> CGSize {
    availableWidth = width
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
    let target = node["type"] == "article" ? width : (inline ? min(width, natural.width) : column)
    // Intrinsic inline measurement needs the full container, even when its last image was narrow.
    render(width: max(inline ? width : target, 1))
    // A failure has no image, so its height is the message, not the placeholder's aspect ratio.
    if failed, !inline {
      let message = status.sizeThatFits(CGSize(width: max(target - 2 * statusInset, 1), height: .greatestFiniteMagnitude))
      return CGSize(width: target, height: ceil(message.height) + 2 * statusInset)
    }
    let height = target * natural.height / max(natural.width, 1)
    return CGSize(width: target, height: max(height, 20))
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    picture.frame = bounds
    updateArticleAccessibilityFrames()
    updateArticleImageFrames()
    status.frame = bounds.insetBy(dx: statusInset, dy: statusInset)
    _ = contentSize(fitting: availableWidth ?? max(bounds.width, 1))
  }
  private func render(width: CGFloat) {
    let dark = traitCollection.userInterfaceStyle == .dark
    let size = fontSizeOverride ?? UIFont.preferredFont(forTextStyle: .body).pointSize
    let next = "\(node.stringified)|\(dark)|\(Int(width))|\(size)"
    guard signature != next else { return }
    signature = next
    task?.cancel()
    clearArticleImages()
    failed = false
    status.text = "Rendering…"
    task = Task { [weak self, session, fontFamily, node] in
      do {
        let result = try await session.renderEmbed(node: node, dark: dark, width: min(max(Int(width), 1), 2048), fontFamily: fontFamily, fontSize: Double(size))
        guard !Task.isCancelled, let self, self.signature == next else { return }
        guard let image = UIImage(data: result.png) else { throw EditorError.invalidState("The renderer returned an unreadable image") }
        self.image = image
        links = result.links
        if node["type"] == "article" {
          articleText = result.accessibleText
          accessibilityLabel = result.accessibleText
          accessibilityTraits = .staticText
          articleElements = result.accessibility.map { item in
            let element = ArticleAccessibilityElement(accessibilityContainer: self)
            element.accessibilityLabel = item.text
            element.accessibilityTraits = item.role == "link" && item.url != nil ? .link : .staticText
            if item.heading { element.accessibilityTraits.insert(.header) }
            element.activate = item.url.map { url in { UIApplication.shared.open(url); return true } }
            return (element, item.rect)
          }
          for item in result.articleImages.reversed() where !item.alt.isEmpty {
            let element = ArticleAccessibilityElement(accessibilityContainer:self)
            element.accessibilityLabel = item.alt
            element.accessibilityTraits = .image
            if item.url != nil { element.accessibilityTraits.insert(.link) }
            if item.heading { element.accessibilityTraits.insert(.header) }
            element.accessibilityHint = item.refusal
            element.activate = item.url.map { url in { UIApplication.shared.open(url); return true } }
            articleElements.insert((element,item.rect),at:min(max(item.textIndex,0),articleElements.count))
          }
          isAccessibilityElement = articleElements.isEmpty
          accessibilityElements = articleElements.isEmpty ? nil : articleElements.map { $0.0 }
          updateArticleAccessibilityFrames()
        }
        picture.image = image
        natural = CGSize(width: result.width, height: result.height)
        status.text = nil
        updateArticleAccessibilityFrames()
        loadArticleImages(result, signature:next)
        onRendered?()
      } catch {
        guard !Task.isCancelled, let self, self.signature == next else { return }
        status.text = "\(failureDescription)\n\(error.localizedDescription)"
        links = []
        articleElements = []
        accessibilityElements = nil
        isAccessibilityElement = true
        accessibilityLabel = status.text
        image = nil
        picture.image = nil
        failed = true
        onRendered?()
      }
    }
  }
  func contextMenuInteraction(_ interaction: UIContextMenuInteraction, configurationForMenuAtLocation location: CGPoint) -> UIContextMenuConfiguration? {
    guard node["type"] == "article", let text = articleText, !text.isEmpty else { return nil }
    return UIContextMenuConfiguration(actionProvider: { [weak self] _ in
      UIMenu(children: [
        UIAction(title: "Copy article text", image: UIImage(systemName: "doc.on.doc")) { _ in UIPasteboard.general.string = text },
        UIAction(title: "Select article text", image: UIImage(systemName: "text.cursor")) { _ in self?.selectArticleText(text) }
      ])
    })
  }
  func selectArticleText(_ text: String) {
    var responder: UIResponder? = self
    while responder != nil, !(responder is UIViewController) { responder = responder?.next }
    guard let parent = responder as? UIViewController else { return }
    let controller = UIViewController()
    let data = node["data"]
    if let html = data?[data?["mode"] == "url" ? "distilled" : "snapshot"]?["contentHtml"]?.stringValue,
      let body = nativeArticleText(html: html, plainText: text) {
      controller.view = NativeEditorHost(editor: body)
      controller.title = "Article text"
    } else {
      let body = UITextView()
      body.text = text
      body.isEditable = false
      body.isSelectable = true
      body.font = .preferredFont(forTextStyle: .body)
      body.adjustsFontForContentSizeCategory = true
      controller.view = body
      controller.title = "Article text (plain preview)"
      body.accessibilityHint = "Rich selection is unavailable for this article. Plain text remains selectable."
    }
    controller.navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { [weak controller] _ in controller?.dismiss(animated: true) })
    parent.present(UINavigationController(rootViewController: controller), animated: true)
  }
  private func updateArticleAccessibilityFrames() {
    let scale = min(bounds.width / max(natural.width, 1), bounds.height / max(natural.height, 1))
    let offset = CGPoint(x: (bounds.width - natural.width * scale) / 2, y: (bounds.height - natural.height * scale) / 2)
    for (element, rect) in articleElements {
      element.accessibilityFrameInContainerSpace = CGRect(x: offset.x + rect[0] * scale, y: offset.y + rect[1] * scale, width: rect[2] * scale, height: rect[3] * scale)
    }
  }
  private func clearArticleImages() {
    articleImageTask?.cancel(); articleImageTask=nil
    articleImageViews.forEach { $0.0.stopAnimating(); $0.0.removeFromSuperview() }
    articleImageViews=[]
    ArticleImageBudget.release(self)
  }
  private func loadArticleImages(_ result: RenderedEmbed, signature expected: String) {
    guard node["type"] == "article", let data = result.articleImageBasePNG, let background=UIImage(data:data) else { return }
    let metadata=result.articleImages.filter(\.overlay)
    guard !metadata.isEmpty else { return }
    articleImageTask=Task { [weak self] in
      guard let self else { return }
      do {
        try await ArticleImageRequests.shared.perform { @MainActor [weak self] in
          guard let self, signature == expected else { return }
          try Task.checkCancellation()
          var loaded: [(RenderedEmbed.ArticleImage,UIImage)] = []
          var retained = [background] + (self.image.map { [$0] } ?? [])
          var bytes=ArticleImageBudget.decodedCost(retained)
          guard ArticleImageBudget.reserve(self,bytes:bytes) else { throw EditorError.unsupported("Article image memory budget exceeded (#134)") }
          for item in metadata {
            let image=try await (articleImageLoader ?? NativeMediaImages.load)(item.source)
            try Task.checkCancellation()
            guard signature == expected else { return }
            retained.append(image)
            bytes = ArticleImageBudget.decodedCost(retained)
            guard ArticleImageBudget.reserve(self,bytes:bytes) else { throw EditorError.unsupported("Article image memory budget exceeded (#134)") }
            loaded.append((item,image))
          }
          guard signature == expected else { return }
          picture.image=background
          for (item,image) in loaded {
            let view=UIImageView()
            view.contentMode=item.objectFit == "contain" ? .scaleAspectFit : item.objectFit == "cover" ? .scaleAspectFill : .scaleToFill
            view.clipsToBounds=true
            addSubview(view)
            articleImageViews.append((view,item.rect,image))
            NativeMediaImages.configureAnimation(on:view,image:image)
          }
          bringSubviewToFront(status)
          updateArticleImageFrames()
          onRendered?()
        }
      } catch {
        guard signature == expected else { return }
        ArticleImageBudget.release(self)
        status.text="Article images use a static preview (#134). \(error.localizedDescription)"
      }
    }
  }
  private func updateArticleImageFrames() {
    let scale=min(bounds.width/max(natural.width,1),bounds.height/max(natural.height,1))
    let offset=CGPoint(x:(bounds.width-natural.width*scale)/2,y:(bounds.height-natural.height*scale)/2)
    for (view,rect,_) in articleImageViews { view.frame=CGRect(x:offset.x+rect[0]*scale,y:offset.y+rect[1]*scale,width:rect[2]*scale,height:rect[3]*scale) }
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    for (view,_,image) in articleImageViews {
      if window == nil { view.stopAnimating() } else { NativeMediaImages.configureAnimation(on:view,image:image) }
    }
  }
  func retryIfFailed() {
    guard failed else { return }
    signature = nil
    setNeedsLayout()
    onRendered?()
  }
  deinit { task?.cancel(); articleImageTask?.cancel() }
  @objc private func tap(_ tap: UITapGestureRecognizer) {
    let scale = min(bounds.width / max(natural.width, 1), bounds.height / max(natural.height, 1))
    let point = tap.location(in: self)
    let local = CGPoint(x: (point.x - (bounds.width - natural.width * scale) / 2) / scale, y: (point.y - (bounds.height - natural.height * scale) / 2) / scale)
    if let link = links.first(where: { CGRect(x: $0.x, y: $0.y, width: $0.width, height: $0.height).contains(local) }) {
      UIApplication.shared.open(link.url)
    } else { open?() }
  }
}

@MainActor private enum ArticleImageBudget {
  private static let costs=NSMapTable<UIView,NSNumber>(keyOptions:.weakMemory,valueOptions:.strongMemory)
  static func decodedCost(_ images:[UIImage])->Int {
    var counted:Set<ObjectIdentifier>=[]
    return images.flatMap { $0.images ?? [$0] }.reduce(0) { bytes,frame in
      guard let bitmap=frame.cgImage, counted.insert(ObjectIdentifier(bitmap)).inserted else { return bytes }
      return bytes + bitmap.bytesPerRow * bitmap.height
    }
  }
  static func reserve(_ owner:UIView,bytes:Int)->Bool {
    let previous=costs.object(forKey:owner)?.intValue ?? 0
    let total=costs.objectEnumerator()?.allObjects.compactMap { ($0 as? NSNumber)?.intValue }.reduce(0,+) ?? 0
    guard bytes <= 16*1024*1024, total-previous+bytes <= 32*1024*1024 else { return false }
    costs.setObject(NSNumber(value:bytes),forKey:owner);return true
  }
  static func release(_ owner:UIView) { costs.removeObject(forKey:owner) }
}
private actor ArticleImageRequests {
  static let shared=ArticleImageRequests()
  private var active=0
  private var waiting:[CheckedContinuation<Void,Never>]=[]
  func perform(_ operation:@Sendable () async throws -> Void) async throws {
    if active>=2 { guard waiting.count<12 else { throw EditorError.unsupported("Article image queue is full (#134)") };await withCheckedContinuation {waiting.append($0)} } else {active += 1}
    defer {if waiting.isEmpty {active -= 1} else {waiting.removeFirst().resume()}}
    try Task.checkCancellation();try await operation()
  }
}

@MainActor private final class ArticleAccessibilityElement: UIAccessibilityElement {
  var activate: (() -> Bool)?
  override func accessibilityActivate() -> Bool { activate?() ?? false }
}

@MainActor private final class RenderedAttachment: NSTextAttachment, LazyTextAttachment {
  private let makeRendered: () -> RenderedEmbedView?
  private let cached: RenderedEmbedView?
  private var width: CGFloat
  nonisolated private let fontSize = Mutex<Double?>(nil)
  private var started = false
  init(cached: RenderedEmbedView?, width: CGFloat, makeRendered: @escaping () -> RenderedEmbedView?) {
    self.makeRendered = makeRendered
    self.cached = cached
    self.width = width
    super.init(data: nil, ofType: nil)
    image = cached?.image ?? UIImage(systemName: cached?.failed == true ? "exclamationmark.triangle" : "function")
    let size = cached?.cachedSize(fitting: width) ?? CGSize(width: 20, height: 20)
    bounds = CGRect(x: 0, y: -3, width: size.width, height: size.height)
  }
  required init?(coder: NSCoder) { fatalError("Equation attachment is made in code") }
  override func attachmentBounds(for textContainer: NSTextContainer?, proposedLineFragment lineFrag: CGRect, glyphPosition position: CGPoint, characterIndex charIndex: Int) -> CGRect {
    if let available = textContainer?.size.width, available.isFinite, available > 0 { width = min(width, available) }
    let size = cached?.cachedSize(fitting: width) ?? CGSize(width: 20, height: 20)
    return CGRect(x: 0, y: -3, width: size.width, height: size.height)
  }
  nonisolated func use(fontSize: Double) { self.fontSize.withLock { $0 = fontSize } }
  func load(onChange: @escaping @MainActor () -> Void) {
    guard !started else { return }
    started = true
    let rendered = makeRendered()
    rendered?.fontSizeOverride = fontSize.withLock { $0.map { CGFloat($0) } }
    _ = rendered?.contentSize(fitting: width)
    // Provider completion refreshes EditorView and the measured attachment.
  }
}

private struct RenderedSourceEditor: View {
  let node: JSONValue
  let editable: Bool
  let isInsertion: Bool
  let save: (JSONValue) throws -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var source: String
  @State private var secondary: String
  @State private var language: String
  @State private var inline: Bool
  @State private var error: String?
  init(node: JSONValue, editable: Bool, isInsertion: Bool = false, save: @escaping (JSONValue) throws -> Void) {
    self.node = node
    self.editable = editable
    self.isInsertion = isInsertion
    self.save = save
    let type = node["type"]?.stringValue
    _source = State(initialValue: type == "mermaid" ? node["schema"]?.stringValue ?? "" : type == "equation" ? node["equation"]?.stringValue ?? "" : type == "chart" ? node["chartData"]?.stringValue ?? "[]" : (node["children"]?.arrayValue ?? []).map { $0["type"] == "linebreak" ? "\n" : $0["type"] == "tab" ? "\t" : $0["text"]?.stringValue ?? "" }.joined())
    _inline = State(initialValue: node["inline"]?.boolValue ?? false)
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
        if node["type"] == "equation" { Toggle("Inline", isOn: $inline).disabled(!editable) }
        Section(node["type"] == "chart" ? "Data (JSON)" : "Source") {
          if editable { TextEditor(text: $source).font(.system(.body, design: .monospaced)).frame(minHeight: 240) }
          else { Text(source).font(.system(.body, design: .monospaced)).textSelection(.enabled) }
        }
        if node["type"] == "chart" {
          Section("Configuration (JSON)") {
            if editable { TextEditor(text: $secondary).font(.system(.body, design: .monospaced)).frame(minHeight: 160) }
            else { Text(secondary).font(.system(.body, design: .monospaced)).textSelection(.enabled) }
          }
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
      if !isInsertion, node["type"] == "code", source == originalSource, language == (node["language"]?.stringValue ?? "") { dismiss(); return }
      guard var fields = node.objectValue else { throw EditorError.invalidState("Invalid node") }
      switch node["type"]?.stringValue {
      case "mermaid":
        fields["schema"] = .string(source)
        if source != node["schema"]?.stringValue, var state = fields["$"]?.objectValue {
          state["natural"] = nil
          fields["$"] = state.isEmpty ? nil : .object(state)
        }
      case "equation": fields["equation"] = .string(source); fields["inline"] = .bool(inline)
      case "chart":
        guard try JSONValue(parsing: source).arrayValue != nil, try JSONValue(parsing: secondary).objectValue != nil else { throw EditorError.invalidState("Chart data must be an array and configuration an object") }
        fields["chartData"] = .string(source)
        fields["chartConfig"] = .string(secondary)
        fields["chartType"] = .string(language)
      case "code":
        fields["language"] = language.isEmpty ? nil : .string(language)
        if source != originalSource { fields["children"] = .array(source.components(separatedBy: "\n").enumerated().flatMap { index, line -> [JSONValue] in
          var nodes: [JSONValue] = index > 0 ? [["type": "linebreak", "version": 1]] : []
          for (tabIndex, part) in line.components(separatedBy: "\t").enumerated() {
            if tabIndex > 0 { nodes.append(["type": .string(SerializedTabNode.type), "version": .number(Double(SerializedTabNode.version)), "text": "\t", "format": 0, "detail": 0, "mode": "normal", "style": ""]) }
            if !part.isEmpty { nodes.append(["type": .string(SerializedTextNode.type), "version": .number(Double(SerializedTextNode.version)), "text": .string(part), "format": 0, "detail": 0, "mode": "normal", "style": ""]) }
          }
          return nodes
        }) }
      default: throw EditorError.unsupported("Unknown rendered node")
      }
      if isInsertion || .object(fields) != node { try save(.object(fields)) }
      dismiss()
    } catch { self.error = error.localizedDescription }
  }
}

@MainActor func renderedInsertionActions(for view: EditorView) -> [UIAction] {
  [("mermaid", "Mermaid"), ("chart", "Chart"), ("equation", "Equation")].map { type, title in
    UIAction(title: title) { [weak view] _ in
      guard let view, view.isEditable, let json = RenderedEmbedStyle.insertionNodeJSON[type], let node = try? JSONValue(parsing: json) else { return }
      if type == "mermaid" {
        view.insertEmbeddedNode(node, namespace: editorNamespace)
        return
      }
      var responder: UIResponder? = view
      while responder != nil, !(responder is UIViewController) { responder = responder?.next }
      guard let parent = responder as? UIViewController else { return }
      view.resignFirstResponder()
      let host = UIHostingController(rootView: RenderedSourceEditor(node: node, editable: true, isInsertion: true) { [weak view] replacement in
        guard let view, view.isEditable else { throw EditorError.invalidState("The document closed") }
        view.insertEmbeddedNode(replacement, namespace: editorNamespace, openAfterInsertion: false)
      })
      host.modalPresentationStyle = .pageSheet
      parent.present(host, animated: true)
    }
  }
}

/// An article's sanitized HTML as read-only native text, imported as a paste
/// of it would be; nil when it is too large or holds what the importer can't
/// edit (#134).
@MainActor func nativeArticleText(html: String, plainText: String) -> EditorView? {
  guard !html.isEmpty, html.utf8.count <= 300_000 else { return nil }
  let model = Editor()
  do {
    try model.load(["root": ["type": "root", "version": 1, "children": [["type": "paragraph", "version": 1, "children": []]]]])
    try model.apply(.caret(Point(path: [0], offset: 0, type: .element)))
    try model.apply(.paste(Clipboard(plainText: plainText, html: html)))
  } catch { return nil }
  return model.isEditable ? EditorView(model: model, isEditable: false) : nil
}
