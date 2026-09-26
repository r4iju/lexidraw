import Foundation
import HTTPTypes
import OpenAPIRuntime
import OpenAPIURLSession

public enum SignInError: Error, Equatable {
  /// The browser came back without a code, so there was nothing to trade.
  case noCode
  /// The server would not trade the code: spent, expired, or not this app's.
  case refused
  case unexpectedResponse
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

    let answer = try await client(token: nil).nativeSignInExchange(
      body: .json(.init(code: code, codeVerifier: pkce.verifier, redirectUri: Self.callback.absoluteString))
    )
    switch answer {
    case .ok(let ok):
      let token = try ok.body.json.token
      do {
        try store.save(token)
      } catch {
        // Otherwise the token would stay live with no device holding it.
        _ = try? await client(token: token).tokensRevokeCurrent(body: .json(.init()))
        throw error
      }
      return session(token: token)
    case .badRequest:
      throw SignInError.refused
    default:
      throw SignInError.unexpectedResponse
    }
  }

  private func session(token: String) -> Session {
    Session(client: client(token: token), store: store)
  }

  private func client(token: String?) -> Client {
    Client(
      serverURL: origin.appending(path: "api/v1"),
      // The server writes dates with JavaScript's toISOString, milliseconds
      // and all.
      configuration: Configuration(dateTranscoder: .iso8601WithFractionalSeconds),
      transport: transport,
      middlewares: token.map { [BearerToken(token: $0)] } ?? []
    )
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
