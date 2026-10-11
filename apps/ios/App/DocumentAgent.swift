import LexidrawKit
import SwiftUI
struct DocumentAgentComposer: View {
 let session: Session
 let document: String
 var body: some View {
  ScopedDocumentAgentComposer(session: session, document: document)
   .id("\(session.scopeID):\(document)")
 }
}
private struct ScopedDocumentAgentComposer: View {
 let session: Session
 let document: String
 private enum PowerState { case loading, ready(AIPowerPreference), failed }
 @State private var power: PowerState = .loading
 @State private var flow: NativeAgentFlow
 init(session: Session, document: String) {
  self.session = session; self.document = document
  let value = NativeAgentFlow(session: session, document: document)
  value.selectGeneration(false)
  _flow = State(initialValue: value)
 }
 var body: some View {
  VStack {
   switch power {
   case .loading: ProgressView("Checking AI power...")
   case .failed: Text("Could not check AI power."); Button("Retry AI power") { Task { await readPower() } }
   case .ready(.byok): DeviceAgentComposer(session: session, document: document)
   case .ready(.local): Text("Document actions are unavailable with built-in local AI.")
   case .ready(.pro): EmptyView()
   }
   AgentComposerContent(flow: flow)
  }.task {
   async let owned: Void = flow.load()
   await readPower()
   await owned
  }
 }
 private func readPower() async {
  flow.selectGeneration(false)
  do {
   let selected = try await session.powerPreference(); try Task.checkCancellation()
   power = .ready(selected); flow.selectGeneration(selected == .pro)
  } catch { if !Task.isCancelled { power = .failed } }
 }
}
struct AgentComposerContent:View {
 @Bindable var flow:NativeAgentFlow
 @State private var prompt=""
 var body:some View {
  Form {
   Section("Pro document action") {
    Text("One maximum covers planning, decisions, generation and supported paid search. Saved edits remain if work stops. Technical failures return the reservation. A fully completed action is charged; uncertain paid outcomes remain reserved.")
    Text("Images and sandbox delegation are unavailable. Public Pro is Coming soon.")
   }
   switch flow.capability {
   case .loading: Text("Checking new-action availability...")
   case .available: EmptyView()
   case .unavailable(let reason): Text(reason)
   case .failed:
    Text("New-action availability could not be checked. Existing work remains available.")
    Button("Retry capability read") { Task { await flow.retryCapability() } }
   }
   switch flow.readState {
   case .current: EmptyView()
   case .loading: Text("Checking latest status. Retained progress may be out of date.")
   case .stale(let message):
    Text(message)
    Button("Retry status read") { Task { await flow.refresh() } }
   case .denied:
    Button("Retry access read") { Task { await flow.load() } }
   }
   if flow.cancellationUnconfirmed {
    Text("Cancellation is not confirmed. Further work may still be running. Refresh status to check.")
   }
   if let previous = flow.previousResult {
    Section("Earlier saved action") { AgentSavedReport(result: previous) }
   }
   switch flow.state {
   case .loading,.quoting:ProgressView("Checking action...")
   case .unavailable(let reason),.error(let reason):Text(reason)
   case .ready:
    TextField("Describe the edits",text:$prompt,axis:.vertical).accessibilityIdentifier("agent prompt")
    Button("Review maximum"){Task{await flow.quote(prompt)}}.disabled(prompt.isEmpty || !flow.canStart)
   case .quote(_,let quote,_), .acceptanceUncertain(_,let quote,_):
    Text("Maximum reservation: \(Double(quote.maximum)/1_000_000) credits. Final consumption can be lower.")
    if case .acceptanceUncertain = flow.state {
     Text("Acceptance could not be confirmed. This quoted identity is retained. Refresh checks the original submission without starting another action.")
     Button("Refresh owned action") { Task { await flow.load() } }
    } else {
     Button("Decline"){flow.decline()}
     Button("Accept maximum"){Task{await flow.accept()}}.disabled(!flow.canStart)
    }

   case .running:ProgressView("Running document action...")
   case .result(let result):
    AgentSavedReport(result: result)
    if ["reserved","running","unknown"].contains(result.operation.state){Button("Refresh status"){Task{await flow.refresh()}};Button("Stop further work"){Task{await flow.cancel()}}}else{Button("New action"){flow.decline()}.disabled(!flow.canStart)}
   }
  }
 }
}

struct AgentSavedReport: View {
 let result: ProAgentResult
 var body: some View {
    Text("Action: \(result.report.status). Charged \(Double(result.operation.charged)/1_000_000) credits.")
    if let reason=result.report.reason{Text(reason)}
    Section("Saved edits"){if result.report.completed.isEmpty{Text("No edits saved.")}else{ForEach(Array(result.report.completed.enumerated()),id:\.offset){_,edit in Text("\(edit.description) (saved revision \(edit.revision))")}}}
    Section("Incomplete edits"){if result.report.incomplete.isEmpty{Text("No incomplete edits.")}else{ForEach(Array(result.report.incomplete.enumerated()),id:\.offset){_,edit in Text(edit)}}}
 }
}

struct DocumentChatComposer: View {
  let session: Session
  let document: String
  let context: String
  @State private var flow = NativeChatFlow()
  var body: some View {
    NativeChatView(flow: flow).task {
      await flow.load(session: session, document: document, context: context)
    }
  }
}
