import Foundation
import LexidrawJSON

public enum ImageUploadError: Error, LocalizedError, Sendable {
  case readOnly, invalidImage, failed(Int), invalidDestination
  public var errorDescription: String? {
    switch self {
    case .readOnly: "This document is read only."
    case .invalidImage: "Choose a picture no larger than \(MediaImages.maximumLabel)."
    case .failed(let status): "The picture upload failed (\(status)). Try again."
    case .invalidDestination: "The server returned an invalid picture upload address."
    }
  }
}

extension Session {
  /// JPEG from the native photo/camera picker. Only a successful upload is
  /// returned to the editor; the document's subsequent save checks edit access
  /// and claims the uploaded blob through the existing server rule.
  public func uploadImage(_ jpeg: Data, in document: String) async throws -> URL {
    try await uploadImage(jpeg, in: document) { request, data in
      let (_, response) = try await URLSession.shared.upload(for: request, from: data)
      return (response as? HTTPURLResponse)?.statusCode ?? 0
    }
  }

  func uploadImage(_ jpeg: Data, in document: String,
    send: @Sendable (URLRequest, Data) async throws -> Int
  ) async throws -> URL {
    guard !jpeg.isEmpty, jpeg.count <= MediaImages.maximumBytes else { throw ImageUploadError.invalidImage }
    guard try await self.document(document).access == .edit else { throw ImageUploadError.readOnly }
    let signed = try await ask {
      try await $0.entitiesSignImageUpload(body: .json(.init(contentType: .imageJpeg, size: jpeg.count)))
    }.ok.body.json
    guard let destination = URL(string: signed.upload.url), destination.scheme == "https",
      let source = URL(string: signed.url), source.scheme == "https" else { throw ImageUploadError.invalidDestination }
    var request = URLRequest(url: destination)
    request.httpMethod = signed.upload.method.rawValue
    request.allHTTPHeaderFields = signed.upload.headers.additionalProperties
    let status = try await send(request, jpeg)
    guard (200..<300).contains(status) else { throw ImageUploadError.failed(status) }
    return source
  }
}
