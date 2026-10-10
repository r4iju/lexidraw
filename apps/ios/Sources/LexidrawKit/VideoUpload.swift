import Foundation
import LexidrawJSON

public enum VideoUploadError: Error, LocalizedError, Sendable {
  case invalidVideo, invalidDestination, failed(Int)
  public var errorDescription: String? {
    switch self {
    case .invalidVideo: "Choose a video no larger than \(MediaVideos.maximumLabel)."
    case .invalidDestination: "The server returned an invalid video upload address."
    case .failed(let status): "The video upload failed (\(status)). Try again."
    }
  }
}

extension Session {
  public func uploadVideo(_ mp4: Data, in document: String) async throws -> URL {
    try await uploadVideo(mp4, in: document) { request, data in
      let (_, response) = try await URLSession.shared.upload(for: request, from: data)
      return (response as? HTTPURLResponse)?.statusCode ?? 0
    }
  }

  func uploadVideo(_ mp4: Data, in document: String,
    send: @Sendable (URLRequest, Data) async throws -> Int
  ) async throws -> URL {
    try NativeCredentialGuard.shared.check(mp4)
    guard !mp4.isEmpty, mp4.count <= MediaVideos.maximumBytes else { throw VideoUploadError.invalidVideo }
    let signed = try await ask {
      try await $0.entitiesSignVideoUpload(path: .init(entityId: document), body: .json(.init(contentType: .videoMp4, size: mp4.count)))
    }.ok.body.json
    guard let destination = URL(string: signed.upload.url), destination.scheme == "https",
      let source = URL(string: signed.url), source.scheme == "https" else { throw VideoUploadError.invalidDestination }
    var request = URLRequest(url: destination)
    request.httpMethod = signed.upload.method.rawValue
    request.allHTTPHeaderFields = signed.upload.headers.additionalProperties
    try NativeCredentialGuard.shared.check(request, body: mp4)
    let status: Int
    do { status = try await send(request, mp4) }
    catch {
      try NativeCredentialGuard.shared.check(error: error)
      throw error
    }
    guard (200..<300).contains(status) else { throw VideoUploadError.failed(status) }
    return source
  }
}
