import Foundation
import LexidrawJSON
import Testing

@testable import LexidrawKit

@Suite struct DocumentTests {
  static func loaded(elements: String, access: String = "EDIT") -> String {
    """
    {"id":"n1","title":"Notes","entityType":"document","appState":null,
     "elements":\(elements),"publicAccess":"PRIVATE","shared":false,"accessLevel":"\(access)",
     "updatedAt":"2026-09-25T09:30:00.123Z"}
    """
  }

  /// The editor state comes as the JSON it was stored as, nodes this app
  /// doesn't know included, so the editor can keep them.
  @Test func opensADocumentWithItsEditorStateAsStored() async throws {
    let state =
      #"{"root":{"children":[{"type":"poll","question":"Lunch?","version":1}],"direction":null,"format":"","#
      + #""indent":0,"type":"root","version":1}}"#
    let server = FakeServer { _ in
      (200, Self.loaded(elements: try String(data: JSONEncoder().encode(state), encoding: .utf8)!))
    }
    let session = try TestServer.session(server)

    let document = try await session.document("n1")

    #expect(document.title == "Notes")
    #expect(document.access == .edit)
    #expect(document.state.stringified == state)
    #expect(try #require(server.requests.only).url.path == "/api/v1/entities/n1")
  }

  /// Shared with the caller to read, it opens read-only.
  @Test func aDocumentSharedToReadIsReadOnly() async throws {
    let server = FakeServer { _ in (200, Self.loaded(elements: #""{\"root\":{}}""#, access: "READ")) }
    let session = try TestServer.session(server)

    #expect(try await session.document("n1").access == .read)
  }
}
