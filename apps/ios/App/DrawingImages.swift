import DrawingKit
import LexidrawKit
import WebKit

/// The files a drawing's images show, fetched once the drawing is open.
enum DrawingImages {
  /// Each stored file an image element in `elements` shows, as it is fetched.
  static func load(
    for elements: [JSONValue], drawing: String, session: Session,
    loaded: @MainActor (String, DrawingImage) -> Void
  ) async {
    let shown = Set(
      elements.filter { $0["type"] == "image" && $0["isDeleted"]?.boolValue != true }
        .compactMap { $0["fileId"]?.stringValue })
    guard !shown.isEmpty, let links = try? await session.files(ofDrawing: drawing) else { return }
    for link in links where shown.contains(link.id) {
      guard let data = try? await session.data(of: link) else { continue }
      await loaded(link.id, await decode(data, mimeType: link.mimeType))
    }
  }

  static func decode(_ data: Data, mimeType: String) async -> DrawingImage {
    if mimeType == "image/svg+xml", let (bitmap, scale) = await SVGRasterizer.shared.rasterize(data) {
      return DrawingImage(bitmap: bitmap, mimeType: mimeType, scale: scale)
    }
    return DrawingImage(data: data, mimeType: mimeType)
  }
}

/// Draws an SVG as a browser draws it onto a canvas, the way the web shows
/// one in a drawing, since ImageIO doesn't read SVG.
@MainActor final class SVGRasterizer: NSObject, WKNavigationDelegate {
  static let shared = SVGRasterizer()

  private let view = WKWebView(frame: .zero)
  private var ready: [CheckedContinuation<Void, Never>]? = []

  override init() {
    super.init()
    view.navigationDelegate = self
    view.loadHTMLString("<!doctype html>", baseURL: nil)
  }

  nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    Task { @MainActor in
      let waiting = ready ?? []
      ready = nil
      for continuation in waiting { continuation.resume() }
    }
  }

  /// The SVG's pixels at twice its own size, as far as 4096 pixels a side
  /// allow, so it stays sharp when zoomed in; and that scale.
  func rasterize(_ svg: Data) async -> (CGImage, Double)? {
    if ready != nil { await withCheckedContinuation { ready?.append($0) } }
    let script = """
      const image = new Image();
      image.src = source;
      await image.decode();
      const side = Math.max(image.naturalWidth, image.naturalHeight, 1);
      const scale = Math.min(2, 4096 / side);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      return [canvas.toDataURL("image/png"), canvas.width / image.naturalWidth];
      """
    guard
      let result = try? await view.callAsyncJavaScript(
        script, arguments: ["source": "data:image/svg+xml;base64,\(svg.base64EncodedString())"],
        contentWorld: .defaultClient) as? [Any],
      let url = result.first as? String, let scale = result.last as? Double,
      let comma = url.firstIndex(of: ","), let png = Data(base64Encoded: String(url[url.index(after: comma)...])),
      let bitmap = DrawingImage(data: png, mimeType: "image/png").bitmap
    else { return nil }
    return (bitmap, scale)
  }
}
