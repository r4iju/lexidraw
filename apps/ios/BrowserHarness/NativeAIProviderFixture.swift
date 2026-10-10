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
    guard request.url?.scheme == "https", request.url?.host == "openrouter.ai", ["/api/v1/key", "/api/v1/chat/completions"].contains(request.url?.path ?? "") else { client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return }
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
