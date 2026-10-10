import LexidrawKit
import SwiftUI

struct LocalTextSection: View {
  @State private var runtime: NativeLocalText
  @State private var availability = LocalTextAvailability.modelNotReady
  @State private var before = ""
  @State private var output: String?
  @State private var message: String?
  @State private var task: Task<Void, Never>?
  @State private var working = false
  @FocusState private var focused: Bool
  @Environment(\.scenePhase) private var scenePhase

  init(runtime: NativeLocalText = NativeLocalText()) {
    _runtime = State(initialValue: runtime)
  }

  var body: some View {
    Section {
      Text(availability.message)
        .accessibilityIdentifier("local-text-availability")
      Button("Refresh local availability") { refresh() }
        .disabled(working)
      TextField("Text to continue locally", text: $before, axis: .vertical)
        .focused($focused)
        .lineLimit(3...6)
        .accessibilityIdentifier("local-text-input")
        .disabled(working)
      Button("Try Local Text") { generate() }
        .accessibilityIdentifier("local-text-generate")
        .disabled(
          working || availability != .available
            || before.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      if working {
        HStack {
          ProgressView("Generating locally…")
          Spacer()
          Button("Cancel Local Text") {
            stop(message: LocalTextError.cancelled.localizedDescription)
          }
          .accessibilityIdentifier("local-text-cancel")
        }
      }
      if let output {
        Text(output.isEmpty ? "No confident continuation returned. Try different text." : output)
          .textSelection(.enabled)
          .accessibilityIdentifier("local-text-result")
      }
      if let message {
        Text(message).font(.footnote)
          .accessibilityIdentifier("local-text-message")
      }
    } header: {
      Text("Apple Intelligence text")
    } footer: {
      Text(
        "Try a short text continuation using Apple’s on-device model. No key is needed, no content is sent to a cloud provider, and no Pro credits are used. Unsupported languages and actions stay unavailable. Built-in narration uses Apple voices separately in a document’s Listen menu."
      )
    }
    .onAppear { refresh() }
    .onDisappear { stop(message: LocalTextError.cancelled.localizedDescription) }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active {
        refresh()
      } else if working {
        stop(message: "Local text interrupted. Start again when you return.")
      }
    }
  }

  private func refresh() { availability = runtime.availability() }

  private func generate() {
    focused = false
    refresh()
    guard availability == .available else { return }
    task?.cancel()
    runtime.cancel()
    output = nil
    message = nil
    working = true
    task = Task {
      do {
        let result = try await runtime.suggest(title: "", before: before, after: "")
        guard !Task.isCancelled else { return }
        output = result
        message = "Completed with Apple Intelligence on this device."
      } catch {
        guard !Task.isCancelled else { return }
        message =
          (error as? LocalTextError)?.localizedDescription
          ?? "Local text could not complete. Try again."
        refresh()
      }
      guard !Task.isCancelled else { return }
      working = false
    }
  }

  private func stop(message: String) {
    task?.cancel()
    runtime.cancel()
    task = nil
    if working {
      working = false
      self.message = message
    }
  }
}
