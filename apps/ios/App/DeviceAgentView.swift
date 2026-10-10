import LexidrawKit
import SwiftUI
struct DeviceAgentComposer: View {
 let session: Session
 let document: String
 @State private var flow: NativeDeviceAgentFlow?
 @State private var failure: String?
 var body: some View {
  Group { if let flow { DeviceAgentContent(flow: flow) } else if let failure { Text(failure) } else { ProgressView("Loading local document action...") } }
  .task { do { let value = try await session.deviceAgentFlow(document: document); try value.restore(); flow = value } catch { failure = "Local action could not be restored safely. No provider request was made." } }
 }
}
struct DeviceAgentContent: View {
 @Bindable var flow: NativeDeviceAgentFlow
 @State private var prompt = ""
 @State private var notice: String?
 @FocusState private var promptFocused: Bool
 var body: some View {
  Form {
   Section("My OpenRouter document action") {
    Text("Planning and tools run on this device. Keep it open while working. No Pro credits are used. Your provider may charge an interrupted request. Saved edits remain if work stops.")
    Text("Search and sandbox delegation are unavailable. Images await verified provider access and bounds.")
    if !flow.available { Text("Device actions await verified OpenRouter account access, request bounds and quality.") }
   }
   if let checkpoint = flow.checkpoint {
    Text("Action: \(checkpoint.status). \(checkpoint.receipts.count) saved edits.")
    if let reason = checkpoint.reason { Text(reason) }
    Section("Saved edits") { if checkpoint.receipts.isEmpty { Text("No edits saved.") }; ForEach(Array(checkpoint.receipts.enumerated()), id: \.offset) { _, receipt in Text(receipt.description) } }
    Section("Incomplete edits") { ForEach(Array(checkpoint.plan.dropFirst(checkpoint.receipts.count).enumerated()), id: \.offset) { _, text in Text(text) } }
    if checkpoint.status == "unknown" { Text("A provider request may have been charged. It will not be repeated automatically.") }
    else if !["complete", "blocked", "running"].contains(checkpoint.status) {
     Button(checkpoint.phase == "mutation" ? "Retry retained edit" : "Resume on this device") { run { try await flow.resume() } }.disabled(checkpoint.phase != "mutation" && (!flow.available || !flow.keyAvailable))
    }
    if ["complete", "blocked"].contains(checkpoint.status), checkpoint.pending == nil { Button("Start a new action") { run { try flow.newAction() } } }
    if checkpoint.status == "running" { Button("Stop further work") { flow.stop() } }
   } else {
    TextField("Describe the edits", text: $prompt, axis: .vertical).focused($promptFocused)
    Button("Run on this device") { run { try await flow.start(prompt: prompt) } }.disabled(!flow.available || !flow.keyAvailable || prompt.isEmpty)
   }
   if let notice { Text(notice) }
  }.toolbar { ToolbarItemGroup(placement: .keyboard) { Spacer(); Button("Done") { promptFocused = false } } }.onDisappear { flow.stop() }
 }
 private func run(_ action: @escaping @MainActor () async throws -> Void) {
  notice = nil
  Task { do { try await action() } catch { notice = "Local action could not continue safely. Saved edits remain. No automatic provider repeat was made." } }
 }
}
