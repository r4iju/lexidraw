#if canImport(UIKit)
import AVKit
import CryptoKit
import EditorModelInterface
import ImageIO
import LinkPresentation
import UIKit

/// Return an image whose logical size retains the original source dimensions.
public typealias MediaImageLoader = @MainActor (URL) async throws -> UIImage

@MainActor public enum NativeMediaImages {
  public static func load(_ source: URL) async throws -> UIImage { try await MediaView.image(source) }
  public static func load(_ source: URL, rasterizeSVG: @escaping @MainActor (Data) async throws -> UIImage) async throws -> UIImage {
    try await MediaView.image(source, rasterizeSVG: rasterizeSVG)
  }
  private static let loops = NSMapTable<UIImage, NSNumber>(keyOptions: .weakMemory, valueOptions: .strongMemory)
  static func setLoopCount(_ count: Int, for image: UIImage) { loops.setObject(NSNumber(value: count), forKey: image) }
  static func loopCount(_ image: UIImage) -> Int { loops.object(forKey: image)?.intValue ?? 0 }
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
  private static let images: NSCache<NSString, UIImage> = {
    let cache = NSCache<NSString, UIImage>()
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
    guard window != nil else { loading?.cancel(); loading = nil; metadataProvider?.cancel(); metadataProvider = nil; player?.pause(); picture.stopAnimating(); return }
    if loaded { startAnimation(); return }
    guard !loaded, loading == nil, let source = payload.source else { return }
    loading = Task { [weak self] in
      guard let self else { return }
      defer { loading = nil }
      do {
        switch payload.type {
        case "image", "inline-image":
          picture.image = try await (imageLoader ?? NativeMediaImages.load)(source)
          startAnimation()
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
  private func startAnimation() {
    guard let image = picture.image, let frames = image.images else { return }
    picture.animationImages = frames
    picture.animationDuration = image.duration
    picture.animationRepeatCount = NativeMediaImages.loopCount(image)
    picture.startAnimating()
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
  static func image(_ url: URL, rasterizeSVG: (@MainActor (Data) async throws -> UIImage)? = nil) async throws -> UIImage {
    // Data URLs can be megabytes long; the bounded cache retains only their digest.
    let cacheKey = await Task.detached(priority: .utility) { SHA256.hash(data: Data(url.absoluteString.utf8)).description }.value as NSString
    if let cached = images.object(forKey: cacheKey) { return cached }
    let data: Data
    var isSVG = url.pathExtension.lowercased() == "svg" || url.absoluteString.hasPrefix("data:image/svg+xml;")
    if url.scheme == "data" {
      let value = url.absoluteString
      guard let comma = value.firstIndex(of: ","), value.utf8.count <= MediaImages.maximumBytes * 3 + 128 else { throw URLError(.cannotDecodeContentData) }
      let header = value[..<comma].lowercased()
      let base64 = header.hasSuffix(";base64")
      let limit = base64 ? (MediaImages.maximumBytes + 2) / 3 * 4 : MediaImages.maximumBytes
      var escaped = Data()
      var bytes = value[value.index(after: comma)...].utf8.makeIterator()
      func hex(_ byte: UInt8?) -> UInt8? {
        guard let byte else { return nil }
        switch byte {
        case 48...57: return byte - 48
        case 65...70: return byte - 55
        case 97...102: return byte - 87
        default: return nil
        }
      }
      while let byte = bytes.next() {
        if byte == 37 {
          guard let high = hex(bytes.next()), let low = hex(bytes.next()) else { throw URLError(.cannotDecodeContentData) }
          escaped.append(high * 16 + low)
        } else { escaped.append(byte) }
        guard escaped.count <= limit else { throw URLError(.dataLengthExceedsMaximum) }
      }
      if base64 {
        guard let decoded = Data(base64Encoded: escaped), decoded.count <= MediaImages.maximumBytes else { throw URLError(.cannotDecodeContentData) }
        data = decoded
      } else { data = escaped }
      isSVG = header.hasPrefix("data:image/svg+xml")
    } else {
      let (file, response) = try await URLSession.shared.download(from: url)
      defer { try? FileManager.default.removeItem(at: file) }
      guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= MediaImages.maximumBytes else { throw URLError(.cannotDecodeContentData) }
      data = try Data(contentsOf: file)
      isSVG = isSVG || response.mimeType == "image/svg+xml"
    }
    isSVG = isSVG || String(decoding: data.prefix(512), as: UTF8.self).contains("<svg")
    if isSVG {
      guard data.count <= 8_000_000 else { throw URLError(.dataLengthExceedsMaximum) }
      guard let rasterizeSVG else { throw MediaImageError.unsupportedFormat("SVG images") }
      let image = try await rasterizeSVG(data)
      try Task.checkCancellation()
      images.setObject(image, forKey: cacheKey, cost: image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0)
      return image
    }
    let (image, loopCount) = try await Task.detached(priority: .utility) {
      guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
        if url.pathExtension.lowercased() == "svg" || String(decoding: data.prefix(512), as: UTF8.self).contains("<svg") { throw MediaImageError.unsupportedFormat("SVG images") }
        throw URLError(.cannotDecodeContentData)
      }
      let count = CGImageSourceGetCount(source)
      guard count > 0, count <= 512 else { throw URLError(.cannotDecodeContentData) }
      if count > 1 {
        // Bound all decoded frames together, rather than downsampling each to the static-image ceiling.
        let side = min(2048, Int(sqrt(Double(32 * 1024 * 1024 / (count * 4)))))
        var frames: [UIImage] = []
        var delays: [Int] = []
        var decodedBytes = 0
        for index in 0..<count {
          try Task.checkCancellation()
          guard let cg = CGImageSourceCreateThumbnailAtIndex(source, index, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceThumbnailMaxPixelSize: side,
            kCGImageSourceCreateThumbnailWithTransform: true,
          ] as CFDictionary) else { throw URLError(.cannotDecodeContentData) }
          decodedBytes += cg.bytesPerRow * cg.height
          guard decodedBytes <= 32 * 1024 * 1024 else { throw URLError(.dataLengthExceedsMaximum) }
          let properties = CGImageSourceCopyPropertiesAtIndex(source, index, nil) as? [CFString: Any]
          let width = (properties?[kCGImagePropertyPixelWidth] as? NSNumber)?.doubleValue ?? Double(cg.width)
          let height = (properties?[kCGImagePropertyPixelHeight] as? NSNumber)?.doubleValue ?? Double(cg.height)
          let scale = Double(max(cg.width, cg.height)) / max(width, height, 1)
          frames.append(UIImage(cgImage: cg, scale: scale, orientation: .up))
          let metadata = (properties?[kCGImagePropertyGIFDictionary] ?? properties?[kCGImagePropertyPNGDictionary] ?? properties?[kCGImagePropertyWebPDictionary]) as? [CFString: Any]
          let seconds = (metadata?[kCGImagePropertyGIFUnclampedDelayTime] ?? metadata?[kCGImagePropertyAPNGUnclampedDelayTime] ?? metadata?[kCGImagePropertyWebPUnclampedDelayTime] ?? metadata?[kCGImagePropertyGIFDelayTime] ?? metadata?[kCGImagePropertyAPNGDelayTime] ?? metadata?[kCGImagePropertyWebPDelayTime]) as? NSNumber
          let delay = seconds?.doubleValue ?? 0.1
          delays.append(Int((min(max(delay.isFinite && delay >= 0.02 ? delay : 0.1, 0.02), 60) * 1000).rounded()))
        }
        func gcd(_ a: Int, _ b: Int) -> Int { b == 0 ? a : gcd(b, a % b) }
        let total = delays.reduce(0, +)
        let tick = max(delays.reduce(delays[0], gcd), Int(ceil(Double(total) / 4096)))
        let timed = zip(frames, delays).flatMap { frame, delay in Array(repeating: frame, count: max(1, Int((Double(delay) / Double(tick)).rounded()))) }
        guard let animation = UIImage.animatedImage(with: timed, duration: Double(total) / 1000) else { throw URLError(.cannotDecodeContentData) }
        let properties = CGImageSourceCopyProperties(source, nil) as? [CFString: Any]
        let metadata = (properties?[kCGImagePropertyGIFDictionary] ?? properties?[kCGImagePropertyPNGDictionary] ?? properties?[kCGImagePropertyWebPDictionary]) as? [CFString: Any]
        let loops = (metadata?[kCGImagePropertyGIFLoopCount] ?? metadata?[kCGImagePropertyAPNGLoopCount] ?? metadata?[kCGImagePropertyWebPLoopCount]) as? NSNumber
        return (animation, loops?.intValue ?? 0)
      }
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
      return (UIImage(cgImage: cg, scale: scale, orientation: .up), 0)
    }.value
    try Task.checkCancellation()
    NativeMediaImages.setLoopCount(loopCount, for: image)
    let cost = image.images.map { frames in frames.reduce(0) { $0 + ($1.cgImage.map { $0.bytesPerRow * $0.height } ?? 0) } } ?? image.cgImage.map { $0.bytesPerRow * $0.height } ?? 0
    images.setObject(image, forKey: cacheKey, cost: cost)
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
  @MainActor private var animation: Task<Void, Never>?
  @MainActor private var animate: (() -> Void)?
  @MainActor private var changed: (() -> Void)?
  @MainActor private var visible = true
  @MainActor func setAnimationVisible(_ visible: Bool) {
    self.visible = visible
    if visible { animate?() } else { animation?.cancel(); animation = nil }
  }
  deinit { animation?.cancel() }
  @MainActor func load(onChange: @escaping @MainActor () -> Void) {
    changed = onChange
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
      let source = payload.source
      func draw(_ frame: UIImage) -> UIImage {
        UIGraphicsImageRenderer(size: size, format: format).image { context in
          if let failure {
            let paragraph = NSMutableParagraphStyle(); paragraph.alignment = .center
            let text = failure + (source?.scheme == "https" || source?.scheme == "http" ? "\nTap to open original." : "")
            (text as NSString).draw(in: CGRect(x: 4, y: 4, width: width - 8, height: bodyHeight - 8), withAttributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: UIColor.secondaryLabel, .paragraphStyle: paragraph])
          } else { frame.draw(in: AVMakeRect(aspectRatio: frame.size, insideRect: CGRect(x: 0, y: 0, width: width, height: bodyHeight))) }
          if captionHeight > 0 {
            context.cgContext.translateBy(x: 0, y: bodyHeight + gap)
            caption.frame = CGRect(x: 0, y: 0, width: width, height: captionHeight)
            caption.draw(caption.bounds)
          }
        }
      }
      image = draw(photo.images?.first ?? photo)
      bounds.size = size
      changed?()
      guard let frames = photo.images, !frames.isEmpty, photo.duration > 0 else { return }
      let interval = photo.duration / Double(frames.count)
      let repetitions = NativeMediaImages.loopCount(photo)
      var index = 0
      var rounds = 0
      var finished = false
      animate = { [weak self] in
        guard let self, self.visible, !finished, self.animation == nil else { return }
        self.animation = Task { @MainActor [weak self] in
          while !Task.isCancelled {
            do { try await Task.sleep(for: .seconds(interval)) } catch { return }
            guard let self else { return }
            index += 1
            if index == frames.count {
              index = 0; rounds += 1
              if repetitions > 0 && rounds >= repetitions { finished = true; self.animation = nil; return }
            }
            self.image = draw(frames[index])
            self.changed?()
          }
        }
      }
      animate?()
    }
  }
}
#endif
