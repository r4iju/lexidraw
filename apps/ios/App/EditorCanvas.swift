import DrawingKit
import SwiftUI
import UIKit

/// The drawing as the web editor shows it: drawn afresh for each change
/// and each step of a pan or pinch, over just what is on screen.
struct EditorCanvas: UIViewRepresentable {
  let editing: DrawingEditing
  let background: String
  let theme: DrawingTheme

  func makeUIView(context: Context) -> EditorCanvasView {
    EditorCanvasView(editing: editing, background: background)
  }

  func updateUIView(_ view: EditorCanvasView, context: Context) {
    view.theme = theme
  }
}

final class EditorCanvasView: UIView, UIGestureRecognizerDelegate, UITextViewDelegate {
  /// The web's zoom limits.
  private static let zoomRange = 0.1...30.0
  /// Room round the drawing when it is first fitted to the screen.
  private static let margin = 40.0

  private let editing: DrawingEditing
  private var editor: DrawingEditor { editing.editor }
  private let background: String
  var theme = DrawingTheme.light {
    didSet {
      guard theme != oldValue else { return }
      backgroundColor = UIColor(cgColor: theme.color(background))
      setNeedsDisplay()
      showTextBox()
    }
  }
  private let shapes = ShapeCache()
  /// The web's `scrollX` and `scrollY`: where the scene's origin is, in
  /// scene units from the view's corner.
  private var scroll = Point2D(0, 0)
  private var zoom = 1.0 {
    didSet { editor.zoom = zoom }
  }
  private var fitted = false
  /// The touch the editor is following.
  private var active: UITouch?
  /// A finger moving the drawing, when only the pencil draws.
  private var dragging: UITouch?
  private var predicted: [(Point2D, Double)] = []
  /// Handles are as large as the last pointer needs them.
  private var lastPointer = PointerKind.touch
  private var textView: TextBoxView?
  private lazy var undo = EditorUndoManager(editing: editing)

  init(editing: DrawingEditing, background: String) {
    self.editing = editing
    self.background = background
    super.init(frame: .zero)
    backgroundColor = UIColor(cgColor: theme.color(background))
    isMultipleTouchEnabled = true
    contentMode = .redraw
    editing.redraw = { [weak self] in
      self?.setNeedsDisplay()
      self?.showTextBox()
    }
    editing.viewport = { [weak self] in
      guard let self else { return (Point2D(0, 0), 800) }
      return (scenePoint(CGPoint(x: bounds.midX, y: bounds.midY)), bounds.height)
    }

    let pan = UIPanGestureRecognizer(target: self, action: #selector(pan(_:)))
    pan.minimumNumberOfTouches = 2
    pan.allowedScrollTypesMask = .all
    let pinch = UIPinchGestureRecognizer(target: self, action: #selector(pinch(_:)))
    let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTap(_:)))
    doubleTap.numberOfTapsRequired = 2
    doubleTap.cancelsTouchesInView = false
    doubleTap.delaysTouchesEnded = false
    for recognizer in [pan, pinch] as [UIGestureRecognizer] {
      recognizer.allowedTouchTypes = [UITouch.TouchType.direct, .indirectPointer].map {
        NSNumber(value: $0.rawValue)
      }
      recognizer.delegate = self
    }
    for recognizer in [pan, pinch, doubleTap] as [UIGestureRecognizer] { addGestureRecognizer(recognizer) }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  // MARK: Viewport

  private func scenePoint(_ p: CGPoint) -> Point2D { Point2D(p.x / zoom - scroll.x, p.y / zoom - scroll.y) }

  private func screenPoint(_ p: Point2D) -> CGPoint { CGPoint(x: (p.x + scroll.x) * zoom, y: (p.y + scroll.y) * zoom) }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard !fitted, bounds.width > 0, bounds.height > 0 else { return }
    fitted = true
    let content = PreparedScene(restoreElements(editor.elements), theme: theme, measurer: FontLibrary.shared)
      .contentBounds
    guard content.minX.isFinite, content.maxX.isFinite, content.minY.isFinite, content.maxY.isFinite else {
      return
    }
    let width = content.maxX - content.minX + Self.margin * 2
    let height = content.maxY - content.minY + Self.margin * 2
    zoom = min(max(min(bounds.width / width, bounds.height / height, 1), Self.zoomRange.lowerBound), 1)
    scroll = Point2D(
      bounds.width / zoom / 2 - (content.minX + content.maxX) / 2,
      bounds.height / zoom / 2 - (content.minY + content.maxY) / 2)
    setNeedsDisplay()
  }

