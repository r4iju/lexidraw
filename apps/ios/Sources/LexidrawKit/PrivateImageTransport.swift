import Foundation
import OpenAPIRuntime
import OpenAPIURLSession
private final class NoImageRedirects: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(_ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) { completionHandler(nil) }
}
func privateImageTransport() -> any ClientTransport {
  let config = URLSessionConfiguration.ephemeral
  config.httpCookieStorage = nil
  config.httpShouldSetCookies = false
  config.urlCache = nil
  config.requestCachePolicy = .reloadIgnoringLocalCacheData
  config.timeoutIntervalForRequest = 15
  config.timeoutIntervalForResource = 15
  return URLSessionTransport(configuration: .init(session: URLSession(configuration: config, delegate: NoImageRedirects(), delegateQueue: nil)))
}
