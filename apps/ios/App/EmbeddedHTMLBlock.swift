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
  private var identity = ""
  private var destination: URL?
  private var aspect: CGFloat = 800 / 360
  var changed: (() -> Void)?

  init(session: Session, documentID: String) {
    self.session = session
    self.documentID = documentID
    super.init(frame: .zero)
    image.contentMode = .scaleAspectFit
    image.isAccessibilityElement = true
    status.numberOfLines = 0
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
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  deinit { request?.cancel() }

  override func show(_ node: JSONValue) {
    guard let block = node["block"], let blockID = block["id"]?.stringValue,
      UUID(uuidString: blockID) != nil, let revision = block["revision"]?.stringValue,
      !revision.isEmpty, revision.utf8.count <= 128
    else {
      request?.cancel()
      identity = ""
      destination = nil
      image.image = nil
      status.text = "HTML block preview unavailable"
      open.isHidden = true
      return
    }
    destination = session.htmlBlockLink(documentID: documentID, blockID: blockID)
    open.isHidden = false
    let next = "\(blockID):\(revision)"
    guard identity != next else { return }
    identity = next
    request?.cancel()
    image.image = nil
    let description = block["description"]?.stringValue ?? "HTML block"
    image.accessibilityLabel = "\(description), saved starting state"
    status.text = "Loading saved-state preview…"
    request = Task { [weak self, session, documentID] in
      do {
        let preview = try await session.htmlBlockPreview(
          documentID: documentID, blockID: blockID, revision: revision)
        try Task.checkCancellation()
        guard let self, self.identity == next else { return }
        guard
          let source = CGImageSourceCreateWithData(
            preview.png as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
          properties[kCGImagePropertyPixelWidth] as? Int == preview.width,
          properties[kCGImagePropertyPixelHeight] as? Int == preview.height,
          let decoded = UIImage(data: preview.png)
        else { throw URLError(.cannotDecodeContentData) }
        self.image.image = decoded
        self.aspect = CGFloat(preview.width) / CGFloat(preview.height)
        self.status.text = nil
        self.changed?()
      } catch {
        guard !Task.isCancelled, let self, self.identity == next else { return }
        self.status.text =
          "Saved-state preview unavailable. Open the block in your browser to use it."
        self.changed?()
      }
    }
  }
  override func contentSize(fitting width: CGFloat) -> CGSize {
    CGSize(
      width: width,
      height: max(180, width / aspect)
        + max(
          60,
          open.sizeThatFits(CGSize(width: max(1, width - 24), height: .greatestFiniteMagnitude))
            .height + 24))
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    let actionHeight = max(
      60,
      open.sizeThatFits(CGSize(width: max(1, bounds.width - 24), height: .greatestFiniteMagnitude))
        .height + 24)
    let contentHeight = max(0, bounds.height - actionHeight)
    image.frame = CGRect(x: 0, y: 0, width: bounds.width, height: contentHeight)
    status.frame = CGRect(
      x: 16, y: 12, width: max(0, bounds.width - 32), height: max(0, contentHeight - 24))
    open.frame = CGRect(
      x: 12, y: contentHeight, width: max(0, bounds.width - 24), height: actionHeight)
  }
}
