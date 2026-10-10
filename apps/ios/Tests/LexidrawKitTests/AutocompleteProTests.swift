import Foundation
import Testing
import Synchronization

@testable import LexidrawKit

struct AutocompleteProTests {
  @Test func authenticatedSuggestionUsesBoundedTrustedOperationAndFractionalResult() async throws {
    let server = FakeServer { request in
      #expect(request.url.path == "/api/trpc/pro.autocomplete")
      #expect(request.authorization == "Bearer lxd_kept")
      return (
        200,
        #"{"result":{"data":{"json":{"id":"suggestion","state":"settled","result":" world.","charged":31000,"feature":"autocomplete"}}}}"#
      )
    }
    let session = try TestServer.session(server)
    let result = try await session.autocompletePro(title: "", before: "Hello", after: "")
    #expect(result == " world.")
    #expect(server.requests.count == 1)
  }
  @Test func uncertainSuggestionRemainsReservedWithoutRegenerating() async throws {
    let server = FakeServer { request in
      #expect(request.url.path == "/api/trpc/pro.autocomplete")
      return (
        200,
        #"{"result":{"data":{"json":{"id":"suggestion","state":"unknown","result":null,"charged":0,"feature":"autocomplete"}}}}"#
      )
    }
    let session = try TestServer.session(server)
    await #expect(throws: AutocompleteProError.reconciling) {
      try await session.autocompletePro(title: "", before: "Hello", after: "")
    }
    #expect(server.requests.count == 1)
  }
  @Test func cancellationDuringSubmissionReleasesDurableOperationBeforeReturning() async throws {
    let server = FakeServer { request in
      if request.url.path == "/api/trpc/pro.autocomplete" {
        Thread.sleep(forTimeInterval: 0.1)
        return (
          200,
          #"{"result":{"data":{"json":{"id":"durable-suggestion","state":"reserved","result":null}}}}"#
        )
      }
      #expect(request.url.path == "/api/trpc/pro.cancel")
      #expect((request.object["json"] as? [String: String])?["id"] == "durable-suggestion")
      return (
        200,
        #"{"result":{"data":{"json":{"id":"durable-suggestion","state":"cancelled","result":null}}}}"#
      )
    }
    let session = try TestServer.session(server)
    let work = Task { try await session.autocompletePro(title: "", before: "Hello", after: "") }
    try await Task.sleep(for: .milliseconds(20))
    work.cancel()
    await #expect(throws: CancellationError.self) { try await work.value }
    #expect(
      server.requests.map { $0.url.path } == ["/api/trpc/pro.autocomplete", "/api/trpc/pro.cancel"])
  }

}

extension AutocompleteProTests {
  @Test func lostAcceptanceReplyRecoversOnlyTheSameSuggestionKey() async throws {
    let keys = Synchronization.Mutex<[String]>([])
    let server = FakeServer { request in
      #expect(request.url.path == "/api/trpc/pro.autocomplete")
      let key = (request.object["json"] as? [String: String])?["idempotencyKey"] ?? "missing"
      let count = keys.withLock { $0.append(key); return $0.count }
      if count == 1 { throw URLError(.networkConnectionLost) }
      return (200, #"{"result":{"data":{"json":{"id":"accepted","state":"settled","result":" owned paid output"}}}}"#)
    }
    let session = try TestServer.session(server)
    let result = try await session.autocompletePro(title: "", before: "Hello", after: "")
    #expect(result == " owned paid output")
    #expect(keys.withLock { $0.count == 2 && Set($0).count == 1 })
  }
  @Test func cancellationAfterLostAcceptanceReplyRecoversIdentityBeforeCancelling() async throws {
    let keys = Synchronization.Mutex<[String]>([])
    let server = FakeServer { request in
      if request.url.path == "/api/trpc/pro.autocomplete" {
        let key = (request.object["json"] as? [String: String])?["idempotencyKey"] ?? "missing"
        let count = keys.withLock { $0.append(key); return $0.count }
        if count == 1 { Thread.sleep(forTimeInterval: 0.1); throw URLError(.networkConnectionLost) }
        return (200, #"{"result":{"data":{"json":{"id":"accepted","state":"reserved","result":null}}}}"#)
      }
      #expect(request.url.path == "/api/trpc/pro.cancel")
      #expect((request.object["json"] as? [String: String])?["id"] == "accepted")
      return (200, #"{"result":{"data":{"json":{"id":"accepted","state":"cancelled","result":null}}}}"#)
    }
    let session = try TestServer.session(server)
    let work = Task { try await session.autocompletePro(title: "", before: "Hello", after: "") }
    try await Task.sleep(for: .milliseconds(20))
    work.cancel()
    await #expect(throws: CancellationError.self) { try await work.value }
    #expect(keys.withLock { $0.count == 2 && Set($0).count == 1 })
    #expect(server.requests.last?.url.path == "/api/trpc/pro.cancel")
  }
  @Test func repeatedLostRepliesCannotCreateFreshKeyForChangedEditorInput() async throws {
    let keys = Synchronization.Mutex<[String]>([])
    let server = FakeServer { request in
      if request.url.path == "/api/trpc/pro.autocomplete" {
        let key = (request.object["json"] as? [String: String])?["idempotencyKey"] ?? "missing"
        let count = keys.withLock { $0.append(key); return $0.count }
        if count <= 2 { throw URLError(.networkConnectionLost) }
        return (200, #"{"result":{"data":{"json":{"id":"accepted","state":"unknown","result":null}}}}"#)
      }
      throw URLError(.unsupportedURL)
    }
    let session = try TestServer.session(server)
    await #expect(throws: AutocompleteProError.reconciling) { try await session.autocompletePro(title: "", before: "Hello", after: "") }
    await #expect(throws: AutocompleteProError.reconciling) { try await session.autocompletePro(title: "", before: "Different document context", after: "") }
    #expect(keys.withLock { $0.count == 3 && Set($0).count == 1 })
  }
}
