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
    var deliveredByteCount = 0
  }
  private static let state = Mutex(State())
  static func prepare(_ response: Data) {
    state.withLock { $0 = State(response: response) }
  }
  static var requests: [URLRequest] { state.withLock { $0.requests } }
  static var deliveredByteCount: Int { state.withLock { $0.deliveredByteCount } }
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
    Self.state.withLock { $0.deliveredByteCount += body.count }
    client?.urlProtocolDidFinishLoading(self)
  }
  override func stopLoading() {}
}

// Manual observation only: exact filter NativeBYOKPerformanceMeasurements.e3SyntheticImageRequestToDecodedArtifact.
// Normal test runs skip this unless LEXIDRAW_E3_SYNTHETIC_MEASUREMENT=1 is explicitly supplied.
@Suite @MainActor struct NativeBYOKPerformanceMeasurements {
  @Test(.enabled(if: ProcessInfo.processInfo.environment["LEXIDRAW_E3_SYNTHETIC_MEASUREMENT"] == "1"))
  func e3SyntheticImageRequestToDecodedArtifact() async throws {
    let evidenceDirectory = URL(fileURLWithPath:
      "/Users/emanuel/.ai/working/lexidraw-276-recovery/evidence/native-measurement-v1",
      isDirectory: true)
    let clock = ContinuousClock()
    var stage = "fixture_eligibility"
    var errorDescription = "none"
    var valid = false
    var pngBytes = 0
    var responseBytes = 0
    var resultBytes = 0
    var callStart: ContinuousClock.Instant?
    var artifactElapsed: Duration?
    var elapsedToError: Duration?
    MeasurementImageProtocol.prepare(Data())
    defer {
      let requests = MeasurementImageProtocol.requests
      for (index, request) in requests.enumerated() {
        print("E3_CAPTURE index=\(index + 1) url=\(request.url?.absoluteString ?? "nil") method=\(request.httpMethod ?? "nil")")
      }
      let artifactSeconds = valid ? artifactElapsed.map { String(seconds($0)) } ?? "none" : "none"
      let errorSeconds = elapsedToError.map { String(seconds($0)) } ?? "none"
      print("E3_TERMINAL stage=\(stage) valid=\(valid) planned_calls=1 intercepted_requests=\(requests.count) delivered_bytes=\(MeasurementImageProtocol.deliveredByteCount) png_bytes=\(pngBytes) response_bytes=\(responseBytes) result_bytes=\(resultBytes) artifact_seconds=\(artifactSeconds) elapsed_to_error_seconds=\(errorSeconds) error=\(errorDescription)")
    }
    do {
      let baseline = ProcessInfo.processInfo.environment["LEXIDRAW_E3_FIXTURE"] == "baseline"
      let fixture = try baseline
        ? Data(contentsOf: #require(Bundle.module.url(forResource: "generated-image", withExtension: "png", subdirectory: "Fixtures")))
        : representativePNG()
      let response = Data("{\"data\":[{\"media_type\":\"image/png\",\"b64_json\":\"\(fixture.base64EncodedString())\"}]}".utf8)
      pngBytes = fixture.count
      responseBytes = response.count
      try await withEligibleMeasurement(fixture: fixture, response: response) {
        let source = try #require(CGImageSourceCreateWithData(fixture as CFData, nil))
        try #require(CGImageSourceGetType(source) as String? == UTType.png.identifier)
        try #require(CGImageSourceGetCount(source) == 1)
        let image = try #require(CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary))
        try #require(image.width == 1024 && image.height == 1024)
        try fixture.write(to: evidenceDirectory.appendingPathComponent("source.png"))
        print("E3_PREFLIGHT type=png frames=1 dimensions=1024x1024 valid=true png_bytes=\(fixture.count)")
        print("E3_FIXTURE kind=\(baseline ? "baseline" : "near-bound") png_bytes=\(fixture.count) response_bytes=\(response.count) dimensions=1024x1024 repetitions=1")
        stage = "runtime_setup"
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MeasurementImageProtocol.self]
        let syntheticTokenStore = MeasurementTokenStore()
        let runtime = NativeBYOK(store: syntheticTokenStore, configuration: config, imageFixture: true)
        try runtime.replaceKey("sk-or-v1-e3-synthetic-image-measurement")
        defer { try? runtime.endSession() }
        MeasurementImageProtocol.prepare(response)
        stage = "public_call"
        let start = clock.now
        callStart = start
        let artifact: NativeImageArtifact
        do {
          artifact = try await runtime.generateImage(prompt: "A synthetic colorful landscape")
        } catch {
          elapsedToError = start.duration(to: clock.now)
          stage = "public_call_thrown"
          throw error
        }
        artifactElapsed = start.duration(to: clock.now)
        stage = "returned_artifact_validation"
        let result = artifact.bytes
        resultBytes = result.count
        try #require(result == fixture)
        try #require(artifact.width == 1024 && artifact.height == 1024)
        try #require(artifact.mimeType == "image/png")
        let requests = MeasurementImageProtocol.requests
        try #require(requests.count == 1)
        let request = try #require(requests.first)
        try #require(request.url?.absoluteString == "https://openrouter.ai/api/v1/images")
        try #require(request.httpMethod == "POST")
        try #require(MeasurementImageProtocol.deliveredByteCount == response.count)
        try result.write(to: evidenceDirectory.appendingPathComponent("returned.png"))
        stage = "success"
        valid = true
        print("E3_MEASUREMENT repetition=1 seconds=\(seconds(try #require(artifactElapsed))) response_bytes=\(response.count) result_bytes=\(result.count) valid=true intercepted_requests=\(requests.count)")
      }
    } catch {
      if elapsedToError == nil, let callStart {
        elapsedToError = callStart.duration(to: clock.now)
      }
      errorDescription = String(describing: error)
      throw error
    }
  }

  private func seconds(_ duration: Duration) -> Double {
    Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18
  }

  @Test func eligibilityRefusesOverboundResponseBeforeCall() async throws {
    var calls = 0
    var validEmissions = 0
    await withKnownIssue("Overbound response must be rejected") {
      try await withEligibleMeasurement(fixture: Data(), response: Data(repeating: 0, count: 2_800_001)) {
        calls += 1
        validEmissions += 1
      }
    }
    #expect(calls == 0)
    #expect(validEmissions == 0)
  }

  private func withEligibleMeasurement(
    fixture: Data, response: Data, operation: () async throws -> Void
  ) async throws {
    try #require(fixture.count <= 2_097_152)
    try #require(response.count < 2_800_000)
    try await operation()
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
