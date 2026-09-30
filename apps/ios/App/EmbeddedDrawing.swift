import DrawingKit
import EditorModelInterface
import LexicalSwift
import PhotosUI
import SwiftUI
import TextKitEditor
import UIKit

/// Embedded scenes carry their own files and app state, rather than a
/// server drawing id. Keep those values when the native editor changes elements.
private struct EmbeddedScene {
  var value: JSONValue
  var elements: [JSONValue] {
    if let array = value.arrayValue { return array }
    return value["elements"]?.arrayValue ?? []
  }
  var files: JSONObject { value["files"]?.objectValue ?? [:] }
  var background: String { value["appState"]?["viewBackgroundColor"]?.stringValue ?? "#ffffff" }

  init(_ data: String) throws {
    value = try JSONValue(parsing: data)
    guard value.arrayValue != nil || value["elements"]?.arrayValue != nil else {
      throw EditorError.invalidState("The embedded drawing has no elements")
    }
  }

  mutating func replace(elements: [JSONValue], files: JSONObject, theme: DrawingTheme, zoom: Double) {
    var fields = value.objectValue ?? [:]
    fields["elements"] = .array(elements)
    fields["files"] = .object(files)
    var appState = fields["appState"]?.objectValue ?? [:]
    appState["theme"] = .string(theme == .dark ? "dark" : "light")
    appState["exportWithDarkMode"] = .bool(theme == .dark)
    var storedZoom = appState["zoom"]?.objectValue ?? [:]
    storedZoom["value"] = .number(zoom)
    appState["zoom"] = .object(storedZoom)
    fields["appState"] = .object(appState)
    value = .object(fields)
  }

  func images(_ receive: @MainActor (String, DrawingImage) -> Void) async {
    for (id, file) in files {
      guard let source = file["dataURL"]?.stringValue,
        let mime = file["mimeType"]?.stringValue.flatMap(DrawingFileType.init(rawValue:)),
        let comma = source.firstIndex(of: ","), source[..<comma].hasSuffix(";base64"),
        let data = Data(base64Encoded: String(source[source.index(after: comma)...])), data.count <= maxDrawingFileBytes
      else { continue }
      await receive(id, await DrawingImages.decode(data, mimeType: mime))
    }
  }
}

@MainActor func drawingInsertionAction(for view: EditorView) -> UIAction {
  UIAction(title: "Drawing", image: UIImage(systemName: "scribble.variable")) { [weak view] _ in
    guard let node = try? JSONValue(parsing: EmbeddedDrawingStyle.insertionNodeJSON) else { return }
    view?.insertEmbeddedNode(node, namespace: editorNamespace)
  }
}

@MainActor func configureEmbeddedDrawings(_ view: EditorView) {
  weak let editor = view
  let thumbnails = NSCache<NSString, EmbeddedDrawingImage>()
  thumbnails.countLimit = 120
  let open: (String, JSONValue) -> Bool = { [weak view] key, node in
    guard let view, node["type"] == "excalidraw", let data = node["data"]?.stringValue else { return false }
    view.resignFirstResponder()
    var responder: UIResponder? = view
    while responder != nil, !(responder is UIViewController) { responder = responder?.next }
    guard let parent = responder as? UIViewController else { return false }
    let host: UIViewController
    if view.isEditable {
      host = UIHostingController(rootView: EmbeddedDrawingScreen(data: data) { [weak view] replacement in
        guard let view else { throw EditorError.invalidState("The document closed") }
        try view.replaceDrawing(key: key, expectedData: data, data: replacement)
      })
    } else {
      host = UIHostingController(rootView: EmbeddedDrawingPreview(data: data))
    }
    host.modalPresentationStyle = .fullScreen
    parent.present(host, animated: true)
    return true
  }
  func thumbnail(_ key: String, _ node: JSONValue) -> EmbeddedDrawingImage? {
    guard node["type"] == "excalidraw" else { return nil }
    let content: EmbeddedDrawingImage
    if let existing = thumbnails.object(forKey: key as NSString) { content = existing }
    else {
      content = EmbeddedDrawingImage(node: node) { _ = open(key, node) }
      content.onImagesLoaded = { [weak view] in view?.refreshEmbeddedContent() }
      thumbnails.setObject(content, forKey: key as NSString)
    }
    content.open = { _ = open(key, node) }
    content.overrideUserInterfaceStyle = editor?.traitCollection.userInterfaceStyle ?? .light
    content.show(node)
    return content
  }
  view.embeddedContent = { key, node in thumbnail(key, node) }
  view.inlineEmbeddedContent = { key, node, width in
    guard let content = thumbnail(key, node) else { return nil }
    let size = content.contentSize(fitting: width)
    content.frame = CGRect(origin: .zero, size: size)
    content.layer.displayIfNeeded()
    let image = UIGraphicsImageRenderer(size: size).image { context in content.layer.render(in: context.cgContext) }
    let attachment = NSTextAttachment(image: image)
    attachment.bounds = CGRect(origin: .zero, size: size)
    return attachment
  }
  view.onEmbeddedTap = { key, node in open(key, node) }
}

