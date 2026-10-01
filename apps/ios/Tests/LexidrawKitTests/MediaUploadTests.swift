import Foundation
import Testing
@testable import LexidrawKit

@Suite struct MediaUploadTests {
  static let signed = #"{"url":"https://pictures.test/p.jpg","upload":{"method":"PUT","url":"https://store.test/signed","headers":{"x-upload-token":"disposable","content-type":"image/jpeg"}}}"#
  @Test func authorizesDocumentThenUploadsOnlySignedHeaders() async throws {
    let server = FakeServer { request in
      request.url.path.hasSuffix("/uploads") ? (200, Self.signed) : (200, DocumentTests.loaded(elements: #""{\"root\":{}}""#))
    }
    let session = try TestServer.session(server)
    let url = try await session.uploadImage(Data([1, 2, 3]), in: "n1", send: { request, data in
      #expect(request.url?.absoluteString == "https://store.test/signed")
      #expect(request.httpMethod == "PUT")
      #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
      #expect(request.value(forHTTPHeaderField: "x-upload-token") == "disposable")
      #expect(data == Data([1, 2, 3]))
      return 200
    })
    #expect(url.absoluteString == "https://pictures.test/p.jpg")
    #expect(server.requests.count == 2)
    #expect(server.requests.last?.object["size"] as? Int == 3)
  }
  @Test func refusesReadOnlyBeforeSigningUpload() async throws {
    let server = FakeServer { _ in (200, DocumentTests.loaded(elements: #""{\"root\":{}}""#, access: "READ")) }
    let session = try TestServer.session(server)
    await #expect(throws: ImageUploadError.self) {
      try await session.uploadImage(Data([1]), in: "n1", send: { _, _ in Issue.record("Read-only upload sent"); return 200 })
    }
    #expect(server.requests.count == 1)
  }
  @Test func doesNotReturnSourceBeforeUploadSucceeds() async throws {
    let server = FakeServer { request in
      request.url.path.hasSuffix("/uploads") ? (200, Self.signed) : (200, DocumentTests.loaded(elements: #""{\"root\":{}}""#))
    }
    let session = try TestServer.session(server)
    await #expect(throws: ImageUploadError.self) {
      try await session.uploadImage(Data([1]), in: "n1", send: { _, _ in 403 })
    }
  }
}

@Suite struct VideoUploadTests {
  @Test func uploadsOnlyToSignedVideoDestination() async throws {
    let server = FakeServer { _ in (200, MediaUploadTests.signed) }
    let session = try TestServer.session(server)
    let source = try await session.uploadVideo(Data([1, 2, 3]), in: "n1", send: { request, data in
      #expect(request.url?.absoluteString == "https://store.test/signed")
      #expect(request.httpMethod == "PUT")
      #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
      #expect(request.value(forHTTPHeaderField: "x-upload-token") == "disposable")
      #expect(data == Data([1, 2, 3]))
      return 200
    })
    #expect(source.absoluteString == "https://pictures.test/p.jpg")
    #expect(server.requests.count == 1)
    #expect(server.requests.first?.url.path == "/api/v1/entities/n1/video-uploads")
    #expect(server.requests.first?.object["contentType"] as? String == "video/mp4")
    #expect(server.requests.first?.object["size"] as? Int == 3)
  }
  @Test func refusesFailedSigningWithoutUploading() async throws {
    let server = FakeServer { _ in (404, #"{"message":"Entity not found","code":"NOT_FOUND"}"#) }
    let session = try TestServer.session(server)
    do {
      _ = try await session.uploadVideo(Data([1]), in: "n1", send: { _, _ in Issue.record("Upload sent after signing refusal"); return 200 })
      Issue.record("Signing refusal was ignored")
    } catch {}
  }
}
