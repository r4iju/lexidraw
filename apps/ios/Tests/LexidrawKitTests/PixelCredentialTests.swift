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
  static let requests = Mutex<[URLRequest]>([])
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    guard request.url?.absoluteString == "https://openrouter.ai/api/v1/images" else {
      client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
    }
    Self.requests.withLock { $0.append(request) }
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
private func pixelDeflate(_ bytes: Data) throws -> Data {
  var size = compressBound(uLong(bytes.count))
  var packed = Data(count: Int(size))
  let status = packed.withUnsafeMutableBytes { out in
    bytes.withUnsafeBytes { input in
      compress2(out.bindMemory(to: UInt8.self).baseAddress!, &size,
        input.bindMemory(to: UInt8.self).baseAddress!, uLong(bytes.count), 6)
    }
  }
  try #require(status == Z_OK)
  packed.count = Int(size)
  return packed
}
private func pixelPNG(_ key: String?, channels: Int = 3, nested: Bool = false) throws -> Data {
  let width = 1024 * channels, stride = width + 1, filter = nested && channels == 4 ? 1 : 0
  var channelsData = Data(repeating: 0, count: width * 1024)
  let offset = width * 100 + (nested ? width - 20 : 0)
  var nestedSize = 0
  if let key {
    let payload = nested ? try pixelDeflate(Data(key.utf8)) : Data(key.utf8)
    channelsData.replaceSubrange(offset..<offset + payload.count, with: payload)
    if nested { nestedSize = payload.count }
  } else if nested {
    let incidental = Data([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0x50, 0x4b, 3, 4, 0, 0, 0, 0])
    channelsData.replaceSubrange(offset..<offset + incidental.count, with: incidental)
  }
  var rows = Data(repeating: 0, count: stride * 1024)
  for row in 0..<1024 {
    rows[row * stride] = UInt8(filter)
    for column in 0..<width {
      let index = row * width + column
      let left = filter != 0 && column >= channels ? channelsData[index - channels] : 0
      rows[row * stride + column + 1] = channelsData[index] &- left
    }
  }
  let packed = try pixelDeflate(rows)
  if nested, let key {
    // Recover only this invented fixture through IDAT and the reversible filter.
    // Production admission is exercised separately through NativeBYOK below.
    var decoded = Data(count: rows.count), size = uLongf(rows.count)
    let result = decoded.withUnsafeMutableBytes { out in
      packed.withUnsafeBytes { input in
        uncompress(out.bindMemory(to: UInt8.self).baseAddress!, &size,
          input.bindMemory(to: UInt8.self).baseAddress!, uLong(packed.count))
      }
    }
    try #require(result == Z_OK && size == rows.count)
    for row in 0..<1024 where filter != 0 {
      for column in channels..<width {
        let index = row * stride + column + 1
        decoded[index] = decoded[index] &+ decoded[index - channels]
      }
    }
    let node = Data((offset..<offset + nestedSize).map { decoded[($0 / width) * stride + $0 % width + 1] })
    var recovered = Data(count: 4096)
    size = uLongf(recovered.count)
    let recoveredStatus = recovered.withUnsafeMutableBytes { out in
      node.withUnsafeBytes { input in
        uncompress(out.bindMemory(to: UInt8.self).baseAddress!, &size,
          input.bindMemory(to: UInt8.self).baseAddress!, uLong(node.count))
      }
    }
    try #require(recoveredStatus == Z_OK)
    recovered.count = Int(size)
    #expect(recovered == Data(key.utf8))
  }
  func word(_ value: Int) -> Data { Data((0..<4).map { UInt8((value >> ((3 - $0) * 8)) & 255) }) }
  func chunk(_ type: String, _ content: Data) -> Data {
    let payload = Data(type.utf8) + content
    let crc = payload.withUnsafeBytes { crc32(0, $0.bindMemory(to: UInt8.self).baseAddress!, uInt(payload.count)) }
    return word(content.count) + payload + word(Int(crc))
  }
  return Data([137, 80, 78, 71, 13, 10, 26, 10])
    + chunk("IHDR", word(1024) + word(1024) + Data([8, channels == 3 ? 2 : 6, 0, 0, 0]))
    + chunk("IDAT", packed) + chunk("IEND", Data())
}
@Suite(.serialized) @MainActor struct PixelCredentialTests {
  @Test(arguments: [3, 4])
  func compressedPixelsCannotEnterProductionImageCheckpointOrSessionUpload(channels: Int) async throws {
    let key = "nested-pixel-known-synthetic-device-credential-291"
    for echoed in [false, true] {
      let png = try pixelPNG(echoed ? key : nil, channels: channels, nested: true)
      let response = try JSONSerialization.data(withJSONObject:
        ["data": [["media_type": "image/png", "b64_json": png.base64EncodedString()]]], options: .withoutEscapingSlashes)
      PixelProvider.payload.withLock { $0 = response }
      PixelProvider.requests.withLock { $0 = [] }
      let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [PixelProvider.self]
      let runtime = NativeBYOK(store: PixelKey(), configuration: config, imageFixture: true)
      try runtime.replaceKey(key)
      defer { try? runtime.removeKey() }
      let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
      defer { try? FileManager.default.removeItem(at: directory) }
      let files = NativeImageFileStore(directory: directory)
      let app = FakeServer { request in
        guard request.url.string == "https://lexidraw.test/api/trpc/imagePower.save" else { throw URLError(.unsupportedURL) }
        #expect(request.authorization == "Bearer lxd_pixel_compression_fixture")
        let input = try #require(request.object["json"] as? [String: Any])
        let image = try #require(input["image"] as? [String: Any])
        #expect(image["base64"] as? String == png.base64EncodedString())
        return (200, #"{"result":{"data":{"json":{"id":"saved","url":"/api/generated-images/12345678-1234-1234-1234-123456789abc"}}}}"#)
      }
      let session = try #require(try Account(origin: TestServer.origin,
        store: InMemoryTokenStore("lxd_pixel_compression_fixture"), transport: app,
        savedImageTransport: app).restore())
      let flow = NativeImageFlow(source: { .byok }, capability: { .init(available: true, maximum: 0, fixture: true, reason: "") },
        generatePro: { _, _, _ in throw NativeImageError.unavailable },
        generateBYOK: { try await runtime.generateImage(prompt: $0) },
        save: { id, image in try await session.saveGeneratedImage(image, id: id, document: "doc") }, files: files)
      await flow.generate("tree")
      let provider = try #require(PixelProvider.requests.withLock { $0.first })
      #expect(PixelProvider.requests.withLock { $0.count } == 1)
      #expect(provider.value(forHTTPHeaderField: "Authorization") == "Bearer " + key)
      if echoed {
        if case .failed = flow.state {} else { Issue.record("Compressed pixel credential became a usable image") }
        #expect(try files.load() == nil)
        #expect(await flow.upload() == nil)
        #expect(app.requests.isEmpty)
      } else {
        if case .completed = flow.state {} else { Issue.record("Benign typed pixels rejected") }
        #expect(try files.load()?.bytes == png)
        #expect(await flow.upload()?.absoluteString == "https://lexidraw.test/api/generated-images/12345678-1234-1234-1234-123456789abc")
        #expect(app.requests.count == 1)
        #expect(try files.load() == nil)
      }
    }
  }
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
