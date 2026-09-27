import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import SwiftUI

/// The app's document screen on `tracer.json`, served with the access
/// `EDITOR_PREVIEW_ACCESS` names (`EDIT` or `READ`) by a server that
/// answers nothing else.
struct DocumentPreview: View {
  @State private var session: Result<Session, any Error>

  init(access: String) {
    let account = Account(
      origin: URL(string: "https://harness.invalid")!, store: PreviewToken(), transport: PreviewServer(access: access))
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
    case .failure(let error):
      ContentUnavailableView(
        "Couldn't sign in", systemImage: "exclamationmark.triangle", description: Text(String(describing: error)))
    }
  }
}

private struct PreviewServer: ClientTransport {
  static let documentId = "tracer"
  let access: String

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?)
  {
    guard operationID == "entities-load" else { return (HTTPResponse(status: .notFound), nil) }
    let url = Bundle.main.url(forResource: "tracer", withExtension: "json")!
    let loaded: [String: Any] = [
      "id": Self.documentId, "title": "Tracer", "entityType": "document", "appState": NSNull(),
      "elements": String(decoding: try Data(contentsOf: url), as: UTF8.self), "publicAccess": "PRIVATE",
      "shared": false, "accessLevel": access, "updatedAt": "2026-09-25T09:30:00.000Z",
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
