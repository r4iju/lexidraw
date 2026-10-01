#if canImport(UIKit)
import AVFoundation
import EditorModelInterface
import LexidrawJSON
import PhotosUI
import UIKit
import UniformTypeIdentifiers

@MainActor final class NativeVideoPicker: NSObject, PHPickerViewControllerDelegate {
  private weak var presenter: UIViewController?
  private let upload: @MainActor (Data) async throws -> URL
  private let inserted: (JSONValue) -> Void

  init(presenter: UIViewController, upload: @escaping @MainActor (Data) async throws -> URL, inserted: @escaping (JSONValue) -> Void) {
    self.presenter = presenter
    self.upload = upload
    self.inserted = inserted
  }

  func present() {
    var configuration = PHPickerConfiguration()
    configuration.filter = .videos
    configuration.selectionLimit = 1
    let picker = PHPickerViewController(configuration: configuration)
    picker.delegate = self
    presenter?.present(picker, animated: true)
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true) { [weak self] in
      guard let self, let result = results.first else { return }
      let waiting = UIAlertController(title: "Uploading video", message: "The video will be inserted when its upload finishes.", preferredStyle: .alert)
      presenter?.present(waiting, animated: true)
      result.itemProvider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { [weak self] url, error in
        let copied = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(url?.pathExtension ?? "mov")
        let failure: String?
        do {
          guard let url else { throw error ?? CocoaError(.fileReadCorruptFile) }
          try FileManager.default.copyItem(at: url, to: copied)
          failure = nil
        } catch { failure = error.localizedDescription }
        Task { @MainActor in
          guard let self else { try? FileManager.default.removeItem(at: copied); return }
          await self.send(copied, failure: failure, waiting: waiting)
        }
      }
    }
  }

  private func send(_ source: URL, failure: String?, waiting: UIAlertController) async {
    let output = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension("mp4")
    defer {
      try? FileManager.default.removeItem(at: source)
      try? FileManager.default.removeItem(at: output)
    }
    do {
      if let failure { throw NSError(domain: "VideoPicker", code: 1, userInfo: [NSLocalizedDescriptionKey: failure]) }
      let asset = AVURLAsset(url: source)
      guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else { throw CocoaError(.fileReadCorruptFile) }
      try await export.export(to: output, as: .mp4)
      let bytes = try output.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
      guard bytes > 0, bytes <= MediaVideos.maximumBytes else {
        throw NSError(domain: "VideoPicker", code: 2, userInfo: [NSLocalizedDescriptionKey: "Choose a video smaller than \(MediaVideos.maximumLabel)."])
      }
      let destination = try await upload(Data(contentsOf: output))
      var node = try JSONValue(parsing: MediaInsertions.nodes["video"]!).objectValue!
      node["src"] = .string(destination.absoluteString)
      let payload = JSONValue.object(node)
      waiting.dismiss(animated: true) { [self] in inserted(payload) }
    } catch {
      let message = error.localizedDescription
      waiting.dismiss(animated: true) { [weak self] in
        let alert = UIAlertController(title: "Couldn't insert video", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        self?.presenter?.present(alert, animated: true)
      }
    }
  }
}
#endif
