import Foundation
import LexidrawKit
import Testing

@Suite struct LocalNarrationTests {
  @Test func localListenReadsTheDocumentWithoutGeneratingOrTouchingCloudAudio() async throws {
    let state =
      #"{"root":{"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":"Quarterly numbers."}]}]}}"#
    let server = FakeServer { request in
      if request.url.path == "/api/trpc/auth.getPowerPreference" {
        return (200, #"{"result":{"data":{"json":{"mode":"local"}}}}"#)
      }
      return (
        200,
        DocumentTests.loaded(
          elements: try String(decoding: JSONEncoder().encode(state), as: UTF8.self))
      )
    }
    let source = try await TestServer.session(server).narration(of: "n1")
    guard case .local(let narration) = source else {
      Issue.record("Expected free local narration")
      return
    }
    #expect(narration.parts == ["Quarterly numbers."])
    #expect(server.requests.map(\.method) == [.get, .get])
    #expect(
      server.requests.map(\.url.path) == [
        "/api/trpc/auth.getPowerPreference", "/api/v1/entities/n1",
      ])
  }
  @Test func reopenedLocalSpeechKeepsItsPositionWithoutChangingSavedAudioPosition() throws {
    let narration = try LocalNarration(text: "Quarterly numbers.\nThey went up.", language: "en")
    let suite = "local-narration-\(UUID())"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let points = ResumePoints(defaults: defaults)
    points.keep(.init(part: 1, seconds: 7), of: "doc-1")
    points.keep(.init(part: 0, seconds: 2), of: narration.resumeID(file: "doc-1"))
    let reopened = try LocalNarration(text: "Quarterly numbers.\nThey went up.", language: "en")
    #expect(points.position(of: reopened.resumeID(file: "doc-1")) == .init(part: 0, seconds: 2))
    #expect(points.position(of: "doc-1") == .init(part: 1, seconds: 7))
    let edited = try LocalNarration(text: "Changed text.", language: "en")
    #expect(points.position(of: edited.resumeID(file: "doc-1")) == nil)
  }

  @Test func localListenExplainsUnsupportedLinksWithoutFallingBackToCloud() async throws {
    let server = FakeServer { request in
      if request.url.path == "/api/trpc/auth.getPowerPreference" {
        return (200, #"{"result":{"data":{"json":{"mode":"local"}}}}"#)
      }
      return (
        200,
        DocumentTests.loaded(elements: #""{\"url\":\"https://example.com\"}""#)
          .replacingOccurrences(of: "\"entityType\":\"document\"", with: "\"entityType\":\"url\"")
      )
    }
    await #expect(
      throws: ListenFailed(
        message:
          "Built-in narration reads documents. For a saved link, choose Play Saved Recording.")
    ) {
      try await TestServer.session(server).narration(of: "n1")
    }
    #expect(server.requests.map(\.method) == [.get, .get])
  }

}
