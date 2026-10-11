import LexidrawKit
import SwiftUI
import Foundation
import HTTPTypes
import OpenAPIRuntime
struct AgentFixtureScreen:View {
 let session:Session
 @State private var evidence=""
 var body:some View {
  VStack {
   Text("287 injected whole-action fixture").font(.headline)
   Text("Production action UI and document adapter with isolated shared account ledger. No actual provider verification.").font(.caption)
   DocumentAgentComposer(session:session,document:"doc")
   Button("Read saved document and usage") {Task{do{let (data,_)=try await URLSession.shared.data(from:URL(string:"http://127.0.0.1:3087/fixture-state")!);let json=try JSONSerialization.jsonObject(with:data) as? [String:Any];let document=json?["document"] as? [String:Any];let allowance=try await session.proAllowance();evidence="Saved: \(document?["text"] as? String ?? "")\nAvailable: \(Double(allowance.availableSubcredits)/1_000_000)"}catch{evidence="Fixture read failed"}}}
   Text(evidence).font(.caption).accessibilityIdentifier("agent fixture evidence")
  }
 }
}

/// Deterministic transport outages exercised through the production recovery views.
struct NativeProRecoveryFixtureScreen: View {
 @State private var transport = RecoveryFixtureTransport()
 @State private var agent: NativeAgentFlow?
 @State private var narration: NativeNarrationFlow?
 @State private var showNarration = false
 @State private var scope = "original document / account"
 var body: some View {
  VStack {
   Text("Native recovery fixture: \(scope)").font(.caption)
   Toggle("Narration recovery", isOn: $showNarration)
   HStack {
    Button("Fail reads") { Task { await transport.failReads(true); await refresh() } }
    Button("Cancel offline") { Task { if showNarration { await narration?.cancel() } else { await agent?.cancel() } } }
    Button("Restore reads") { Task { await transport.failReads(false); await refresh() } }
   }.font(.caption)
   HStack {
    Button("Change document") { Task { await replaceScope("other document") } }
    Button("Change account") { Task { await replaceScope("other account") } }
   }.font(.caption)
   if showNarration, let narration { ProNarrationComposer(flow: narration, onPlay: { _ in }).id(scope) }
   else if let agent { AgentComposerContent(flow: agent) }
  }.task { await load() }
 }
 private func refresh() async {
  if showNarration { await narration?.refresh() } else { await agent?.refresh() }
 }
 private func replaceScope(_ label: String) async {
  agent = nil; narration = nil; scope = label
  transport = RecoveryFixtureTransport(hasOwnedWork: false)
  await load()
 }
 private func load() async {
  guard let session = try? Account(origin: URL(string: "https://recovery.invalid")!, store: AccountHarnessToken(), transport: transport).restore() else { return }
  let nextAgent = NativeAgentFlow(session: session, document: scope)
  let nextNarration = NativeNarrationFlow(session: session, document: scope)
  nextAgent.selectGeneration(true)
  agent = nextAgent; narration = nextNarration
  await nextAgent.load(); await nextNarration.restore()
 }
}

private actor RecoveryFixtureTransport: ClientTransport {
 private var offline = false
 private let hasOwnedWork: Bool
 init(hasOwnedWork: Bool = true) { self.hasOwnedWork = hasOwnedWork }
 func failReads(_ value: Bool) { offline = value }
 func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
  if offline { throw URLError(.notConnectedToInternet) }
  let json: String
  switch operationID {
  case "agentPower.capability": json = #"{"available":true,"reason":"Synthetic bounded private fixture."}"#
  case "agentPower.quote": json = #"{"maximum":26629334,"revision":2}"#
  case "agentPower.start": throw URLError(.networkConnectionLost)
  case "agentPower.current":
   let input = URLComponents(string: request.path ?? "")?.queryItems?.first(where: { $0.name == "input" })?.value
   let envelope = input.flatMap { try? JSONSerialization.jsonObject(with: Data($0.utf8)) as? [String: Any] }
   let key = (envelope?["json"] as? [String: Any])?["idempotencyKey"] as? String
   json = hasOwnedWork && key == nil ? Self.action : "null"
  case "agentPower.operation", "agentPower.cancel": json = Self.action
  case "narration.latest": json = hasOwnedWork ? #"{"id":"owned-audio"}"# : "null"
  case "narration.operation", "narration.cancel": json = Self.audio
  default: throw URLError(.unsupportedURL)
  }
  return (HTTPResponse(status: .ok), HTTPBody(Data("{\"result\":{\"data\":{\"json\":\(json)}}}".utf8)))
 }
 private static let action = #"{"operation":{"id":"owned","state":"settled","charged":0,"quote":26629334},"report":{"status":"partial","completed":[{"revision":2,"description":"Saved paragraph"}],"incomplete":["Next edit"],"reason":"Outcome held"}}"#
 private static let audio = #"{"id":"owned-audio","state":"running","charged":0,"quote":12950000,"made":1,"planned":2,"parts":[{"text":"Saved audio","audio":"UklGRg==","seconds":1}],"policy":"Uncertain outcomes remain reserved."}"#
}
