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

extension NativeProRecoveryTests {
  @Test func uncertainAcceptedActionCannotDiscardItsKeyByDecliningAndAcceptDoesNotResubmit() async throws {
    let server = FakeServer { request in
      switch request.url.path {
      case "/api/trpc/agentPower.current": return (200, envelope("null"))
      case "/api/trpc/agentPower.capability": return (200, envelope(#"{"available":true,"reason":"Ready"}"#))
      case "/api/trpc/agentPower.quote": return (200, envelope(#"{"maximum":10,"revision":1}"#))
      case "/api/trpc/agentPower.start": throw URLError(.networkConnectionLost)
      default: throw URLError(.unsupportedURL)
      }
    }
    let flow = NativeAgentFlow(session: try TestServer.session(server), document: "doc")
    await flow.load(); await flow.quote("Edit paragraph"); await flow.accept()
    guard case .acceptanceUncertain(_, _, let originalKey) = flow.state else { Issue.record("Expected retained submission"); return }
    flow.decline()
    await flow.refresh()
    await flow.accept()
    let submissions = server.requests.filter { $0.url.path.hasSuffix("agentPower.start") }
    #expect(submissions.count == 1)
    let first = try #require(submissions.first)
    struct Submitted: Decodable { struct Input: Decodable { let idempotencyKey: String }; let json: Input }
    let body = try #require(first.body)
    #expect(try JSONDecoder().decode(Submitted.self, from: body).json.idempotencyKey == originalKey)
    guard case .acceptanceUncertain(_, _, let retainedKey) = flow.state else { Issue.record("Missing unresolved identity"); return }
    #expect(retainedKey == originalKey)
  }
}


extension NativeProRecoveryTests {
  @Test func olderCurrentReplyCannotEraseAmbiguousNewActionOrAuthorizeAnotherSubmission() async throws {
    let reads = Mutex(0)
    let readStarted = Mutex(false)
    let releaseRead = DispatchSemaphore(value: 0)
    let server = FakeServer { request in
      switch request.url.path {
      case "/api/trpc/agentPower.current":
        if reads.withLock({ $0 += 1; return $0 }) > 1 {
          readStarted.withLock { $0 = true }
          _ = releaseRead.wait(timeout: .now() + 5)
        }
        return (200, envelope(retainedAction.replacingOccurrences(of: "unknown", with: "settled")))
      case "/api/trpc/agentPower.capability": return (200, envelope(#"{"available":true,"reason":"Ready"}"#))
      case "/api/trpc/agentPower.quote": return (200, envelope(#"{"maximum":10,"revision":1}"#))
      case "/api/trpc/agentPower.start": throw URLError(.networkConnectionLost)
      default: throw URLError(.unsupportedURL)
      }
    }
    let flow = NativeAgentFlow(session: try TestServer.session(server), document: "doc")
    await flow.load(); flow.decline(); await flow.quote("New edits"); await flow.accept()
    guard case .acceptanceUncertain(_, _, let originalKey) = flow.state else { Issue.record("Expected uncertain acceptance"); return }
    let read = Task { await flow.load() }
    for _ in 0..<100 where !readStarted.withLock({ $0 }) { try await Task.sleep(for: .milliseconds(2)) }
    #expect(readStarted.withLock { $0 })
    releaseRead.signal()
    await read.value
    guard case .acceptanceUncertain(_, _, let retainedKey) = flow.state else { Issue.record("Older result erased pending submission"); return }
    #expect(retainedKey == originalKey)
    #expect(flow.previousResult != nil)
    #expect(server.requests.last(where: { $0.url.path.hasSuffix("agentPower.current") })?.url.query?.contains(originalKey) == true)
    flow.decline(); await flow.quote("Replacement edits"); await flow.accept()
    #expect(server.requests.filter { $0.url.path.hasSuffix("agentPower.quote") }.count == 1)
    #expect(server.requests.filter { $0.url.path.hasSuffix("agentPower.start") }.count == 1)
  }
}


extension NativeProRecoveryTests {
  @Test func exactPendingNullAndErrorReadsPreserveEarlierSavedReport() async throws {
    let keyedReads = Mutex(0)
    let server = FakeServer { request in
      switch request.url.path {
      case "/api/trpc/agentPower.current":
        if request.url.query?.contains("idempotencyKey") == true {
          if keyedReads.withLock({ $0 += 1; return $0 }) > 1 { throw URLError(.networkConnectionLost) }
          return (200, envelope("null"))
        }
        return (200, envelope(retainedAction.replacingOccurrences(of: "unknown", with: "settled").replacingOccurrences(of: "reconciling", with: "partial")))
      case "/api/trpc/agentPower.capability": return (200, envelope(#"{"available":true,"reason":"Ready"}"#))
      case "/api/trpc/agentPower.quote": return (200, envelope(#"{"maximum":10,"revision":1}"#))
      case "/api/trpc/agentPower.start": throw URLError(.networkConnectionLost)
      default: throw URLError(.unsupportedURL)
      }
    }
    let flow = NativeAgentFlow(session: try TestServer.session(server), document: "doc")
    await flow.load(); flow.decline(); await flow.quote("New edits"); await flow.accept()
    guard case .acceptanceUncertain(_, _, let key) = flow.state else { Issue.record("Missing B uncertainty"); return }
    for _ in 0..<2 {
      await flow.load()
      #expect(flow.previousResult?.report.completed.first?.description == "Saved paragraph")
      #expect(flow.previousResult?.report.completed.first?.revision == 2)
      #expect(flow.previousResult?.report.incomplete == ["Next edit"])
      #expect(flow.previousResult?.report.reason == "Outcome held")
      guard case .acceptanceUncertain(_, _, let pending) = flow.state else { Issue.record("Lost B"); return }
      #expect(pending == key)
      flow.decline(); await flow.quote("Forbidden C"); await flow.accept()
    }
    #expect(server.requests.filter { $0.url.path.hasSuffix("agentPower.quote") }.count == 1)
    #expect(server.requests.filter { $0.url.path.hasSuffix("agentPower.start") }.count == 1)
  }
}
