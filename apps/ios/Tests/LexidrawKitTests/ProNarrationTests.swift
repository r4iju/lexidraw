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
    let recording = try await files.recording(job)
    #expect(recording.parts.count == 1)
    files.clear()
    #expect(server.requests.count == 2)
    #expect(server.requests.allSatisfy { $0.authorization == "Bearer lxd_kept" })
  }
}

@Suite("Linked Pro narration parts") struct LinkedProNarrationTests {
  @Test @MainActor func longSavedNarrationIsReadAsLinksAndDownloadedWithTheAccountToken() async throws {
    let wav = String(decoding: Data("RIFF".utf8) + Data(repeating: 0, count: 44), as: UTF8.self)
    let planned = 42
    let server = FakeServer { request in
      if request.url.path.hasPrefix("/api/narration/parts/") { return (200, wav) }
      #expect(request.url.path.hasSuffix("narration.saved"))
      #expect(request.url.query?.contains("delivery") == true)
      let parts = (0..<planned).map {
        ["text": "Part \($0)", "url": "/api/narration/parts/attempt-\($0)", "seconds": 30] as [String: Any]
      }
      let job: [String: Any] = ["id": "long", "state": "saved", "charged": 0, "quote": 0,
        "made": planned, "planned": planned, "parts": parts, "policy": "Replay is free."]
      let data = try JSONSerialization.data(withJSONObject: ["result": ["data": ["json": job]]])
      return (200, String(decoding: data, as: UTF8.self))
    }
    let session = try TestServer.session(server)
    let flow = NativeNarrationFlow(session: session, document: "long-doc")
    await flow.saved()
    guard case .job(let job) = flow.state else { Issue.record("Expected linked recording"); return }
    let files = ProNarrationFiles()
    let recording = try await files.recording(job, from: session)
    #expect(recording.parts.count == planned)
    #expect(recording.parts.allSatisfy { $0.audio.isFileURL })
    #expect(try Data(contentsOf: recording.parts[41].audio).prefix(4) == Data("RIFF".utf8))
    files.clear()
    let downloads = server.requests.filter { $0.url.path.hasPrefix("/api/narration/parts/") }
    #expect(downloads.count == planned)
    #expect(server.requests.allSatisfy { $0.authorization == "Bearer lxd_kept" })
  }
}

@Suite("Narration acceptance ownership") struct NarrationAcceptanceOwnershipTests {
  @Test @MainActor func lateSavedReadCannotReplaceAcceptedPendingIdentityOrItsCancellation() async throws {
    let server = FakeServer { request in
      if request.url.path.hasSuffix("auth.getPowerPreference") { return (200, #"{"result":{"data":{"json":{"mode":"pro"}}}}"#) }
      if request.url.path.hasSuffix("narration.quote") { return (200, #"{"result":{"data":{"json":{"maximum":10,"missing":1,"cached":0,"maxSeconds":120,"revision":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","version":"test","policy":"Uncertain remains reserved."}}}}"#) }
      if request.url.path.hasSuffix("narration.generate") {
        Thread.sleep(forTimeInterval: 0.1)
        return (200, #"{"result":{"data":{"json":{"id":"new-owned","state":"running","charged":0,"quote":10,"made":0,"planned":1,"parts":[],"policy":"Pending."}}}}"#)
      }
      if request.url.path.hasSuffix("narration.saved") {
        Thread.sleep(forTimeInterval: 0.2)
        return (200, #"{"result":{"data":{"json":{"id":"old-saved","state":"saved","charged":0,"quote":0,"made":0,"planned":1,"parts":[],"policy":"Free replay."}}}}"#)
      }
      #expect(request.url.path.hasSuffix("narration.cancel"))
      #expect((request.object["json"] as? [String: String])?["id"] == "new-owned")
      return (200, #"{"result":{"data":{"json":{"id":"new-owned","state":"cancelled","charged":0,"quote":10,"made":0,"planned":1,"parts":[],"policy":"Stopped."}}}}"#)
    }
    let flow = NativeNarrationFlow(session: try TestServer.session(server), document: "doc")
    await flow.review()
    let accepted = Task { await flow.accept() }
    for _ in 0..<100 where !server.requests.contains(where: { $0.url.path.hasSuffix("narration.generate") }) { try await Task.sleep(for: .milliseconds(2)) }
    let saved = Task { await flow.saved() }
    await accepted.value
    await saved.value
    guard case .job(let job) = flow.state else { Issue.record("Missing owned operation"); return }
    #expect(job.id == "new-owned")
    #expect(job.pending)
    await flow.cancel()
    #expect(server.requests.last?.url.path.hasSuffix("narration.cancel") == true)
  }
}
