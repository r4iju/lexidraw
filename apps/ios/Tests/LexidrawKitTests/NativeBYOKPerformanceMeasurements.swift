import CoreGraphics
import Foundation
import ImageIO
import Synchronization
import Testing
import UniformTypeIdentifiers

@testable import LexidrawKit

private final class MeasurementTokenStore: TokenStore, @unchecked Sendable {
  private let token = Mutex<String?>(nil)
  func load() throws -> String? { token.withLock { $0 } }
  func save(_ value: String) throws { token.withLock { $0 = value } }
  func delete() throws { token.withLock { $0 = nil } }
}

private final class MeasurementImageProtocol: URLProtocol, @unchecked Sendable {
  private struct State: Sendable {
    var response = Data()
    var requests: [URLRequest] = []
  }
  private static let state = Mutex(State())
  static func prepare(_ response: Data) {
    state.withLock { $0 = State(response: response) }
  }
  static var requests: [URLRequest] { state.withLock { $0.requests } }
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    let body = Self.state.withLock {
      $0.requests.append(request)
      return $0.response
    }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 200, httpVersion: nil,
      headerFields: ["Content-Type": "application/json"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: body)
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

// Manual observation only: exact filter NativeBYOKPerformanceMeasurements.e3SyntheticImageRequestToDecodedArtifact.
// Normal test runs skip this unless LEXIDRAW_E3_SYNTHETIC_MEASUREMENT=1 is explicitly supplied.
@Suite @MainActor struct NativeBYOKPerformanceMeasurements {
  @Test(.enabled(if: ProcessInfo.processInfo.environment["LEXIDRAW_E3_SYNTHETIC_MEASUREMENT"] == "1"))
  func e3SyntheticImageRequestToDecodedArtifact() async throws {
    let baseline = ProcessInfo.processInfo.environment["LEXIDRAW_E3_FIXTURE"] == "baseline"
    let fixture = try baseline
      ? Data(contentsOf: #require(Bundle.module.url(forResource: "generated-image", withExtension: "png", subdirectory: "Fixtures")))
      : representativePNG()
    let response = Data("{\"data\":[{\"media_type\":\"image/png\",\"b64_json\":\"\(fixture.base64EncodedString())\"}]}".utf8)
    #expect(fixture.count <= 2 << 20)
    #expect(response.count <= 2_800_000)
    print("E3_FIXTURE kind=\(baseline ? "baseline" : "near-bound") png_bytes=\(fixture.count) response_bytes=\(response.count) dimensions=1024x1024 repetitions=3")
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [MeasurementImageProtocol.self]
    let syntheticTokenStore = MeasurementTokenStore()
    let runtime = NativeBYOK(store: syntheticTokenStore, configuration: config, imageFixture: true)
    try runtime.replaceKey("sk-or-v1-e3-synthetic-image-measurement")
    defer { try? runtime.endSession() }
    let clock = ContinuousClock()
    for repetition in 1...3 {
      MeasurementImageProtocol.prepare(response)
      let start = clock.now
      let artifact: NativeImageArtifact
      do {
        artifact = try await runtime.generateImage(prompt: "A synthetic colorful landscape")
      } catch {
        print("E3_INVALID_ATTEMPT repetition=\(repetition) elapsed=\(start.duration(to: clock.now)) intercepted_requests=\(MeasurementImageProtocol.requests.count) no_returned_artifact=true")
        throw error
      }
      let elapsed = start.duration(to: clock.now)
      let result = artifact.bytes
      try #require(result == fixture)
      try #require(artifact.width == 1024 && artifact.height == 1024)
      try #require(artifact.mimeType == "image/png")
      let requests = MeasurementImageProtocol.requests
      try #require(requests.count == 1)
      let request = try #require(requests.first)
      try #require(request.url?.absoluteString == "https://openrouter.ai/api/v1/images")
      try #require(request.httpMethod == "POST")
      let seconds = Double(elapsed.components.seconds) + Double(elapsed.components.attoseconds) / 1e18
      print("E3_MEASUREMENT repetition=\(repetition) seconds=\(seconds) response_bytes=\(response.count) result_bytes=\(result.count) valid=true intercepted_requests=\(requests.count)")
    }
  }

  private func representativePNG() throws -> Data {
    // Fixed pixel noise in part of a real 1024px RGB image keeps PNG/JSON near the existing bound.
    // Construction/encoding happens before timing; no response padding or standalone byte-loop proxy.
    var pixels = [UInt8](repeating: 0, count: 1024 * 1024 * 3)
    var seed: UInt32 = 0x276291E3
    for index in 0..<(1024 * 674 * 3) {
      seed ^= seed << 13
      seed ^= seed >> 17
      seed ^= seed << 5
      pixels[index] = UInt8(truncatingIfNeeded: seed)
    }
    let provider = try #require(CGDataProvider(data: Data(pixels) as CFData))
    let image = try #require(CGImage(
      width: 1024, height: 1024, bitsPerComponent: 8, bitsPerPixel: 24,
      bytesPerRow: 1024 * 3, space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
      provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent))
    let output = NSMutableData()
    let destination = try #require(CGImageDestinationCreateWithData(output, UTType.png.identifier as CFString, 1, nil))
    CGImageDestinationAddImage(destination, image, nil)
    try #require(CGImageDestinationFinalize(destination))
    return output as Data
  }
}
