import Foundation
import HTTPTypes
import LexidrawKit
import OpenAPIRuntime
import SwiftUI

/// The drawing editor on a bundled drawing, with no server, for trying the
/// editor and for the UI tests. Saves are kept in memory.
@main
struct HarnessApp: App {
  var body: some Scene {
    WindowGroup {
      NavigationStack { HarnessView() }
    }
  }
}

struct HarnessView: View {
  @State private var opened: Result<(Session, StoredDrawing), any Error>?

  var body: some View {
    switch opened {
    case .success(let (session, drawing)):
      DrawingEditorScreen(session: session, drawing: drawing, theme: .light) {}
        .navigationTitle(drawing.title)
        .navigationBarTitleDisplayMode(.inline)
    case .failure(let error):
      ContentUnavailableView(
        "Couldn't open the drawing", systemImage: "exclamationmark.triangle",
        description: Text(String(describing: error)))
    case nil:
      ProgressView().task {
        let account = Account(
          origin: URL(string: "https://harness.invalid")!, store: HarnessToken(), transport: HarnessServer())
        do {
          guard let session = try account.restore() else { throw URLError(.userAuthenticationRequired) }
          opened = .success((session, try await session.drawing(HarnessServer.drawingId)))
        } catch {
          opened = .failure(error)
        }
      }
    }
  }
}

/// The server's answers for one drawing: `drawing.json`'s elements, and
/// every save taken.
struct HarnessServer: ClientTransport {
  static let drawingId = "harness"

  func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws
    -> (HTTPResponse, HTTPBody?)
  {
    let answer: String
    switch operationID {
    case "entities-load":
      let url = Bundle.main.url(forResource: "drawing", withExtension: "json")!
      let elements = String(decoding: try Data(contentsOf: url), as: UTF8.self)
      let loaded: [String: Any] = [
        "id": Self.drawingId, "title": "Harness", "entityType": "drawing", "appState": NSNull(),
        "elements": elements, "publicAccess": "PRIVATE", "shared": false, "accessLevel": "EDIT",
        "updatedAt": "2026-09-25T09:30:00.000Z",
      ]
      answer = String(decoding: try JSONSerialization.data(withJSONObject: loaded), as: UTF8.self)
    case "entities-save":
      let now = Date().ISO8601Format(.iso8601.year().month().day().time(includingFractionalSeconds: true))
      answer = #"{"id":"\#(Self.drawingId)","updatedAt":"\#(now)Z"}"#
    case "drawings-files":
      answer = #"{"files":[]}"#
    default:
      return (HTTPResponse(status: .notFound), nil)
    }
    var response = HTTPResponse(status: .ok)
    response.headerFields[.contentType] = "application/json"
    return (response, HTTPBody(answer))
  }
}

/// Signed in, as far as the editor can tell.
struct HarnessToken: TokenStore {
  func load() throws -> String? { "harness" }
  func save(_ token: String) throws {}
  func delete() throws {}
}