  @objc private func pan(_ recognizer: UIPanGestureRecognizer) {
    let moved = recognizer.translation(in: self)
    recognizer.setTranslation(.zero, in: self)
    scroll.x += moved.x / zoom
    scroll.y += moved.y / zoom
    viewportChanged()
  }

  @objc private func pinch(_ recognizer: UIPinchGestureRecognizer) {
    let at = recognizer.location(in: self)
    let anchor = scenePoint(at)
    zoom = min(max(zoom * recognizer.scale, Self.zoomRange.lowerBound), Self.zoomRange.upperBound)
    recognizer.scale = 1
    scroll = Point2D(at.x / zoom - anchor.x, at.y / zoom - anchor.y)
    viewportChanged()
  }

  private func viewportChanged() {
    setNeedsDisplay()
    showTextBox()
  }

  func gestureRecognizer(
    _ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
  ) -> Bool {
    true
  }

  // MARK: Drawing

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    var shown = predicted.isEmpty ? editor.elements : editor.elements(predicting: predicted)
    // The text being written shows in its text box instead, as on the web.
    if let id = editor.textBox?.id { shown.removeAll { $0["id"]?.stringValue == id } }
    let scene = PreparedScene(
      restoreElements(shown), theme: theme, canvasBackgroundColor: background, images: editing.images,
      measurer: FontLibrary.shared, shapes: shapes)
    let width = bounds.width / zoom
    let height = bounds.height / zoom
    context.saveGState()
    scene.render(
      on: CGCanvas(context: context, fonts: FontLibrary.shared), scale: zoom, scrollX: scroll.x,
      scrollY: scroll.y, width: width, height: height, background: background,
      layerScale: zoom * contentScaleFactor,
      visible: Bounds(minX: -scroll.x, minY: -scroll.y, maxX: width - scroll.x, maxY: height - scroll.y))
    context.restoreGState()
    drawOverlay(editor.overlay(pointer: lastPointer), in: context)
  }

  private func drawOverlay(_ overlay: EditorOverlay, in context: CGContext) {
    let tint = tintColor.cgColor
    context.setLineWidth(1)
    context.setStrokeColor(tint)
    for outline in overlay.outlines {
      context.addLines(between: outline.map(screenPoint))
      context.closePath()
      context.strokePath()
    }
    if let box = overlay.commonBox {
      context.setLineDash(phase: 0, lengths: [4, 4])
      context.stroke(screenRect(box))
      context.setLineDash(phase: 0, lengths: [])
    }
    if let box = overlay.selecting {
      context.setFillColor(tint.copy(alpha: 0.08) ?? tint)
      context.fill(screenRect(box))
      context.stroke(screenRect(box))
    }
    context.setFillColor(UIColor.systemBackground.cgColor)
    for handle in overlay.handles {
      let rect = screenRect(handle.bounds)
      context.saveGState()
      context.translateBy(x: rect.midX, y: rect.midY)
      context.rotate(by: handle.angle)
      let local = CGRect(x: -rect.width / 2, y: -rect.height / 2, width: rect.width, height: rect.height)
      let path =
        handle.name == "rotation"
        ? CGPath(ellipseIn: local, transform: nil)
        : CGPath(roundedRect: local, cornerWidth: 2, cornerHeight: 2, transform: nil)
      context.addPath(path)
      context.drawPath(using: .fillStroke)
      context.restoreGState()
    }
  }

  private func screenRect(_ b: Bounds) -> CGRect {
    let origin = screenPoint(Point2D(b.minX, b.minY))
    return CGRect(x: origin.x, y: origin.y, width: (b.maxX - b.minX) * zoom, height: (b.maxY - b.minY) * zoom)
  }

  // MARK: Touches

  private func pointer(_ touch: UITouch) -> PointerKind {
    switch touch.type {
    case .pencil: .pen
    case .indirectPointer: .mouse
    default: .touch
    }
  }

  /// A pencil's force as a pointer event's pressure; a finger reports the
  /// 0.5 a browser gives for a pointer without pressure.
  private func pressure(_ touch: UITouch) -> Double {
    guard touch.type == .pencil, touch.maximumPossibleForce > 0 else { return 0.5 }
    return touch.force / touch.maximumPossibleForce
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    for touch in touches where active == nil && dragging == nil {
      if touch.type == .direct, UIPencilInteraction.prefersPencilOnlyDrawing,
        ![.selection, .text].contains(editor.tool)
      {
        dragging = touch
        continue
      }
      active = touch
      lastPointer = pointer(touch)
      editor.pointerDown(scenePoint(touch.location(in: self)), pointer: lastPointer, pressure: pressure(touch))
      editing.changing()
    }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    if let dragging, touches.contains(dragging) {
      let now = dragging.location(in: self)
      let before = dragging.previousLocation(in: self)
      scroll.x += (now.x - before.x) / zoom
      scroll.y += (now.y - before.y) / zoom
      viewportChanged()
    }
    guard let active, touches.contains(active) else { return }
    for touch in event?.coalescedTouches(for: active) ?? [active] {
      editor.pointerMove(scenePoint(touch.location(in: self)), pressure: pressure(touch))
    }
    predicted = (event?.predictedTouches(for: active) ?? []).map {
      (scenePoint($0.location(in: self)), pressure($0))
    }
    setNeedsDisplay()
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    if let dragging, touches.contains(dragging) { self.dragging = nil }
    guard let active, touches.contains(active) else { return }
    self.active = nil
    predicted = []
    // A browser's pointerup has no pressure.
    editor.pointerUp(scenePoint(active.location(in: self)), pressure: 0)
    editing.edited()
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    if let dragging, touches.contains(dragging) { self.dragging = nil }
    guard let active, touches.contains(active) else { return }
    self.active = nil
    predicted = []
    editor.cancelGesture()
    editing.edited()
  }

  @objc private func doubleTap(_ recognizer: UITapGestureRecognizer) {
    editor.doubleTap(scenePoint(recognizer.location(in: self)))
    editing.edited()
  }

  // MARK: Text

  /// Keeps a text box over the text being written, for as long as it is.
  private func showTextBox() {
    guard let box = editor.textBox else {
      if let textView {
        self.textView = nil
        textView.removeFromSuperview()
        becomeFirstResponder()
      }
      return
    }
    if textView?.id != box.id {
      textView?.removeFromSuperview()
      let view = TextBoxView(id: box.id)
      view.delegate = self
      view.submit = { [weak self] in
        self?.editor.escape()
        self?.editing.edited()
      }
      view.text = box.text
      addSubview(view)
      textView = view
      view.becomeFirstResponder()
    }
    textView?.lay(out: box, zoom: zoom, at: screenPoint(Point2D(box.x, box.y)), theme: theme)
  }

  func textViewDidChange(_ view: UITextView) {
    editor.editText(view.text)
    editing.edited()
  }

  func textViewDidEndEditing(_ view: UITextView) {
    guard view === textView, editor.textBox != nil else { return }
    editor.stopEditingText()
    editing.edited()
  }

  // MARK: Keys

  override var canBecomeFirstResponder: Bool { true }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { becomeFirstResponder() }
  }

  override var undoManager: UndoManager? { undo }

  override var keyCommands: [UIKeyCommand]? {
    // Keys go to the text being written, which is below the canvas in the
    // responder chain.
    guard editor.textBox == nil else { return [] }
    return DrawingTool.allCases.map { tool in
      UIKeyCommand(
        title: tool.name, action: #selector(chooseTool(_:)), input: tool.key, propertyList: tool.rawValue)
    } + [
      UIKeyCommand(title: "Delete", action: #selector(deleteSelection), input: "\u{8}"),
      UIKeyCommand(title: "Delete", action: #selector(deleteSelection), input: UIKeyCommand.inputDelete),
      UIKeyCommand(title: "Deselect", action: #selector(escape), input: UIKeyCommand.inputEscape),
      UIKeyCommand(title: "Group", action: #selector(group), input: "g", modifierFlags: .command),
      UIKeyCommand(title: "Ungroup", action: #selector(ungroup), input: "g", modifierFlags: [.command, .shift]),
    ]
  }

  @objc private func group() { editing.perform(.group) }

  @objc private func ungroup() { editing.perform(.ungroup) }

  @objc private func chooseTool(_ command: UIKeyCommand) {
    guard let name = command.propertyList as? String, let tool = DrawingTool(rawValue: name) else { return }
    editing.select(tool)
  }

  @objc private func deleteSelection() { editing.perform(.delete) }

  @objc private func escape() {
    editor.escape()
    editing.edited()
  }
}

/// The editor's history as the system's undo: three-finger swipes, the
/// keyboard's Command-Z and the Edit menu undo and redo drawing edits.
final class EditorUndoManager: UndoManager {
  private let editing: DrawingEditing

  init(editing: DrawingEditing) {
    self.editing = editing
    super.init()
  }

  override var canUndo: Bool { editing.editor.canUndo }
  override var canRedo: Bool { editing.editor.canRedo }
  override func undo() { editing.perform(.undo) }
  override func redo() { editing.perform(.redo) }
}

/// The web's text box over text being written: the text in its font, at
/// its place and turn, breaking lines where the text on the canvas will.
final class TextBoxView: UITextView {
  let id: String
  var submit: () -> Void = {}
  /// Typing is undone here, apart from the drawing's history.
  private let typing = UndoManager()
  private var style: [AnyHashable]?

  init(id: String) {
    self.id = id
    super.init(frame: .zero, textContainer: nil)
    backgroundColor = .clear
    isScrollEnabled = false
    textContainerInset = .zero
    textContainer.lineFragmentPadding = 0
    autocorrectionType = .no
    autocapitalizationType = .none
    smartQuotesType = .no
    smartDashesType = .no
    clipsToBounds = false
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

  func lay(out box: TextBox, zoom: Double, at origin: CGPoint, theme: DrawingTheme) {
    let size = box.fontSize * zoom
    let font = CTFontCreateCopyWithAttributes(FontLibrary.shared.font(box.font), size, nil, nil) as UIFont
    let paragraph = NSMutableParagraphStyle()
    paragraph.minimumLineHeight = size * box.lineHeight
    paragraph.maximumLineHeight = size * box.lineHeight
    paragraph.alignment =
      switch box.textAlign {
      case "center": .center
      case "right": .right
      default: .left
      }
    let color = UIColor(cgColor: theme.color(box.color)).withAlphaComponent(box.opacity / 100)
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font, .foregroundColor: color, .paragraphStyle: paragraph,
    ]
    // Restyled only when the style changes, so text being composed keeps
    // its marking.
    let style: [AnyHashable] = [size, box.lineHeight, box.textAlign, color, box.font]
    if style != self.style {
      self.style = style
      typingAttributes = attributes
      textStorage.setAttributes(attributes, range: NSRange(location: 0, length: textStorage.length))
    }
    // A glyph's width here may differ from the browser's by a hair, so
    // wrapped text gets a little room, and unwrapped text a line as long
    // as it needs, as the web's text box grows with what is typed.
    let width = box.width * zoom
    textContainer.size = CGSize(width: box.wraps ? width + 2 : .greatestFiniteMagnitude, height: .greatestFiniteMagnitude)
    transform = .identity
    frame = CGRect(x: origin.x, y: origin.y, width: box.wraps ? width + 2 : width + size, height: box.height * zoom)
    transform = CGAffineTransform(rotationAngle: box.angle)
  }

  override var keyCommands: [UIKeyCommand]? {
    [
      UIKeyCommand(title: "Done", action: #selector(done), input: UIKeyCommand.inputEscape),
      UIKeyCommand(title: "Done", action: #selector(done), input: "\r", modifierFlags: .command),
    ]
  }

  @objc private func done() { submit() }

  override var undoManager: UndoManager? { typing }
}
