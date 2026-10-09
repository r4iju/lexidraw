import Foundation
import Network

/// A loopback web page at the external browser boundary. The production view
/// still uses the system authentication session and its custom-scheme callback.
/// Account exchanges and secure storage use the harness's separate boundaries.
final class SignInBrowserFixture {
  static let origin = URL(string: "http://127.0.0.1:18727")!
  private let listener: NWListener?

  init() {
    guard ProcessInfo.processInfo.environment["BROWSER_SCENARIO"] == "sign-in" else {
      listener = nil
      return
    }
    do {
      let listener = try NWListener(using: .tcp, on: 18727)
      self.listener = listener
      listener.newConnectionHandler = { connection in
        connection.start(queue: .main)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { data, _, _, _ in
          guard data != nil else { connection.cancel(); return }
          let page = """
            <!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
            <body><h1>Sign-in fixture</h1><p>This local page exercises the system browser callback.</p>
            <a href="lexidraw://auth/callback?code=fixture-code">Return to Lexidraw</a></body></html>
            """
          let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(page.utf8.count)\r\nConnection: close\r\n\r\n\(page)"
          connection.send(content: Data(response.utf8), completion: .contentProcessed { _ in connection.cancel() })
        }
      }
      listener.start(queue: .main)
    } catch {
      // A failed fixture must leave the real browser unable to complete.
      listener = nil
    }
  }

  deinit { listener?.cancel() }
}
