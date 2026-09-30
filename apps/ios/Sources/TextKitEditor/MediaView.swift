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
  private let caption: MediaCaptionView
  var onGeometryChange: (() -> Void)?
  private var loadedAspectRatio: Double?
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

  init(_ payload: MediaPayload, style: DocumentText.Style? = nil) {
    self.payload = payload
    caption = MediaCaptionView(payload, style: style)
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
    addSubview(caption)
    accessibilityLabel = [payload.label, payload.caption].filter { !$0.isEmpty }.joined(separator: ". ")
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(open(_:))))
  }
  required init?(coder: NSCoder) { fatalError("MediaView is made in code") }

  static func height(_ payload: MediaPayload, width: CGFloat) -> CGFloat {
    let size = geometry(payload, width: width, ratio: payload.aspectRatio, viewport: UIScreen.main.bounds.height)
    let caption = MediaCaptionView(payload)
    let captionHeight = caption.fittingHeight(size.width)
    return size.height + (captionHeight > 0 ? captionHeight + FigureStyle.captionGap : 0)
  }
  private static func geometry(_ payload: MediaPayload, width: CGFloat, ratio: Double, viewport: CGFloat) -> CGSize {
    let em = UIFont.preferredFont(forTextStyle: .body).pointSize
    let figure = payload.figureWidth(fitting: width, em: em)
    var mediaWidth = payload.figurePlacement == nil ? min(figure, payload.width ?? figure) : figure
    var height = mediaWidth / ratio
    if payload.type == "image" {
      let limit = payload.figurePlacement == nil
        ? min(viewport * MediaStyle.unplacedViewportShare, em * MediaStyle.unplacedMaximumRem, payload.height ?? .greatestFiniteMagnitude)
        : viewport * MediaStyle.imageViewportShare
      if height > limit { height = limit; if payload.figurePlacement == nil { mediaWidth = height * ratio } }
    }
    return CGSize(width: mediaWidth, height: height)
  }
  private func mediaSize(_ width: CGFloat) -> CGSize {
    Self.geometry(payload, width: width, ratio: loadedAspectRatio ?? payload.aspectRatio, viewport: window?.bounds.height ?? UIScreen.main.bounds.height)
  }
  func fittingHeight(_ width: CGFloat) -> CGFloat {
    let size = mediaSize(width)
    let captionHeight = caption.fittingHeight(size.width)
    return size.height + (captionHeight > 0 ? captionHeight + FigureStyle.captionGap : 0)
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    let size = mediaSize(bounds.width)
    let mediaWidth = size.width
    let captionHeight = caption.fittingHeight(mediaWidth)
    let bodyHeight = size.height
    let mediaFrame = CGRect(x: (bounds.width - mediaWidth) / 2, y: 0, width: mediaWidth, height: bodyHeight)
    picture.frame = mediaFrame
    videoLayer?.frame = mediaFrame
    message.frame = mediaFrame.insetBy(dx: 12, dy: 4)
    preview?.frame = mediaFrame
    caption.frame = CGRect(x: mediaFrame.minX, y: bodyHeight + FigureStyle.captionGap, width: mediaWidth, height: captionHeight)
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
          if let image = picture.image, image.size.height > 0 { loadedAspectRatio = image.size.width / image.size.height }
          setNeedsLayout()
          onGeometryChange?()
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
  @objc private func open(_ gesture: UITapGestureRecognizer) {
    let point = gesture.location(in: self)
    if caption.frame.contains(point) { caption.openLink(at: gesture.location(in: caption)); return }
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
  var captionStyle: DocumentText.Style?
  let payload: MediaPayload
  init(_ payload: MediaPayload) {
    self.payload = payload
    super.init(data: nil, ofType: nil)
    image = UIImage(systemName: "photo")
    let width = payload.width ?? 120
    let height = payload.height ?? width / payload.aspectRatio
    bounds = CGRect(x: 0, y: -4, width: width, height: height)
    allowsTextAttachmentView = false
  }
  required init?(coder: NSCoder) { fatalError("MediaAttachment is made in code") }
  @MainActor private var loading: Task<Void, Never>?
  @MainActor private var attempted = false
  @MainActor func load(onChange: @escaping @MainActor () -> Void) {
    guard !attempted, loading == nil else { return }
    attempted = true
    loading = Task {
      defer { loading = nil }
      let photo: UIImage
      if let source = payload.source, let loaded = try? await MediaView.image(source) { photo = loaded }
      else { photo = UIImage(systemName: "exclamationmark.triangle") ?? UIImage() }
      let caption = MediaCaptionView(payload, style: captionStyle)
      let width = bounds.width
      let bodyHeight = bounds.height
      let captionHeight = caption.fittingHeight(width)
      let gap = captionHeight > 0 ? FigureStyle.captionGap : 0
      let size = CGSize(width: width, height: bodyHeight + gap + captionHeight)
      let format = UIGraphicsImageRendererFormat()
      format.scale = min(format.scale, 2048 / max(size.width, size.height))
      image = UIGraphicsImageRenderer(size: size, format: format).image { context in
        photo.draw(in: AVMakeRect(aspectRatio: photo.size, insideRect: CGRect(x: 0, y: 0, width: width, height: bodyHeight)))
        if captionHeight > 0 {
          context.cgContext.translateBy(x: 0, y: bodyHeight + gap)
          caption.frame = CGRect(x: 0, y: 0, width: width, height: captionHeight)
          caption.draw(caption.bounds)
        }
      }
      bounds.size = size
      onChange()
    }
  }
}
#endif
