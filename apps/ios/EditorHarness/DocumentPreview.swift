import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import SwiftUI

/// The app's document screen on `EDITOR_DOCUMENT` or `tracer.json`, served by
/// a server answering load/save/create, with the access `EDITOR_PREVIEW_ACCESS`
/// names: `EDIT` or `READ`, or a list such as `EDIT,READ` for each load in
/// turn. It shows the operations the server was asked for, and Away leaves
/// the screen so that coming back loads it again. `EDITOR_SAVE_CONFLICT=1`
/// refuses saves to the original file and permits creating a separate copy.
struct DocumentPreview: View {
  @State private var session: Result<Session, any Error>
  @State private var log = ServerLog()

  init(access: String) {
    let log = ServerLog()
    let server = PreviewServer(access: access.split(separator: ",").map(String.init), log: log)
    let account = Account(
      origin: URL(string: "https://harness.invalid")!, store: PreviewToken(), transport: server)
    _log = State(initialValue: log)
    _session = State(
      initialValue: Result {
        guard let session = try account.restore() else {
          throw URLError(.userAuthenticationRequired)
        }
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
        "Couldn't sign in", systemImage: "exclamationmark.triangle",
        description: Text(String(describing: error)))
    }
  }
}

@MainActor @Observable final class ServerLog {
  var operations: [String] = []
}

private actor PreviewServer: ClientTransport {
  static let documentId = "tracer"
  let access: [String]
  let log: ServerLog
  private var saved: [String: String] = [:]
  private var loads = 0
  private var saves = 0

  init(access: [String], log: ServerLog) {
    self.access = access
    self.log = log
  }

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?)
  {
    await MainActor.run { log.operations.append(operationID) }
    let id = request.path?.split(separator: "/").last.map(String.init) ?? Self.documentId
    if operationID == "entities-save" || operationID == "entities-create" {
      let payload: Data?
      if let body {
        payload = try await Data(collecting: body, upTo: 2 << 20)
      } else {
        payload = nil
      }
      let object =
        try payload.map { try JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? nil
      if operationID == "entities-save", id == Self.documentId,
        ProcessInfo.processInfo.environment["EDITOR_SAVE_CONFLICT"] == "1"
      {
        return try response(["message": "Newer edits"], status: .conflict)
      }
      let target = object?["id"] as? String ?? id
      saved[target] = object?["elements"] as? String
      if let path = ProcessInfo.processInfo.environment["EDITOR_SAVE_PATH"], let elements = saved[target] {
        try Data(elements.utf8).write(to: URL(fileURLWithPath: path), options: .atomic)
      }
      saves += 1
      let revision = "2026-09-25T09:31:\(String(format: "%02d", saves)).000Z"
      if operationID == "entities-create" {
        return try response([
          "id": target, "title": object?["title"] as? String ?? "Copy", "entityType": "document",
          "parentId": NSNull(), "createdAt": revision, "updatedAt": revision,
        ])
      }
      return try response(["id": target, "updatedAt": revision])
    }
    if operationID == "htmlBlocks-preview", let preview = ProcessInfo.processInfo.environment["EDITOR_HTML_BLOCK_PREVIEW"] {
      var response = HTTPResponse(status: .ok)
      response.headerFields[.contentType] = "application/json"
      return (response, HTTPBody(preview))
    }
    guard operationID == "entities-load" else { return (HTTPResponse(status: .notFound), nil) }
    loads += 1
    let elements =
      try saved[id] ?? ProcessInfo.processInfo.environment["EDITOR_DOCUMENT"]
      ?? String(
        contentsOf: Bundle.main.url(forResource: "tracer", withExtension: "json")!, encoding: .utf8)
    let loaded: [String: Any] = [
      "id": Self.documentId, "title": "Tracer", "entityType": "document", "appState": NSNull(),
      "elements": elements, "publicAccess": "PRIVATE",
      "shared": false, "accessLevel": access[min(loads, access.count) - 1],
      "updatedAt": "2026-09-25T09:30:00.000Z",
    ]
    return try response(loaded)
  }

  private func response(_ object: [String: Any], status: HTTPResponse.Status = .ok) throws -> (
    HTTPResponse, HTTPBody?
  ) {
    var response = HTTPResponse(status: status)
    response.headerFields[.contentType] = "application/json"
    return (response, HTTPBody(try JSONSerialization.data(withJSONObject: object)))
  }
}

/// Signed in, as far as the screen can tell.
private struct PreviewToken: TokenStore {
  func load() throws -> String? { "harness" }
  func save(_ token: String) throws {}
  func delete() throws {}
}
