#if canImport(UIKit)
import EditorModelInterface
import PhotosUI
import UIKit

@MainActor final class NativeImagePicker: NSObject, PHPickerViewControllerDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
  private weak var presenter: UIViewController?
  private let upload: @MainActor (Data) async throws -> URL
  private let inserted: (JSONValue) -> Void

  init(presenter: UIViewController, upload: @escaping @MainActor (Data) async throws -> URL, inserted: @escaping (JSONValue) -> Void) {
    self.presenter = presenter
    self.upload = upload
    self.inserted = inserted
  }
  func present(camera: Bool) {
    if camera {
      let picker = UIImagePickerController()
      picker.sourceType = .camera
      picker.delegate = self
      presenter?.present(picker, animated: true)
    } else {
      var configuration = PHPickerConfiguration()
      configuration.filter = .images
      configuration.selectionLimit = 1
      let picker = PHPickerViewController(configuration: configuration)
      picker.delegate = self
      presenter?.present(picker, animated: true)
    }
  }
  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true) { [weak self] in
      guard let self, let result = results.first else { return }
      result.itemProvider.loadDataRepresentation(forTypeIdentifier: "public.image") { [weak self] data, error in
        Task { @MainActor in
          guard let self else { return }
          guard let data, let image = UIImage(data: data) else { self.refused(error?.localizedDescription ?? "The picture couldn't be read."); return }
          self.send(image)
        }
      }
    }
  }
  func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { picker.dismiss(animated: true) }
  func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
    let image = info[.originalImage] as? UIImage
    picker.dismiss(animated: true) { [weak self] in
      guard let self, let image else { return }
      self.send(image)
    }
  }
  private func send(_ image: UIImage) {
    guard let data = image.jpegData(compressionQuality: 0.85) else { refused("The picture couldn't be prepared."); return }
    let waiting = UIAlertController(title: "Uploading picture", message: "The picture will be inserted when its upload finishes.", preferredStyle: .alert)
    presenter?.present(waiting, animated: true)
    Task {
      do {
        let source = try await upload(data)
        var fields = try JSONValue(parsing: MediaImages.insertionNodeJSON).objectValue!
        fields["src"] = .string(source.absoluteString)
        fields["width"] = .number(Double(image.size.width))
        fields["height"] = .number(Double(image.size.height))
        let node = JSONValue.object(fields)
        waiting.dismiss(animated: true) { [self] in inserted(node) }
      } catch { waiting.dismiss(animated: true) { [self] in refused(error.localizedDescription) } }
    }
  }
  private func refused(_ message: String) {
    let alert = UIAlertController(title: "Couldn't insert picture", message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    presenter?.present(alert, animated: true)
  }
}
#endif
