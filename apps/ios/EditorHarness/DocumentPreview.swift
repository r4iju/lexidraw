import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import SwiftUI

/// The app's document screen on `EDITOR_DOCUMENT` or `tracer.json`, served by
/// a server that answers nothing else, with the access `EDITOR_PREVIEW_ACCESS`
/// names: `EDIT` or `READ`, or a list such as `EDIT,READ` for each load in
/// turn. It shows the operations the server was asked for, and Away leaves
/// the screen so that coming back loads it again.
struct DocumentPreview: View {
  @State private var session: Result<Session, any Error>
  @State private var log = ServerLog()

  init(access: String) {
    let log = ServerLog()
    let server = PreviewServer(access: access.split(separator: ",").map(String.init), log: log)
    let account = Account(origin: URL(string: "https://harness.invalid")!, store: PreviewToken(), transport: server)
    _log = State(initialValue: log)
    _session = State(
      initialValue: Result {
        guard let session = try account.restore() else { throw URLError(.userAuthenticationRequired) }
        return session
      })
  }

  var body: some View {
    switch session {
    case .success(let session):
      DocumentScreen(session: session, id: PreviewServer.documentId, title: "Tracer")
        .toolbar {
          ToolbarItem { NavigationLink("Away") { Text("Away") } }
          ToolbarItem(placement: .bottomBar) {
            Text(log.operations.joined(separator: " ")).accessibilityIdentifier("server requests")
          }
        }
    case .failure(let error):
      ContentUnavailableView(
        "Couldn't sign in", systemImage: "exclamationmark.triangle", description: Text(String(describing: error)))
    }
  }
}

@MainActor @Observable final class ServerLog {
  var operations: [String] = []
}

private struct PreviewServer: ClientTransport {
  static let documentId = "tracer"
  let access: [String]
  let log: ServerLog

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?)
  {
    let loads = await MainActor.run {
      log.operations.append(operationID)
      return log.operations.count { $0 == "entities-load" }
    }
    guard operationID == "entities-load" else { return (HTTPResponse(status: .notFound), nil) }
    let elements =
      try ProcessInfo.processInfo.environment["EDITOR_DOCUMENT"]
      ?? String(contentsOf: Bundle.main.url(forResource: "tracer", withExtension: "json")!, encoding: .utf8)
    let loaded: [String: Any] = [
      "id": Self.documentId, "title": "Tracer", "entityType": "document", "appState": NSNull(),
      "elements": elements, "publicAccess": "PRIVATE",
      "shared": false, "accessLevel": access[min(loads, access.count) - 1], "updatedAt": "2026-09-25T09:30:00.000Z",
    ]
    var response = HTTPResponse(status: .ok)
    response.headerFields[.contentType] = "application/json"
    return (response, HTTPBody(try JSONSerialization.data(withJSONObject: loaded)))
  }
}

/// Signed in, as far as the screen can tell.
private struct PreviewToken: TokenStore {
  func load() throws -> String? { "harness" }
  func save(_ token: String) throws {}
  func delete() throws {}
}