@MainActor private final class EmbeddedDrawingImage: EmbeddedContentView {
  private var node: JSONValue
  private var scene: PreparedScene?
  private var images: [String: DrawingImage] = [:]
  private var loading: Task<Void, Never>?
  fileprivate var open: () -> Void
  var onImagesLoaded: (() -> Void)?
  private let caption = UILabel()
  private var imageFrame: CGRect = .zero
  private var loadedNode: JSONValue?
  init(node: JSONValue, open: @escaping () -> Void) {
    self.node = node
    self.open = open
    super.init(frame: .zero)
    isOpaque = false
    caption.numberOfLines = 0
    caption.textAlignment = .center
    caption.textColor = .secondaryLabel
    addSubview(caption)
    accessibilityLabel = "Drawing"
    accessibilityTraits = .button
    isAccessibilityElement = true
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: EmbeddedDrawingImage, _) in view.prepare() }
  }
  required init?(coder: NSCoder) { fatalError("Made in code") }
  @objc private func tapped() { open() }
  override func accessibilityActivate() -> Bool { open(); return true }
  override func show(_ node: JSONValue) {
    self.node = node
    caption.text = node["$"]?["figure"]?["caption"]?.stringValue
    caption.font = UIFont.systemFont(ofSize: UIFont.preferredFont(forTextStyle: .body).pointSize * EmbeddedDrawingStyle.captionFontScale)
    prepare()
    guard loadedNode != node else { return }
    loadedNode = node
    loading?.cancel()
    guard let data = node["data"]?.stringValue, let embedded = try? EmbeddedScene(data) else { return }
    loading = Task { [weak self] in
      await embedded.images { id, image in
        guard !Task.isCancelled, let self else { return }
        self.images[id] = image
        self.prepare()
        self.onImagesLoaded?()
      }
    }
  }
  private func prepare() {
    guard let data = node["data"]?.stringValue, let embedded = try? EmbeddedScene(data) else { return }
    scene = PreparedScene(restoreElements(embedded.elements), theme: traitCollection.userInterfaceStyle == .dark ? .dark : .light,
      canvasBackgroundColor: embedded.background, images: images, measurer: FontLibrary.shared)
    setNeedsDisplay()
  }
  override func contentSize(fitting width: CGFloat) -> CGSize {
    let padding = EmbeddedDrawingStyle.exportPadding
    let natural = scene?.exportPixelSize(padding: padding, scale: 1) ?? (width: 20, height: 20)
    let em = UIFont.preferredFont(forTextStyle: .body).pointSize
    var column = min(width, EmbeddedDrawingStyle.columnRem * em)
    if let figureWidth = node["$"]?["figure"]?["width"]?.stringValue {
      switch figureWidth {
      case "wide": column = min(width, EmbeddedDrawingStyle.wideRem * em)
      case "full": column = width
      default:
        if figureWidth.hasSuffix("%"), let share = Double(figureWidth.dropLast()) {
          let least = width <= EmbeddedDrawingStyle.phoneWidth ? width : min(width, EmbeddedDrawingStyle.minimumShareRem * em)
          column = max(column * share / 100, least)
        }
      }
    }
    let requestedWidth = CGFloat(node["width"]?.numberValue ?? Double(natural.width) * EmbeddedDrawingStyle.naturalScale)
    let fittedWidth = min(max(requestedWidth, 1), column)
    let intrinsicHeight = fittedWidth * CGFloat(natural.height) / CGFloat(max(natural.width, 1))
    let heightLimit = CGFloat(node["height"]?.numberValue ?? Double(intrinsicHeight))
    let imageHeight = max(min(intrinsicHeight, heightLimit), 1)
    imageFrame = CGRect(x: 0, y: 0, width: fittedWidth, height: imageHeight)
    var height = imageHeight
    if let text = caption.text, !text.isEmpty {
      let paragraph = NSMutableParagraphStyle()
      paragraph.alignment = .center
      paragraph.minimumLineHeight = caption.font.pointSize * EmbeddedDrawingStyle.captionLineHeight
      caption.attributedText = NSAttributedString(string: text, attributes: [.font: caption.font!, .foregroundColor: UIColor.secondaryLabel, .paragraphStyle: paragraph])
      let captionSize = caption.sizeThatFits(CGSize(width: fittedWidth, height: .greatestFiniteMagnitude))
      caption.frame = CGRect(x: 0, y: imageHeight + EmbeddedDrawingStyle.captionGap, width: fittedWidth, height: captionSize.height)
      height = caption.frame.maxY
    } else { caption.frame = .zero }
    return CGSize(width: fittedWidth, height: height)
  }

  override func draw(_ rect: CGRect) {
    guard let scene, let context = UIGraphicsGetCurrentContext() else { return }
    let size = scene.exportPixelSize(padding: EmbeddedDrawingStyle.exportPadding, scale: 1)
    context.saveGState()
    let scale = min(imageFrame.width / CGFloat(max(size.width, 1)), imageFrame.height / CGFloat(max(size.height, 1)))
    context.translateBy(x: (imageFrame.width - CGFloat(size.width) * scale) / 2, y: (imageFrame.height - CGFloat(size.height) * scale) / 2)
    context.scaleBy(x: scale, y: scale)
    scene.export(on: CGCanvas(context: context, fonts: FontLibrary.shared), padding: EmbeddedDrawingStyle.exportPadding, scale: 1, background: nil)
    context.restoreGState()
  }
}

