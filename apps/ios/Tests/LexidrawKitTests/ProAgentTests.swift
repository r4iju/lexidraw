import Foundation
import Testing
@testable import LexidrawKit
@Suite("Bounded Pro document actions")
struct ProAgentTests {
 @Test func authenticatedActionReportsSavedAndIncompleteEdits() async throws {
  let server=FakeServer { request in
   #expect(request.url.path == "/api/trpc/agentPower.start")
   return (200,#"{"result":{"data":{"json":{"operation":{"id":"one","state":"refunded","charged":0,"quote":26629334},"report":{"status":"partial","completed":[{"revision":2,"description":"Saved paragraph"}],"incomplete":["Missing image"],"reason":"Image unavailable"}}}}}"#)
  }
  let session=try TestServer.session(server)
  let result=try await session.startProAgent(document:"doc",revision:1,prompt:"Add a paragraph",id:"one",maximum:26_629_334)
  #expect(result.report.completed.first?.description == "Saved paragraph")
  #expect(result.report.incomplete == ["Missing image"])
  #expect(result.operation.charged == 0)
  #expect(server.requests.first?.authorization == "Bearer lxd_kept")
 }
}

extension ProAgentTests {
 @Test func reopeningUsesAuthenticatedServerOwnedActionIdentity() async throws {
  let server=FakeServer { request in
   #expect(request.url.path == "/api/trpc/agentPower.current")
   #expect(request.url.query?.contains("documentId") == true)
   return (200,#"{"result":{"data":{"json":{"operation":{"id":"durable","state":"unknown","charged":0,"quote":26629334},"report":{"status":"reconciling","completed":[],"incomplete":["Save paragraph"],"reason":"Paid outcome held"}}}}}"#)
  }
  let session=try TestServer.session(server)
  let result=try await session.currentProAgent(document:"doc")
  #expect(result?.operation.id == "durable")
  #expect(server.requests.first?.authorization == "Bearer lxd_kept")
 }
}
