import EditorModelInterface
import ImageIO
import LexidrawKit
import TextKitEditor
import UIKit

@MainActor func configureHTMLBlocks(_ view: EditorView, session: Session, documentID: String) {
  let previous = view.embeddedContent
  let previews = NSCache<NSString, HTMLBlockImage>()
  previews.countLimit = 100
  view.embeddedContent = { [weak view] key, node in
    guard node["type"] == "html-block" else { return previous?(key, node) }
    let preview: HTMLBlockImage
    if let cached = previews.object(forKey: key as NSString) {
      preview = cached
    } else {
      preview = HTMLBlockImage(session: session, documentID: documentID)
      preview.changed = { [weak view] in view?.refreshEmbeddedContent() }
      previews.setObject(preview, forKey: key as NSString)
    }
    preview.show(node)
    return preview
  }
}

@MainActor private final class HTMLBlockImage: EmbeddedContentView {
  private let session: Session
  private let documentID: String
  private let image = UIImageView()
  private let status = UILabel()
  private let open = UIButton(type: .system)
  private var request: Task<Void, Never>?
  private var block: (id: String, revision: String, description: String)?
  /// The block, width and appearance the shown or pending preview was asked for.
  private var signature = ""
  private var destination: URL?
  /// The block's saved height in points, which its preview and running frame both keep.
  private var blockHeight: CGFloat = 360
  private var availableWidth: CGFloat?
  var changed: (() -> Void)?

  init(session: Session, documentID: String) {
    self.session = session
    self.documentID = documentID
    super.init(frame: .zero)
    image.contentMode = .scaleAspectFit
    image.isAccessibilityElement = true
    status.numberOfLines = 0
    status.textAlignment = .center
    status.font = .preferredFont(forTextStyle: .body)
    status.adjustsFontForContentSizeCategory = true
    open.setTitle("Open interactive block in browser", for: .normal)
    open.titleLabel?.font = .preferredFont(forTextStyle: .body)
    open.titleLabel?.adjustsFontForContentSizeCategory = true
    open.titleLabel?.numberOfLines = 0
    open.addAction(
      UIAction { [weak self] _ in
        guard let url = self?.destination else { return }
        UIApplication.shared.open(url)
      }, for: .touchUpInside)
    addSubview(image)
    addSubview(status)
    addSubview(open)
    layer.borderColor = UIColor.separator.cgColor
    layer.borderWidth = 1
    layer.cornerRadius = 8
    clipsToBounds = true
    registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (view: HTMLBlockImage, _: UITraitCollection) in
      view.layer.borderColor = UIColor.separator.resolvedColor(with: view.traitCollection).cgColor
      view.setNeedsLayout()
    }
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  deinit { request?.cancel() }

  override func show(_ node: JSONValue) {
    guard let saved = node["block"], let blockID = saved["id"]?.stringValue,
      UUID(uuidString: blockID) != nil, let revision = saved["revision"]?.stringValue,
      !revision.isEmpty, revision.utf8.count <= 128
    else {
      request?.cancel()
      block = nil
      signature = ""
      destination = nil
      image.image = nil
      status.attributedText = nil
      status.text = "HTML block preview unavailable"
      open.isHidden = true
      return
    }
    destination = session.htmlBlockLink(documentID: documentID, blockID: blockID)
    open.isHidden = false
    if let height = saved["height"]?.numberValue, (180...900).contains(height) {
      blockHeight = CGFloat(height)
    }
    let description = saved["description"]?.stringValue ?? "HTML block"
    image.accessibilityLabel = "\(description), saved starting state"
    if block?.id != blockID || block?.revision != revision { image.image = nil }
    block = (blockID, revision, description)
    setNeedsLayout()
  }

  /// Asks for the preview at `width` in the current appearance, unless that is what is shown.
  private func load(width: CGFloat) {
    guard let block else { return }
    let points = Int(width.rounded())
    let dark = traitCollection.userInterfaceStyle == .dark
    let next = "\(block.id):\(block.revision):\(points):\(dark)"
    guard signature != next else { return }
    signature = next
    request?.cancel()
    if image.image == nil { showStatus("Loading saved-state preview…") }
    request = Task { [weak self, session, documentID] in
      do {
        let preview = try await session.htmlBlockPreview(
          documentID: documentID, blockID: block.id, revision: block.revision, width: points,
          dark: dark)
        try Task.checkCancellation()
        guard let self, self.signature == next else { return }
        guard
          let source = CGImageSourceCreateWithData(
            preview.png as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          properties[kCGImagePropertyPixelWidth] as? Int == preview.width * preview.scale,
          properties[kCGImagePropertyPixelHeight] as? Int == preview.height * preview.scale,
          let decoded = UIImage(data: preview.png, scale: CGFloat(preview.scale))
        else { throw URLError(.cannotDecodeContentData) }
        self.image.image = decoded
        self.status.attributedText = nil
        self.changed?()
      } catch let failure as HTMLBlockScriptError {
        guard !Task.isCancelled, let self, self.signature == next else { return }
        self.image.image = nil
        self.showScriptError(failure.message)
        self.changed?()
      } catch {
        guard !Task.isCancelled, let self, self.signature == next else { return }
        self.image.image = nil
        self.showStatus(
          "Saved-state preview unavailable. Open the block in your browser to run it.")
        self.changed?()
      }
    }
  }
  private func showStatus(_ text: String) {
    status.attributedText = NSAttributedString(
      string: text,
      attributes: [
        .font: UIFont.preferredFont(forTextStyle: .body), .foregroundColor: UIColor.secondaryLabel,
      ])
  }
  /// The same error card the web shows: the block's own message, named as a script error.
  private func showScriptError(_ message: String) {
    let card = NSMutableAttributedString(
      string: "Script error\n",
      attributes: [
        .font: UIFont.preferredFont(forTextStyle: .headline), .foregroundColor: UIColor.systemRed,
      ])
    card.append(
      NSAttributedString(
        string: message,
        attributes: [
          .font: UIFontMetrics(forTextStyle: .body).scaledFont(
            for: .monospacedSystemFont(ofSize: 15, weight: .regular)),
          .foregroundColor: UIColor.label,
        ]))
    status.attributedText = card
  }
  private func actionHeight(fitting width: CGFloat) -> CGFloat {
    max(
      60,
      open.sizeThatFits(CGSize(width: max(1, width - 24), height: .greatestFiniteMagnitude))
        .height + 24)
  }
  override func contentSize(fitting width: CGFloat) -> CGSize {
    availableWidth = width
    load(width: width)
    return CGSize(width: width, height: blockHeight + actionHeight(fitting: width))
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    let contentHeight = max(0, bounds.height - actionHeight(fitting: bounds.width))
    image.frame = CGRect(x: 0, y: 0, width: bounds.width, height: contentHeight)
    status.frame = CGRect(
      x: 16, y: 12, width: max(0, bounds.width - 32), height: max(0, contentHeight - 24))
    open.frame = CGRect(
      x: 12, y: contentHeight, width: max(0, bounds.width - 24),
      height: bounds.height - contentHeight)
    load(width: availableWidth ?? bounds.width)
  }
}
