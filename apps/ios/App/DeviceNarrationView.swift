import LexidrawKit
import SwiftUI

struct DeviceNarrationComposer: View {
  let session: Session
  let document: String
  let onPlay: (NarrationPlayback) -> Void
  @State private var flow: NativeDeviceNarrationFlow?
  @State private var message: String?
  init(
    session: Session, document: String, flow: NativeDeviceNarrationFlow? = nil,
    onPlay: @escaping (NarrationPlayback) -> Void
  ) {
    self.session = session
    self.document = document
    self.onPlay = onPlay
    _flow = State(initialValue: flow)
  }
  var body: some View {
    NavigationStack {
      Form {
        Section("My OpenRouter narration") {
          Text(
            "Generation needs this app in the foreground. Suspension or shutdown can interrupt it. Completed audio stays on this device. Resume needs a current key. Provider requests may still be billed after interruption. Sync and saved replay use no Pro credits."
          )
          if let flow {
            if !flow.available {
              Text(
                "OpenRouter narration is unavailable until actual account access, audio format and an enforceable output bound are verified."
              )
            }
            if let checkpoint = flow.checkpoint {
              Text(
                "\(checkpoint.parts.filter{$0.kind == .completed}.count) of \(checkpoint.parts.count) parts retained locally."
              )
              if checkpoint.status == "unknown" {
                Text(
                  "Provider outcome uncertain. No automatic repeat will occur. Check the original provider result before recovering this part."
                )
              } else if checkpoint.status == "running" {
                ProgressView("Generating in the foreground…")
              } else if checkpoint.recording == nil {
                Button("Resume generation") { run { try await flow.resume() } }.disabled(
                  !flow.available || !flow.keyAvailable)
              }
              if let job = checkpoint.retainedJob {
                Button("Play retained audio") { onPlay(.init(job: job, source: .device, scope: checkpoint.owner?.storageKey)) }
                if checkpoint.status != "saved", checkpoint.recording != nil {
                  Button(
                    checkpoint.status == "sync_failed" ? "Retry sync" : "Sync completed recording"
                  ) { Task { await flow.sync() } }.disabled(checkpoint.status == "syncing")
                } else if checkpoint.status == "saved" {
                  Text("Saved to your account. Replay is free without a key.")
                }
              }
            } else {
              Button("Generate on this device") {
                run {
                  guard try await session.powerPreference() == .byok else {
                    throw NativeAIError.unavailable
                  }
                  let text = try await session.deviceNarrationSource(document: document)
                  try await flow.start(text: text)
                }
              }.disabled(!flow.available || !flow.keyAvailable)
            }
            if let notice = flow.notice { Text(notice) }
          } else {
            ProgressView("Loading local progress…")
          }
          Button("Play saved device recording") {
            run {
              guard let saved = try await session.savedDeviceNarration(document: document) else {
                throw NativeAIError.unavailable
              }
              onPlay(.init(job: saved.recording.job(id: saved.id), source: .device))
            }
          }
          if let message { Text(message) }
        }
      }.navigationTitle("Device narration")
    }.task {
      if flow != nil { return }
      do {
        let created = try await session.deviceNarrationFlow(document: document)
        try created.restore()
        flow = created
      } catch {
        message = "Local narration could not be loaded safely. No provider request was made."
      }
    }
  }
  private func run(_ action: @escaping @MainActor () async throws -> Void) {
    message = nil
    Task {
      do { try await action() } catch {
        message =
          "Narration could not continue safely. Retained audio stays local; no automatic provider retry was made."
      }
    }
  }
}
