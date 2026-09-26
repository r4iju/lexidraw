import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import Synchronization
import Testing

/// The server at the transport seam: each request is recorded, and answered by
/// whatever the test says, a thrown error standing for a network that is down.
final class FakeServer: ClientTransport, Sendable {
  struct Request: Sendable {
    let method: HTTPRequest.Method
    let url: URLComponents
    let authorization: String?
    let body: Data?

    var json: [String: String] {
      (try? JSONSerialization.jsonObject(with: body ?? Data()) as? [String: String]) ?? [:]
    }

    /// The body's keys, for telling a field sent as null from one left out.
    var keys: Set<String> {
      Set(((try? JSONSerialization.jsonObject(with: body ?? Data())) as? [String: Any] ?? [:]).keys)
    }
  }

  typealias Answer = @Sendable (Request) throws -> (status: Int, body: String)

  private let answer: Answer
  private let recorded = Mutex<[Request]>([])

  init(answer: @escaping Answer) {
    self.answer = answer
  }

  var requests: [Request] { recorded.withLock { $0 } }

  func send(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String
  ) async throws -> (HTTPResponse, HTTPBody?) {
    let data: Data? = if let body { try await Data(collecting: body, upTo: 1 << 20) } else { nil }
    let url = URLComponents(string: baseURL.absoluteString + (request.path ?? ""))!
    let seen = Request(
      method: request.method,
      url: url,
      authorization: request.headerFields[.authorization],
      body: data
    )
    recorded.withLock { $0.append(seen) }
    let (status, text) = try answer(seen)
    var response = HTTPResponse(status: .init(code: status))
    response.headerFields[.contentType] = "application/json"
    return (response, HTTPBody(text))
  }
}

final class InMemoryTokenStore: TokenStore {
  private let stored: Mutex<String?>

  init(_ token: String? = nil) {
    stored = Mutex(token)
  }

  var token: String? { stored.withLock { $0 } }

  func load() throws -> String? { token }
  func save(_ token: String) throws { stored.withLock { $0 = token } }
  func delete() throws { stored.withLock { $0 = nil } }
}

/// A Keychain that will not take the token, as when the app lacks the entitlement.
struct UnwritableTokenStore: TokenStore {
  struct Refused: Error {}

  func load() throws -> String? { nil }
  func save(_ token: String) throws { throw Refused() }
  func delete() throws {}
}

extension URLComponents {
  subscript(query name: String) -> String? {
    queryItems?.first { $0.name == name }?.value
  }
}

/// The server every test talks to, and what it says back.
enum TestServer {
  static let origin = URL(string: "https://lexidraw.test")!
  static let issuedToken = #"{"token":"lxd_new","name":"iPhone","scope":"write"}"#

  static func account(_ store: any TokenStore, _ server: FakeServer) -> Account {
    Account(origin: origin, store: store, transport: server)
  }

  /// Signed in already, with a token kept from an earlier launch.
  static func session(_ server: FakeServer, store: any TokenStore = InMemoryTokenStore("lxd_kept")) throws -> Session {
    try #require(try account(store, server).restore())
  }
}

enum Fixtures {
  static func text(_ name: String) throws -> String {
    let url = Bundle.module.url(forResource: "Fixtures/\(name)", withExtension: nil)!
    return try String(contentsOf: url, encoding: .utf8)
  }
}
