import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization
import Testing
@testable import LexidrawKit
private final class SavedImageServer: ClientTransport, Sendable {
  let requests = Mutex<[HTTPRequest]>([])
  let png: Data
  let status: Int
  init(png: Data, status: Int = 200) { self.png = png; self.status = status }
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    #expect(baseURL.absoluteString == "https://lexidraw.test")
    requests.withLock { $0.append(request) }
    var response = HTTPResponse(status: .init(code: status))
    response.headerFields[.contentType] = "image/png"
    response.headerFields[.contentLength] = String(png.count)
    return (response, HTTPBody(png))
  }
}
@Test @MainActor func nativeSavedImageUsesAppTokenOnlyAtValidatedOriginAndNeverCachesAcrossAccounts() async throws {
  let png = try Data(contentsOf: #require(Bundle.module.url(forResource: "generated-image", withExtension: "png", subdirectory: "Fixtures")))
  let server = SavedImageServer(png: png)
  let account = Account(origin: TestServer.origin, store: InMemoryTokenStore("lxd_saved_image"), savedImageTransport: server)
  let session = try #require(try account.restore())
  let path = "/api/generated-images/11111111-1111-4111-8111-111111111111"
  #expect(try await session.savedGeneratedImage(URL(string: path)!) == png)
  #expect(try await session.savedGeneratedImage(URL(string: "https://lexidraw.test" + path)!) == png)
  #expect(server.requests.withLock { $0.count } == 2)
  #expect(server.requests.withLock { $0[0].headerFields[.authorization] } == "Bearer lxd_saved_image")
  for source in ["https://evil.test" + path, "https://user:secret@lexidraw.test" + path, "https://lexidraw.test" + path + "?token=secret", "//evil.test" + path, "/api/generated-images/%2e%2e", "https://lexidraw.test:8443" + path] {
    await #expect(throws: Error.self) { try await session.savedGeneratedImage(URL(string: source)!) }
  }
  #expect(server.requests.withLock { $0.count } == 2)
  let denied = SavedImageServer(png: png, status: 302)
  let other = try #require(try Account(origin: TestServer.origin, store: InMemoryTokenStore("lxd_other"), savedImageTransport: denied).restore())
  await #expect(throws: Error.self) { try await other.savedGeneratedImage(URL(string: path)!) }
}
