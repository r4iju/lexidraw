import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

public enum SignInError: Error, Equatable {
  /// The browser came back without a code, so there was nothing to trade.
  case noCode
  /// The server would not trade the code: spent, expired, or not this app's.
  case refused
}

/// What the server said when it would not do something, in its own words.
public struct Refusal: Error, LocalizedError, Sendable, Equatable {
  public let status: Int
  public let message: String

  public var errorDescription: String? { message }
}

/// The server this app talks to, and the token that lets it, when there is one.
public struct Account: Sendable {
  /// Where the server sends the browser back to; it only redirects to
  /// callbacks it allows, and this is the one it allows by default.
  public static let callback = URL(string: "lexidraw://auth/callback")!

  let origin: URL
  let store: any TokenStore
  let transport: any ClientTransport

  public init(origin: URL, store: any TokenStore, transport: any ClientTransport = URLSessionTransport()) {
    self.origin = origin
    self.store = store
    self.transport = transport
  }

  /// Signed in with the token kept from an earlier launch, if there is one.
  public func restore() throws -> Session? {
    try store.load().map(session(token:))
  }

  /// Signs in through the web's own sign-in page. `browser` opens `url` in a
  /// browser that shares the web's cookies and answers the callback URL it
  /// was sent back to.
  public func signIn(
    deviceName: String,
    browser: @Sendable (_ url: URL) async throws -> URL
  ) async throws -> Session {
    let pkce = PKCE()
    var page = URLComponents(url: origin.appending(path: "native-sign-in"), resolvingAgainstBaseURL: false)!
    page.queryItems = [
      URLQueryItem(name: "redirectUri", value: Self.callback.absoluteString),
      URLQueryItem(name: "codeChallenge", value: pkce.challenge),
      URLQueryItem(name: "codeChallengeMethod", value: "S256"),
      URLQueryItem(name: "deviceName", value: deviceName),
    ]
    let returned = try await browser(page.url!)
    guard
      let code = URLComponents(url: returned, resolvingAgainstBaseURL: false)?
        .queryItems?.first(where: { $0.name == "code" })?.value,
      !code.isEmpty
    else { throw SignInError.noCode }

    let token: String
    do {
      token = try await unwrapped {
        try await connection(token: nil).client.nativeSignInExchange(
          body: .json(.init(code: code, codeVerifier: pkce.verifier, redirectUri: Self.callback.absoluteString))
        )
      }.ok.body.json.token
    } catch let refusal as Refusal where refusal.status == 400 {
      throw SignInError.refused
    }
    do {
      try store.save(token)
    } catch {
      // Otherwise the token would stay live with no device holding it.
      _ = try? await connection(token: token).client.tokensRevokeCurrent(body: .json(.init()))
      throw error
    }
    return session(token: token)
  }

  private func session(token: String) -> Session {
    Session(connection: connection(token: token), store: store)
  }

  private func connection(token: String?) -> Connection {
    Connection(
      serverURL: origin.appending(path: "api/v1"),
      transport: transport,
      middlewares: [Refusals()] + (token.map { [BearerToken(token: $0)] } ?? [])
    )
  }
}

/// The server as this app reaches it: the generated client, and the same
/// transport and middlewares for a request the client can't make.
struct Connection: Sendable {
  let client: Client
  let serverURL: URL
  let transport: any ClientTransport
  let middlewares: [any ClientMiddleware]

  init(serverURL: URL, transport: any ClientTransport, middlewares: [any ClientMiddleware]) {
    self.serverURL = serverURL
    self.transport = transport
    self.middlewares = middlewares
    client = Client(
      serverURL: serverURL,
      // The server writes dates with JavaScript's toISOString, milliseconds
      // and all.
      configuration: Configuration(dateTranscoder: .iso8601WithFractionalSeconds),
      transport: transport,
      middlewares: middlewares
    )
  }

  /// Sends a JSON body through the middlewares, as the client would.
  func send(_ request: HTTPRequest, json: Data, operationID: String) async throws {
    var request = request
    request.headerFields[.contentType] = "application/json"
    let transport = transport
    var next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?) = {
      try await transport.send($0, body: $1, baseURL: $2, operationID: operationID)
    }
    for middleware in middlewares.reversed() {
      let inner = next
      next = { try await middleware.intercept($0, body: $1, baseURL: $2, operationID: operationID, next: inner) }
    }
    _ = try await next(request, HTTPBody(json), serverURL)
  }
}

/// A call's own error, rather than the generated client's wrapping of it.
func unwrapped<T>(_ call: () async throws -> T) async throws -> T {
  do {
    return try await call()
  } catch let error as ClientError {
    throw error.underlyingError
  }
}

/// Turns every answer that isn't a success into a ``Refusal``, so a call
/// handles only the answer it asked for.
private struct Refusals: ClientMiddleware {
  private struct Said: Decodable {
    let message: String
  }

  func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    let (response, answer) = try await next(request, body, baseURL)
    guard response.status.kind != .successful else { return (response, answer) }
    let said: Said? =
      if let answer, let data = try? await Data(collecting: answer, upTo: 1 << 16) {
        try? JSONDecoder().decode(Said.self, from: data)
      } else {
        nil
      }
    throw Refusal(
      status: response.status.code, message: said?.message ?? "The server answered \(response.status.code).")
  }
}

private struct BearerToken: ClientMiddleware {
  let token: String

  func intercept(
    _ request: HTTPRequest,
    body: HTTPBody?,
    baseURL: URL,
    operationID: String,
    next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
  ) async throws -> (HTTPResponse, HTTPBody?) {
    var request = request
    request.headerFields[.authorization] = "Bearer \(token)"
    return try await next(request, body, baseURL)
  }
}