@MainActor @Observable private final class EmbeddedDrawingEditing: DrawingCanvasEditing {
  let editor: DrawingEditor
  var images: [String: DrawingImage] = [:]
  var tool = DrawingTool.selection
  var historyButtons: [EditorButton] = []
  var selectionButtons: [EditorButton] = []
  var styles = StyleControls()
  var imageProblem: String?
  var files: JSONObject
  let initialElements: [JSONValue]
  @ObservationIgnored var redraw: () -> Void = {}
  @ObservationIgnored var viewport: () -> (center: Point2D, height: Double) = { (Point2D(0, 0), 800) }
  init(_ scene: EmbeddedScene) {
    editor = DrawingEditor(elements: scene.elements, measurer: FontLibrary.shared)
    files = scene.files
    initialElements = editor.elements
    changing()
  }
  func changing() {
    tool = editor.tool
    historyButtons = editor.historyButtons
    selectionButtons = editor.selectionButtons
    styles = editor.styleControls
    redraw()
  }
  func edited() { changing() }
  func perform(_ action: EditorAction) { editor.perform(action); edited() }
  func select(_ tool: DrawingTool) { editor.tool = tool; changing() }
  func place(_ data: Data) async {
    do {
      let file = try await Task.detached { try ImageFile(data: data) }.value
      images[file.id] = await DrawingImages.decode(file.data, mimeType: file.mimeType)
      files[file.id] = ["id": .string(file.id), "mimeType": .string(file.mimeType.rawValue),
        "dataURL": .string("data:\(file.mimeType.rawValue);base64,\(file.data.base64EncodedString())"),
        "created": .number(Date().timeIntervalSince1970 * 1000)]
      let viewport = viewport()
      editor.tool = .selection
      perform(.placeImage(file, at: viewport.center, viewportHeight: viewport.height))
      editor.setStatus("saved", ofImagesShowing: file.id)
      edited()
    } catch { imageProblem = "This image couldn’t be placed: \(error.localizedDescription)" }
  }
}

private struct EmbeddedDrawingPreview: View {
  let data: String
  @State private var images: [String: DrawingImage] = [:]
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      Group {
        if let scene = try? EmbeddedScene(data) {
          DrawingCanvas(elements: scene.elements, background: scene.background,
            theme: colorScheme == .dark ? .dark : .light, images: images)
            .ignoresSafeArea(edges: .bottom)
            .task { await scene.images { images[$0] = $1 } }
        } else {
          ContentUnavailableView("Drawing unavailable", systemImage: "exclamationmark.triangle")
        }
      }
      .navigationTitle("Drawing")
      .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
  }
}

