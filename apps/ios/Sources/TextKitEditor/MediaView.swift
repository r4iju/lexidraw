#if canImport(UIKit)
import AVKit
import EditorModelInterface
import ImageIO
import LinkPresentation
import UIKit

@MainActor final class MediaView: UIView {
  let payload: MediaPayload
  private let picture = UIImageView()
  private let message = UILabel()
  private let caption = UILabel()
  private var player: AVPlayer?
  private var videoLayer: AVPlayerLayer?
  private var preview: LPLinkView?
  private var metadataProvider: LPMetadataProvider?
  private var loading: Task<Void, Never>?
  private var loaded = false
  private static let images: NSCache<NSURL, UIImage> = {
    let cache = NSCache<NSURL, UIImage>()
    cache.totalCostLimit = 32 * 1024 * 1024
    cache.countLimit = 64
    return cache
  }()

  init(_ payload: MediaPayload) {
    self.payload = payload
    super.init(frame: .zero)
    backgroundColor = .secondarySystemBackground
    layer.cornerRadius = 8
    clipsToBounds = true
    picture.contentMode = .scaleAspectFit
    addSubview(picture)
    message.text = payload.source == nil ? "\(payload.label): source unavailable" : "Loading \(payload.label)…"
    message.textAlignment = .center
    message.numberOfLines = 3
    message.font = .preferredFont(forTextStyle: .body)
    addSubview(message)
    caption.text = payload.caption
    caption.numberOfLines = 0
    caption.font = .preferredFont(forTextStyle: .caption1)
    caption.textColor = .secondaryLabel
    caption.textAlignment = .center
    addSubview(caption)
    accessibilityLabel = [payload.label, payload.caption].filter { !$0.isEmpty }.joined(separator: ". ")
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(open)))
  }
  required init?(coder: NSCoder) { fatalError("MediaView is made in code") }

  static func height(_ payload: MediaPayload, width: CGFloat) -> CGFloat {
    let mediaWidth = min(width, payload.width ?? width, payload.maxWidth ?? width)
    let captionHeight = captionHeight(payload, width: width)
    return min(600, max(40, mediaWidth / payload.aspectRatio)) + captionHeight
  }
  private static func captionHeight(_ payload: MediaPayload, width: CGFloat) -> CGFloat {
    guard !payload.caption.isEmpty else { return 0 }
    let size = (payload.caption as NSString).boundingRect(with: CGSize(width: max(1, width - 24), height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: UIFont.preferredFont(forTextStyle: .caption1)], context: nil)
    return ceil(size.height) + 12
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    let bottom = Self.captionHeight(payload, width: bounds.width)
    let content = CGRect(x: 0, y: 0, width: bounds.width, height: max(0, bounds.height - bottom))
    let mediaWidth = min(content.width, payload.width ?? content.width, payload.maxWidth ?? content.width)
    let mediaFrame = CGRect(x: (content.width - mediaWidth) / 2, y: 0, width: mediaWidth, height: content.height)
    picture.frame = mediaFrame
    videoLayer?.frame = mediaFrame
    message.frame = content.insetBy(dx: 12, dy: 4)
    preview?.frame = content
    caption.frame = CGRect(x: 12, y: content.maxY + 4, width: max(0, bounds.width - 24), height: max(0, bottom - 8))
  }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else { loading?.cancel(); loading = nil; metadataProvider?.cancel(); metadataProvider = nil; player?.pause(); return }
    guard !loaded, loading == nil, let source = payload.source else { return }
    loading = Task { [weak self] in
      guard let self else { return }
      defer { loading = nil }
      do {
        switch payload.type {
        case "image", "inline-image":
          picture.image = try await Self.image(source)
          try Task.checkCancellation()
          picture.accessibilityLabel = payload.label
          picture.isAccessibilityElement = true
          message.isHidden = true
        case "video":
          let player = AVPlayer(url: source)
          self.player = player
          let layer = AVPlayerLayer(player: player)
          layer.videoGravity = .resizeAspect
          videoLayer = layer
          self.layer.insertSublayer(layer, at: 0)
          setNeedsLayout()
          message.text = "▶︎ Play video"
          message.isHidden = false
        default:
          let provider = LPMetadataProvider()
          metadataProvider = provider
          let metadata = try await provider.startFetchingMetadata(for: source)
          try Task.checkCancellation()
          let link = LPLinkView(metadata: metadata)
          preview = link
          addSubview(link)
          bringSubviewToFront(caption)
          message.isHidden = true
          setNeedsLayout()
        }
        loaded = true
      } catch is CancellationError {} catch {
        message.text = "\(payload.label) unavailable. Tap to open."
        message.isHidden = false
        loaded = true
      }
    }
  }
  @objc private func open() {
    guard let source = payload.source else { return }
    if payload.type == "video" {
      var responder: UIResponder? = self
      while let current = responder {
        if let controller = current as? UIViewController {
          let playback = AVPlayerViewController()
          let player = self.player ?? AVPlayer(url: source)
          self.player = player
          playback.player = player
          controller.present(playback, animated: true) { player.play() }
          return
        }
        responder = current.next
      }
    } else { UIApplication.shared.open(source) }
  }
  fileprivate static func image(_ url: URL) async throws -> UIImage {
    if let cached = images.object(forKey: url as NSURL) { return cached }
    let data: Data
    if url.scheme == "data" {
      let value = url.absoluteString
      guard let comma = value.firstIndex(of: ","), value.utf8.count <= 14 * 1024 * 1024,
        let decoded = Data(base64Encoded: String(value[value.index(after: comma)...])), decoded.count <= 10 * 1024 * 1024 else { throw URLError(.cannotDecodeContentData) }
      data = decoded
    } else {
      let (file, response) = try await URLSession.shared.download(from: url)
      defer { try? FileManager.default.removeItem(at: file) }
      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 10 * 1024 * 1024 else { throw URLError(.cannotDecodeContentData) }
      data = try Data(contentsOf: file)
    }
    let image = try await Task.detached(priority: .utility) {
      guard let source = CGImageSourceCreateWithData(data as CFData, nil),
        let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceThumbnailMaxPixelSize: 2048,
          kCGImageSourceCreateThumbnailWithTransform: true,
        ] as CFDictionary) else { throw URLError(.cannotDecodeContentData) }
      return UIImage(cgImage: cg)
    }.value
    try Task.checkCancellation()
    images.setObject(image, forKey: url as NSURL, cost: image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0)
    return image
  }
}

final class MediaAttachment: NSTextAttachment {
  let payload: MediaPayload
  init(_ payload: MediaPayload) {
    self.payload = payload
    super.init(data: nil, ofType: nil)
    image = UIImage(systemName: "photo")
    let width = min(240, max(24, payload.width ?? 120))
    let height = min(240, max(24, payload.height ?? width / payload.aspectRatio))
    bounds = CGRect(x: 0, y: -4, width: width, height: height)
    allowsTextAttachmentView = false
  }
  required init?(coder: NSCoder) { fatalError("MediaAttachment is made in code") }
  @MainActor private var loading: Task<Void, Never>?
  @MainActor private var attempted = false
  @MainActor func load(onChange: @escaping @MainActor () -> Void) {
    guard !attempted, loading == nil, let source = payload.source else { return }
    attempted = true
    loading = Task {
      defer { loading = nil }
      do {
        image = try await MediaView.image(source)
        onChange()
      } catch {
        image = UIImage(systemName: "exclamationmark.triangle")
        onChange()
      }
    }
  }
}
#endif
