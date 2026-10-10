import Foundation
import Testing
@testable import LexidrawKit

@Suite("Authenticated Pro narration") struct ProNarrationTests {
  @Test @MainActor func quoteAcceptanceAndUncertaintyDoNotAutomaticallyRepeatPaidWork() async throws {
    let server = FakeServer { request in
      if request.url.path.hasSuffix("auth.getPowerPreference") { return (200, #"{"result":{"data":{"json":{"mode":"pro"}}}}"#) }
      if request.url.path.hasSuffix("narration.quote") {
        #expect(request.url.query?.contains("input=") == true)
        return (200, #"{"result":{"data":{"json":{"maximum":12950000,"missing":1,"cached":1,"maxSeconds":240,"revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","version":"private-narration-2026-10-v1","policy":"Uncertain outcomes remain reserved."}}}}"#)
      }
      #expect(request.url.path.hasSuffix("narration.generate"))
      return (200, #"{"result":{"data":{"json":{"id":"held","state":"unknown","charged":0,"quote":12950000,"made":0,"planned":2,"parts":[],"policy":"Uncertain outcomes remain reserved."}}}}"#)
    }
    let session = try TestServer.session(server)
    let flow = NativeNarrationFlow(session: session, document: "doc")
    await flow.review()
    #expect(server.requests.filter { $0.url.path.hasSuffix("narration.generate") }.isEmpty)
    await flow.accept()
    guard case .job(let job) = flow.state else { Issue.record("Expected held job"); return }
    #expect(job.state == "unknown")
    await flow.accept()
    #expect(server.requests.filter { $0.url.path.hasSuffix("narration.generate") }.count == 1)
    #expect(server.requests.allSatisfy { $0.authorization == "Bearer lxd_kept" })
  }
  @Test @MainActor func freeSavedPlaybackDoesNotReadEligibilityOrAskForGeneration() async throws {
    let server = FakeServer { request in
      #expect(request.url.path.hasSuffix("narration.saved"))
      return (200, #"{"result":{"data":{"json":{"id":null,"state":"saved","charged":0,"quote":0,"made":0,"planned":1,"parts":[],"policy":"Replay is free."}}}}"#)
    }
    let flow = NativeNarrationFlow(session: try TestServer.session(server), document: "doc")
    await flow.saved()
    guard case .job(let job) = flow.state else { Issue.record("Expected saved output"); return }
    #expect(job.state == "saved")
    #expect(server.requests.count == 1)
  }
}


@Suite("Period-pinned saved narration") struct SavedProNarrationTests {
  @Test @MainActor func restoreHistoricalBookWithoutGenerationOrEligibility() async throws {
    let audio = Data("RIFF".utf8) + Data(repeating: 0, count: 44)
    let server = FakeServer { request in
      if request.url.path.hasSuffix("narration.latest") {
        return (200, #"{"result":{"data":{"json":{"id":"historical"}}}}"#)
      }
      #expect(request.url.path.hasSuffix("narration.operation"))
      let job: [String: Any] = ["id": "historical", "state": "settled", "charged": 206668,
        "quote": 207200000, "made": 1, "planned": 8,
        "parts": [["text": "Text before document edit", "audio": audio.base64EncodedString(), "seconds": 1]], "policy": "Replay is free."]
      let data = try JSONSerialization.data(withJSONObject: ["result": ["data": ["json": job]]])
      return (200, String(decoding: data, as: UTF8.self))
    }
    let flow = NativeNarrationFlow(session: try TestServer.session(server), document: "edited-doc")
    await flow.restore()
    guard case .job(let job) = flow.state else { Issue.record("Expected historical playable recording"); return }
    #expect(job.parts.first?.text == "Text before document edit")
    let files = ProNarrationFiles()
    let recording = try files.recording(job)
    #expect(recording.parts.count == 1)
    files.clear()
    #expect(server.requests.count == 2)
    #expect(server.requests.allSatisfy { $0.authorization == "Bearer lxd_kept" })
  }
}