private struct EmbeddedDrawingScreen: View {
  let commit: (String?) throws -> Void
  private let scene: EmbeddedScene?
  @State private var editing: EmbeddedDrawingEditing?
  @State private var stylesShown = false
  @State private var discardShown = false
  @State private var problem: String?
  @State private var photo: PhotosPickerItem?
  @State private var photosShown = false
  @State private var filesShown = false
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.dismiss) private var dismiss
  init(data: String, commit: @escaping (String?) throws -> Void) {
    self.commit = commit
    scene = try? EmbeddedScene(data)
    _editing = State(initialValue: scene.map(EmbeddedDrawingEditing.init))
  }
  private var theme: DrawingTheme { colorScheme == .dark ? .dark : .light }
  var body: some View {
    NavigationStack {
      Group {
        if let editing, let scene {
          EditorCanvas(editing: editing, background: scene.background, theme: theme)
            .ignoresSafeArea(edges: .bottom)
            .toolbar {
              ToolbarItem(placement: .cancellationAction) { Button("Cancel") { cancel() } }
              ToolbarItem(placement: .confirmationAction) { Button("Save") { save() }.accessibilityIdentifier("save embedded drawing") }
              ToolbarItem(placement: .topBarTrailing) {
                Menu("Drawing Actions", systemImage: "ellipsis.circle") {
                  buttons(editing.historyButtons, editing)
                  buttons(editing.selectionButtons, editing)
                  Menu("Insert Image", systemImage: "photo.badge.plus") {
                    Button("Photo Library", systemImage: "photo.on.rectangle") { photosShown = true }
                    Button("Files", systemImage: "folder") { filesShown = true }
                  }
                  Button("Style", systemImage: "paintpalette") { stylesShown = true }
                }
                .popover(isPresented: $stylesShown) {
                  StyleInspector(controls: editing.styles, theme: theme) { editing.perform(.style($0)) }
                    .presentationCompactAdaptation(.popover)
                }
              }
              ToolbarItem(placement: .bottomBar) {
                Picker("Tool", selection: Binding(get: { editing.tool }, set: { editing.select($0) })) {
                  ForEach(DrawingTool.allCases, id: \.self) { tool in
                    Label(tool.name, systemImage: tool.systemImage).tag(tool)
                  }
                }.pickerStyle(.segmented).fixedSize()
              }
            }
            .task { await scene.images { editing.images[$0] = $1; editing.redraw() } }
            .photosPicker(isPresented: $photosShown, selection: $photo, matching: .images)
            .onChange(of: photo) {
              guard let photo else { return }; self.photo = nil
              Task { if let data = try? await photo.loadTransferable(type: Data.self) { await editing.place(data) } }
            }
            .fileImporter(isPresented: $filesShown, allowedContentTypes: [.image]) { result in
              guard case .success(let url) = result else { return }
              let access = url.startAccessingSecurityScopedResource()
              defer { if access { url.stopAccessingSecurityScopedResource() } }
              if let data = try? Data(contentsOf: url) { Task { await editing.place(data) } }
            }
            .alert("Image", isPresented: Binding(get: { editing.imageProblem != nil }, set: { if !$0 { editing.imageProblem = nil } })) {
              Button("OK") {}
            } message: { Text(editing.imageProblem ?? "") }
        } else {
          ContentUnavailableView("Drawing unavailable", systemImage: "exclamationmark.triangle",
            description: Text("The stored drawing data cannot be read."))
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
      }
      .navigationTitle("Drawing")
      .navigationBarTitleDisplayMode(.inline)
      .confirmationDialog("Discard drawing changes?", isPresented: $discardShown, titleVisibility: .visible) {
        Button("Discard Changes", role: .destructive) { dismiss() }
        Button("Keep Editing", role: .cancel) {}
      }
      .alert("Drawing couldn’t be saved", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
        Button("OK") {}
      } message: { Text(problem ?? "") }
    }
  }
  private func cancel() {
    guard let editing, let scene else { dismiss(); return }
    if editing.editor.elements.filter({ $0["isDeleted"]?.boolValue != true }).isEmpty && editing.files.isEmpty {
      do { try commit(nil); dismiss() } catch { problem = error.localizedDescription }
      return
    }
    if editing.editor.elements != editing.initialElements || editing.files != scene.files { discardShown = true }
    else { dismiss() }
  }
  private func save() {
    guard let editing, var scene else { return }
    do {
      let elements = editing.editor.elements.filter { $0["isDeleted"]?.boolValue != true }
      if elements.isEmpty && editing.files.isEmpty { try commit(nil) }
      else {
        scene.replace(elements: elements, files: editing.files, theme: theme, zoom: editing.editor.zoom)
        try commit(scene.value.stringified)
      }
      dismiss()
    } catch { problem = error.localizedDescription }
  }
  private func buttons(_ buttons: [EditorButton], _ editing: EmbeddedDrawingEditing) -> some View {
    ForEach(buttons) { button in
      Button(button.title, systemImage: button.systemImage, role: button.isDestructive ? .destructive : nil) {
        editing.perform(button.action)
      }.disabled(!button.isEnabled)
    }
  }
}
