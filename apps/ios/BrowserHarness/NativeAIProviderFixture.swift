import Foundation
import Synchronization

/// Paid-provider traffic is intercepted in the harness, including validation.
/// The production app never includes this fixture.
final class NativeAIProviderFixture: URLProtocol, @unchecked Sendable {
  private let stopped = Mutex(false)
  override class func canInit(with request: URLRequest) -> Bool {
    true
  }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    guard request.url?.scheme == "https", request.url?.host == "openrouter.ai",
      ["/api/v1/key", "/api/v1/chat/completions", "/api/v1/images", "/api/v1/audio/speech"]
        .contains(request.url?.path ?? "")
    else {
      client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
      return
    }
    if request.value(forHTTPHeaderField: "Authorization") == "Bearer opaque-native-agent-fixture-288" {
      var body = request.httpBody
      if body == nil, let stream = request.httpBodyStream {
        stream.open(); defer { stream.close() }
        var bytes = Data(), buffer = [UInt8](repeating: 0, count: 1024)
        while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; bytes.append(contentsOf: buffer.prefix(count)); if bytes.count > 16_384 { break } }
        body = bytes
      }
      guard request.url?.path == "/api/v1/chat/completions", let body,
        let parsed = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
        let messages = parsed["messages"] as? [[String: String]], let url = request.url else {
        client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
      }
      let prompt = messages.last?["content"] ?? ""
      let output = messages.first?["content"]?.contains("Plan the requested") == true ? #"{"edits":["Save native fixture paragraph"]}"# : prompt.contains("Native device action saved this paragraph.") ? #"{"kind":"done"}"# : #"{"kind":"append","text":"Native device action saved this paragraph."}"#
      let data = try! JSONSerialization.data(withJSONObject: ["choices": [["message": ["content": output]]]])
      client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self); return
    }
    if request.url?.path == "/api/v1/audio/speech" {
      guard
        request.value(forHTTPHeaderField: "Authorization")
          == "Bearer sk-or-v1-286-native-narration-fixture", let url = request.url
      else {
        client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
        return
      }
      DispatchQueue.global().asyncAfter(deadline: .now() + 1) { [self] in
        guard !stopped.withLock({ $0 }) else { return }
        let response = HTTPURLResponse(
          url: url, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "audio/pcm"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(repeating: 0, count: 480000))
        client?.urlProtocolDidFinishLoading(self)
      }
      return
    }
    if request.url?.path == "/api/v1/images" {
      guard
        request.value(forHTTPHeaderField: "Authorization")
          == "Bearer sk-or-v1-284-native-image-fixture",
        let file = Bundle.main.url(
          forResource: "generated-image", withExtension: "bin", subdirectory: "Fixtures")
          ?? Bundle.main.url(forResource: "generated-image", withExtension: "bin"),
        let image = try? Data(contentsOf: file), let url = request.url
      else {
        client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
        return
      }
      let data = Data(
        "{\"data\":[{\"media_type\":\"image/png\",\"b64_json\":\"\(image.base64EncodedString())\"}]}"
          .utf8)
      let response = HTTPURLResponse(
        url: url, statusCode: 200, httpVersion: nil,
        headerFields: ["Content-Type": "application/json"])!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
      return
    }
    let validation = request.url?.path == "/api/v1/key"
    let delay = validation ? 0.0 : 6.0
    DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [self] in
      guard !stopped.withLock({ $0 }), let url = request.url else { return }
      let data =
        validation
        ? #"{"data":{"is_free_tier":false,"is_management_key":false,"limit_remaining":10}}"#
        : #"{"choices":[{"message":{"content":"sentence."}}]}"#
      let response = HTTPURLResponse(
        url: url, statusCode: 200, httpVersion: nil,
        headerFields: ["Content-Type": "application/json"])!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: Data(data.utf8))
      client?.urlProtocolDidFinishLoading(self)
    }
  }
  override func stopLoading() { stopped.withLock { $0 = true } }
}
