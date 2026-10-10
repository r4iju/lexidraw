import Foundation
import Testing

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
