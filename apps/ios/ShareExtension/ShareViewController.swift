import LexidrawKit
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// The share sheet's way in: hosts the save screen and ends the request when
/// it is done or cancelled.
@objc(ShareViewController)
final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? []).flatMap { $0.attachments ?? [] }
    let host = UIHostingController(
      rootView: ShareRoot(
        session: (try? Account.configured().restore()) ?? nil,
        load: { await Attachments.load(providers) },
        close: { [weak self] in self?.extensionContext?.completeRequest(returningItems: nil) }
      ))
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(host.view)
    host.didMove(toParent: self)
  }
}

/// What the share sheet hands over, read into what ``Shared`` is made from.
@MainActor
enum Attachments {
  static func load(_ providers: [NSItemProvider]) async -> Shared? {
    var urls: [URL] = []
    var texts: [String] = []
    var images: [SharedImage] = []
    for provider in providers {
      if let type = provider.registeredContentTypes.first(where: { $0.conforms(to: .image) }) {
        if let image = await image(from: provider, as: type) { images.append(image) }
      } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
        if let url = await object(URL.self, from: provider) { urls.append(url) }
      } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
        if let text = await object(String.self, from: provider) { texts.append(text) }
      }
    }
    return Shared(urls: urls, texts: texts, images: images)
  }

  private static func object<T: _ObjectiveCBridgeable & Sendable>(_ type: T.Type, from provider: NSItemProvider) async
    -> T? where T._ObjectiveCType: NSItemProviderReading
  {
    await withCheckedContinuation { continuation in
      _ = provider.loadObject(ofClass: type) { object, _ in continuation.resume(returning: object) }
    }
  }

  /// Made ready to send where it loads, off the main thread, since a photo
  /// may need shrinking.
  private static func image(from provider: NSItemProvider, as type: UTType) async -> SharedImage? {
    await withCheckedContinuation { continuation in
      _ = provider.loadDataRepresentation(for: type) { data, _ in
        continuation.resume(returning: data.flatMap { SharedImage(data: $0, type: type) })
      }
    }
  }
}
