import Foundation
import HTTPTypes
import OpenAPIRuntime
import Synchronization
import Testing
import zlib
@testable import LexidrawKit

private final class PixelKey: TokenStore, @unchecked Sendable {
  var value: String?
  func load() throws -> String? { value }
  func save(_ token: String) throws { value = token }
  func delete() throws { value = nil }
}
private final class PixelProvider: URLProtocol, @unchecked Sendable {
  static let payload = Mutex(Data())
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    guard request.url?.absoluteString == "https://openrouter.ai/api/v1/images" else {
      client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
    }
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200,
      httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Self.payload.withLock { $0 })
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}
private final class PixelStorage: ClientTransport, Sendable {
  let calls = Mutex(0)
  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
    guard baseURL.absoluteString == "https://storage.test" else { throw URLError(.unsupportedURL) }
    calls.withLock { $0 += 1 }
    return (HTTPResponse(status: .ok), nil)
  }
}
// Filter-0 RGB rows, 1024 square, no metadata. The credential is literal
// pixel-channel bytes on row 100, before the complete IDAT zlib compression.
private func pixelPNG(_ key: String?) throws -> Data {
  var pixels = Data(repeating: 0, count: 3073 * 1024)
  if let key { pixels.replaceSubrange((3073 * 100 + 1)..<(3073 * 100 + 1 + key.utf8.count), with: key.utf8) }
  var size = compressBound(uLong(pixels.count))
  var packed = Data(count: Int(size))
  let status = packed.withUnsafeMutableBytes { out in
    pixels.withUnsafeBytes { input in
      compress2(out.bindMemory(to: UInt8.self).baseAddress!, &size,
        input.bindMemory(to: UInt8.self).baseAddress!, uLong(pixels.count), 6)
    }
  }
  #expect(status == Z_OK)
  packed.count = Int(size)
  func word(_ value: Int) -> Data { Data((0..<4).map { UInt8((value >> ((3 - $0) * 8)) & 255) }) }
  func chunk(_ type: String, _ content: Data) -> Data {
    let payload = Data(type.utf8) + content
    let crc = payload.withUnsafeBytes { crc32(0, $0.bindMemory(to: UInt8.self).baseAddress!, uInt(payload.count)) }
    return word(content.count) + payload + word(Int(crc))
  }
  return Data([137, 80, 78, 71, 13, 10, 26, 10])
    + chunk("IHDR", word(1024) + word(1024) + Data([8, 2, 0, 0, 0]))
    + chunk("IDAT", packed) + chunk("IEND", Data())
}
@Suite(.serialized) @MainActor struct PixelCredentialTests {
  @Test func validPixelRowsCannotCarryKnownKeyIntoImageCheckpointOrGuardedStorage() async throws {
    let key = "pixel-custody-synthetic-supplied-provider-credential-291"
    let representations: [String?] = [nil, key, Data(key.utf8).base64EncodedString(),
      key.utf8.map { String(format: "%02x", $0) }.joined()]
    for payload in representations {
      let echoed = payload != nil
      let png = try pixelPNG(payload)
      let payload = try JSONSerialization.data(withJSONObject: ["data": [["media_type": "image/png", "b64_json": png.base64EncodedString()]]], options: .withoutEscapingSlashes)
      PixelProvider.payload.withLock { $0 = payload }
      let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [PixelProvider.self]
      let runtime = NativeBYOK(store: PixelKey(), configuration: config, imageFixture: true)
      try runtime.replaceKey(key)
      let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
      defer { try? FileManager.default.removeItem(at: directory) }
      let files = NativeImageFileStore(directory: directory)
      let server = PixelStorage()
      let storage = CredentialGuardedTransport(underlying: server)
      let flow = NativeImageFlow(source: { .byok }, capability: { .init(available: true, maximum: 0, fixture: true, reason: "") },
        generatePro: { _, _, _ in throw NativeImageError.unavailable },
        generateBYOK: { try await runtime.generateImage(prompt: $0) },
        save: { _, image in
          _ = try await storage.send(HTTPRequest(method: .put, scheme: nil, authority: nil, path: "/image.png"),
            body: HTTPBody(image.bytes), baseURL: URL(string: "https://storage.test")!, operationID: "generatedImage.upload")
          return URL(string: "https://storage.test/image.png")!
        }, files: files)
      await flow.generate("tree")
      if echoed {
        if case .failed = flow.state {} else { Issue.record("Pixel credential became a usable image") }
        #expect(try files.load() == nil)
        #expect(await flow.upload() == nil)
        #expect(server.calls.withLock { $0 } == 0)
      } else {
        #expect(try files.load()?.bytes == png)
        #expect(await flow.upload() != nil)
        #expect(server.calls.withLock { $0 } == 1)
      }
    }
  }
}
