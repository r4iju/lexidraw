#if canImport(UIKit)
import AVKit
import EditorModelInterface
import ImageIO
import LinkPresentation
import UIKit

/// Return an image whose logical size retains the original source dimensions.
public typealias MediaImageLoader = @MainActor (URL) async throws -> UIImage

@MainActor public enum NativeMediaImages {
  public static func load(_ source: URL) async throws -> UIImage { try await MediaView.image(source) }
}

enum MediaImageError: Error, LocalizedError, Equatable {
  case unsupportedFormat(String)
  var errorDescription: String? {
    switch self { case .unsupportedFormat(let format): "\(format) aren't supported yet (#131)." }
  }
}

@MainActor final class MediaView: UIView {
  let payload: MediaPayload
  private let picture = UIImageView()
  private let message = UILabel()
  private let caption: MediaCaptionView
  private let imageLoader: MediaImageLoader?
  var onGeometryChange: (() -> Void)?
  private var loadedAspectRatio: Double?
  private var loadedNaturalWidth: Double?
  private var player: AVPlayer?
  private var videoLayer: AVPlayerLayer?
  private var preview: LPLinkView?
  private var metadataProvider: LPMetadataProvider?
  private var loading: Task<Void, Never>?
  private var loaded = false
  private var unavailable = false
  private static let images: NSCache<NSURL, UIImage> = {
    let cache = NSCache<NSURL, UIImage>()
    cache.totalCostLimit = 32 * 1024 * 1024
    cache.countLimit = 64
    return cache
  }()

