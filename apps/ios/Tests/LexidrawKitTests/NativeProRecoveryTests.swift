import Foundation
import Synchronization
import Testing
@testable import LexidrawKit

private let retainedAction = #"{"operation":{"id":"owned","state":"unknown","charged":0,"quote":26629334},"report":{"status":"reconciling","completed":[{"revision":2,"description":"Saved paragraph"}],"incomplete":["Next edit"],"reason":"Outcome held"}}"#
private func envelope(_ json: String) -> String { "{\"result\":{\"data\":{\"json\":\(json)}}}" }

@Suite("Native Pro recovery") @MainActor
struct NativeProRecoveryTests {
  @Test(arguments: [false, true]) func existingActionRestoresWithoutGenerationCapability(capabilityThrows: Bool) async throws {
    let server = FakeServer { request in
      switch request.url.path {
      case "/api/trpc/agentPower.capability":
        if capabilityThrows { throw URLError(.notConnectedToInternet) }
        return (200, envelope(#"{"available":false,"reason":"Coming soon"}"#))
      case "/api/trpc/agentPower.current": return (200, envelope(retainedAction))
      default: throw URLError(.unsupportedURL)
      }
    }
    let flow = NativeAgentFlow(session: try TestServer.session(server), document: "doc")
    await flow.load()
    guard case .result(let result) = flow.state else {
      Issue.record("Unavailable generation must not hide the owned action"); return
    }
    #expect(result.operation.id == "owned")
    #expect(result.report.completed.first?.description == "Saved paragraph")
    #expect(server.requests.allSatisfy { $0.authorization == "Bearer lxd_kept" })
  }
}

private let retainedNarration = #"{"id":"owned-audio","state":"running","charged":0,"quote":12950000,"made":1,"planned":2,"parts":[{"text":"Saved audio","audio":"UklGRg==","seconds":1}],"policy":"Uncertain outcomes remain reserved."}"#

extension NativeProRecoveryTests {
  @Test func agentReadAndCancellationErrorsRetainReportButDiscloseUncertainty() async throws {
    let offline = Mutex(false)
    let server = FakeServer { request in
      if request.url.path.hasSuffix("agentPower.capability") { return (200, envelope(#"{"available":true,"reason":"Ready"}"#)) }
      if offline.withLock({ $0 }) { throw URLError(.notConnectedToInternet) }
      return (200, envelope(retainedAction))
    }
    let flow = NativeAgentFlow(session: try TestServer.session(server), document: "doc")
    await flow.load()
    offline.withLock { $0 = true }
    await flow.refresh()
    #expect(flow.readState == .stale("Action status could not be refreshed. Displayed progress may be out of date."))
    await flow.cancel()
    #expect(flow.cancellationUnconfirmed)
    guard case .result(let result) = flow.state else { Issue.record("Lost saved report"); return }
    #expect(result.operation.id == "owned")
    #expect(result.report.completed.count == 1)
    offline.withLock { $0 = false }
    await flow.refresh()
    #expect(flow.readState == .current)
    #expect(flow.cancellationUnconfirmed)
    #expect(server.requests.allSatisfy { !$0.url.path.hasSuffix("start") && !$0.url.path.hasSuffix("quote") })
  }
  @Test func narrationReadAndCancellationErrorsRetainAudioButDiscloseUncertainty() async throws {
    let offline = Mutex(false)
    let server = FakeServer { request in
      if offline.withLock({ $0 }) { throw URLError(.notConnectedToInternet) }
      if request.url.path.hasSuffix("narration.latest") { return (200, envelope(#"{"id":"owned-audio"}"#)) }
      return (200, envelope(retainedNarration))
    }
    let flow = NativeNarrationFlow(session: try TestServer.session(server), document: "doc")
    await flow.restore()
    offline.withLock { $0 = true }
    await flow.refresh()
    #expect(flow.readState == .stale("Narration status could not be refreshed. Displayed progress may be out of date."))
    await flow.cancel()
    #expect(flow.cancellationUnconfirmed)
    guard case .job(let job) = flow.state else { Issue.record("Lost retained audio"); return }
    #expect(job.id == "owned-audio")
    #expect(job.parts.first?.text == "Saved audio")
    offline.withLock { $0 = false }
    await flow.refresh()
    #expect(flow.readState == .current)
    #expect(flow.cancellationUnconfirmed)
    #expect(server.requests.allSatisfy { !$0.url.path.hasSuffix("generate") && !$0.url.path.hasSuffix("quote") })
  }
}

extension NativeProRecoveryTests {
  @Test func savedReadDoesNotReplaceAnOwnedPendingNarration() async throws {
    let server = FakeServer { request in
      if request.url.path.hasSuffix("narration.latest") { return (200, envelope(#"{"id":"owned-audio"}"#)) }
      if request.url.path.hasSuffix("narration.saved") { return (200, envelope(retainedNarration.replacingOccurrences(of: "owned-audio", with: "older-saved").replacingOccurrences(of: "running", with: "saved"))) }
      return (200, envelope(retainedNarration))
    }
    let flow = NativeNarrationFlow(session: try TestServer.session(server), document: "doc")
    await flow.restore()
    await flow.saved()
    guard case .job(let job) = flow.state else { Issue.record("Lost pending operation"); return }
    #expect(job.id == "owned-audio")
    #expect(job.pending)
  }
}
