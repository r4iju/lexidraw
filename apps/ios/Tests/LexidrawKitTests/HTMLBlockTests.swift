import Foundation
import Testing

@testable import LexidrawKit

@Suite struct HTMLBlockSessionTests {
  @Test func browserHandoffHasOnlyDocumentAndBlockIdentity() throws {
    let session = try TestServer.session(FakeServer { _ in (200, "{}") })
    let url = session.htmlBlockLink(
      documentID: "document-one", blockID: "10000000-0000-4000-8000-000000000001")
    #expect(url.path == "/documents/document-one")
    #expect(url.fragment == "html-block-10000000-0000-4000-8000-000000000001")
    #expect(url.query == nil)
  }
  @Test func aStaleSnapshotIsRefused() async throws {
    let server = FakeServer { _ in
      (
        200,
        #"{"status":"ready","revision":"older","data":"iVBORw0KGgo=","width":800,"height":360}"#
      )
    }
    let session = try TestServer.session(server)
    await #expect(throws: Refusal.self) {
      try await session.htmlBlockPreview(
        documentID: "d", blockID: "10000000-0000-4000-8000-000000000001", revision: "latest")
    }
  }
}