  init(_ payload: MediaPayload, style: DocumentText.Style? = nil, imageLoader: MediaImageLoader? = nil) {
    self.payload = payload
    caption = MediaCaptionView(payload, style: style)
    self.imageLoader = imageLoader
    super.init(frame: .zero)
    unavailable = payload.source == nil
    backgroundColor = .secondarySystemBackground
    layer.cornerRadius = 8
    clipsToBounds = true
    picture.contentMode = .scaleAspectFit
    addSubview(picture)
    message.text = payload.source == nil ? "\(payload.label): source unavailable" : "Loading \(payload.label)…"
    message.textAlignment = .center
    message.numberOfLines = 0
    message.font = .preferredFont(forTextStyle: .body)
    addSubview(message)
    addSubview(caption)
    accessibilityLabel = [payload.label, payload.caption].filter { !$0.isEmpty }.joined(separator: ". ")
    addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(open(_:))))
  }
  required init?(coder: NSCoder) { fatalError("MediaView is made in code") }

  static func height(_ payload: MediaPayload, width: CGFloat) -> CGFloat {
    let size = geometry(payload, width: width, ratio: payload.aspectRatio, naturalWidth: payload.naturalWidth, viewport: UIScreen.main.bounds.height)
    let caption = MediaCaptionView(payload)
    let captionHeight = caption.fittingHeight(size.width)
    return size.height + (captionHeight > 0 ? captionHeight + FigureStyle.captionGap : 0)
  }
  private static func geometry(_ payload: MediaPayload, width: CGFloat, ratio: Double, naturalWidth: Double?, viewport: CGFloat) -> CGSize {
    let em = UIFont.preferredFont(forTextStyle: .body).pointSize
    let figure = payload.figureWidth(fitting: width, em: em)
    var mediaWidth = payload.figurePlacement == nil ? min(figure, payload.width ?? figure) : figure
    if payload.type == "image", payload.figurePlacement == nil { mediaWidth = min(mediaWidth, naturalWidth ?? mediaWidth) }
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
    let size = Self.geometry(payload, width: width, ratio: loadedAspectRatio ?? payload.aspectRatio, naturalWidth: loadedNaturalWidth ?? payload.naturalWidth, viewport: window?.bounds.height ?? UIScreen.main.bounds.height)
    return unavailable ? CGSize(width: min(width, max(180, size.width)), height: max(96, size.height)) : size
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
          picture.image = try await (imageLoader ?? NativeMediaImages.load)(source)
          try Task.checkCancellation()
          if let image = picture.image, image.size.height > 0 {
            loadedAspectRatio = image.size.width / image.size.height
            loadedNaturalWidth = image.size.width
          }
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
        message.text = (error as? MediaImageError)?.errorDescription.map { $0 + " Tap to open original." } ?? "\(payload.label) unavailable. Tap to open original."
        message.isHidden = false
        loaded = true
        unavailable = true
        setNeedsLayout()
        onGeometryChange?()
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
  static func image(_ url: URL) async throws -> UIImage {
    if let cached = images.object(forKey: url as NSURL) { return cached }
    let data: Data
    if url.scheme == "data" {
      let value = url.absoluteString
      guard let comma = value.firstIndex(of: ","), value.utf8.count <= ((MediaImages.maximumBytes + 2) / 3 * 4 + 128),
        let decoded = Data(base64Encoded: String(value[value.index(after: comma)...])), decoded.count <= MediaImages.maximumBytes else { throw URLError(.cannotDecodeContentData) }
      data = decoded
    } else {
      let (file, response) = try await URLSession.shared.download(from: url)
      defer { try? FileManager.default.removeItem(at: file) }
      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= MediaImages.maximumBytes else { throw URLError(.cannotDecodeContentData) }
      data = try Data(contentsOf: file)
    }
    let image = try await Task.detached(priority: .utility) {
      guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
        if url.pathExtension.lowercased() == "svg" || String(decoding: data.prefix(512), as: UTF8.self).contains("<svg") { throw MediaImageError.unsupportedFormat("SVG images") }
        throw URLError(.cannotDecodeContentData)
      }
      guard CGImageSourceGetCount(source) == 1 else { throw MediaImageError.unsupportedFormat("Animated images") }
      guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceThumbnailMaxPixelSize: 2048,
          kCGImageSourceCreateThumbnailWithTransform: true,
        ] as CFDictionary) else { throw URLError(.cannotDecodeContentData) }
      // Keep CSS's intrinsic source dimensions after downsampling. EXIF
      // orientation may swap axes, so compare the longest sides.
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
      let originalWidth = (properties?[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue ?? Double(cg.width)
      let originalHeight = (properties?[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue ?? Double(cg.height)
      let originalSide = max(originalWidth, originalHeight)
      let scale = originalSide.isFinite && originalSide > 0 ? Double(max(cg.width, cg.height)) / originalSide : 1
      return UIImage(cgImage: cg, scale: scale, orientation: .up)
    }.value
    try Task.checkCancellation()
    images.setObject(image, forKey: url as NSURL, cost: image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0)
    return image
  }
}

final class MediaAttachment: NSTextAttachment, LazyTextAttachment {
  private let imageLoader: MediaImageLoader?
  var captionStyle: DocumentText.Style?
  let payload: MediaPayload
  init(_ payload: MediaPayload, imageLoader: MediaImageLoader? = nil) {
    self.payload = payload
    self.imageLoader = imageLoader
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
      var failure: String?
      if let source = payload.source {
        do { photo = try await (imageLoader ?? NativeMediaImages.load)(source) }
        catch {
          photo = UIImage(systemName: "exclamationmark.triangle") ?? UIImage()
          failure = (error as? MediaImageError)?.errorDescription ?? "Image unavailable."
        }
      } else {
        photo = UIImage(systemName: "exclamationmark.triangle") ?? UIImage()
        failure = "Image source unavailable."
      }
      let caption = MediaCaptionView(payload, style: captionStyle)
      var width: CGFloat = payload.width.map { CGFloat($0) } ?? photo.size.width
      var bodyHeight: CGFloat = payload.height.map { CGFloat($0) } ?? (photo.size.width > 0 ? width * photo.size.height / photo.size.width : bounds.height)
      if failure != nil { width = max(width, 180); bodyHeight = max(bodyHeight, 72) }
      let captionHeight = caption.fittingHeight(width)
      let gap = captionHeight > 0 ? FigureStyle.captionGap : 0
      let size = CGSize(width: width, height: bodyHeight + gap + captionHeight)
      let format = UIGraphicsImageRendererFormat()
      format.scale = min(format.scale, 2048 / max(size.width, size.height))
      image = UIGraphicsImageRenderer(size: size, format: format).image { context in
        if let failure {
          let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
          let text = failure + (payload.source?.scheme == "https" || payload.source?.scheme == "http" ? "\nTap to open original." : "")
          (text as NSString).draw(in: CGRect(x: 4, y: 4, width: width - 8, height: bodyHeight - 8), withAttributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: UIColor.secondaryLabel, .paragraphStyle: paragraph])
        } else { photo.draw(in: AVMakeRect(aspectRatio: photo.size, insideRect: CGRect(x: 0, y: 0, width: width, height: bodyHeight))) }
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
