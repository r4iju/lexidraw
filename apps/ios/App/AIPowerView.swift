import LexidrawKit
import SwiftUI

struct AIPowerView: View {
  let session: Session
  private enum Setup {
    case loading
    case ready(AIPowerPreference, NativeBYOK)
    case failed
  }
  @State private var setup = Setup.loading
  @State private var key = ""
  @State private var before = ""
  @State private var message: String?
  @State private var output: String?
  @State private var working = false
  @State private var task: Task<Void, Never>?
  private enum Field: Hashable { case key, before }
  @FocusState private var focused: Field?

  var body: some View {
    Form {
      Section("Power source") {
        switch setup {
        case .loading: ProgressView("Loading AI settings…")
        case .failed:
          Text("AI settings are unavailable. Connect and try again.")
          Button("Try Again") { Task { await load() } }
        case .ready(let preference, let runtime):
          Picker(
            "Power source",
            selection: Binding(
              get: { preference },
              set: { choice in
                perform(runtime) {
                  try await session.setPowerPreference(choice)
                  setup = .ready(choice, runtime)
                  output = nil
                  message = "Power preference saved."
                }
              })
          ) {
            Text("Built-in local").tag(AIPowerPreference.local)
            Text("My OpenRouter key").tag(AIPowerPreference.byok)
          }
          .accessibilityIdentifier("ai-power-source")
          .disabled(working)
          Text("Pro · Coming soon")
            .foregroundStyle(.secondary)
          Text(
            "Built-in local text is not available here yet. OpenRouter text runs directly on this device. Images, narration and paid tools are unavailable through this key."
          )
          .font(.footnote)
        }
      }
      if case .ready(let preference, let runtime) = setup {
        Section {
          Text(runtime.hasKey ? "Key saved on this device" : "No key on this device")
          SecureField("OpenRouter key", text: $key)
            .focused($focused, equals: .key)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textContentType(.none)
            .privacySensitive()
          Button(runtime.hasKey ? "Replace Key" : "Save Key") {
            perform(runtime) {
              try runtime.replaceKey(key)
              key = ""
              message = "Key saved. Validate it directly with OpenRouter."
              output = nil
            }
          }
          .disabled(key.isEmpty)
          if runtime.hasKey {
            Button("Validate Key") {
              perform(runtime) {
                try await runtime.validate()
                message = "Key accepted by OpenRouter. Text access is checked when you generate."
              }
            }
            .disabled(working)
            Button("Remove Key", role: .destructive) {
              perform(runtime) {
                try runtime.removeKey()
                key = ""
                output = nil
                message = "Key removed. Queued requests have stopped."
              }
            }
          }
        } header: {
          Text("Device setup")
        } footer: {
          Text(
            "Your key stays in this device’s Keychain. Set it up separately on each device. Signing out removes this device’s configured key."
          )
        }
        if preference == .byok {
          Section {
            TextField("Text to continue", text: $before, axis: .vertical)
              .focused($focused, equals: .before)
              .lineLimit(3...6)
            Button("Try Text") {
              perform(runtime) {
                output = try await runtime.suggest(title: "", before: before, after: "")
                message = "Text completed on this device."
              }
            }
            .disabled(working || !runtime.hasKey || before.isEmpty)
            if let output {
              Text(output.isEmpty ? "No suggestion returned." : output).textSelection(.enabled)
            }
          } header: {
            Text("Try a text continuation")
          } footer: {
            Text(
              "OpenRouter bills your provider account. This never uses Pro credits. Work stops when you leave this screen or the app is suspended. A request already sent may still be billed by OpenRouter."
            )
          }
        }

      }
    }
    .safeAreaInset(edge: .bottom) {
      if working, case .ready(_, let runtime) = setup {
        HStack {
          ProgressView()
          Text("Working on this device…")
          Spacer()
          Button("Cancel") {
            task?.cancel()
            runtime.cancel()
            working = false
            message = NativeAIError.cancelled.localizedDescription
          }
        }
        .padding()
        .background(.bar)
      } else if let message {
        Text(message)
          .font(.footnote)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding()
          .background(.bar)
      }
    }
    .navigationTitle("AI Power")
    .navigationBarTitleDisplayMode(.inline)
    .task { await load() }
    .onDisappear {
      task?.cancel()
      if case .ready(_, let runtime) = setup { runtime.cancel() }
      key = ""
    }
    .onReceive(
      NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)
    ) { _ in
      task?.cancel()
      if case .ready(_, let runtime) = setup { runtime.cancel() }
      working = false
      message = "Device work interrupted. Start again when you return."
    }
  }

  private func load() async {
    do {
      let runtime = try await session.nativeAI()
      let preference = try await session.powerPreference()
      try Task.checkCancellation()
      output = try runtime.savedSuggestion()
      setup = .ready(preference, runtime)
    } catch is CancellationError {
    } catch { setup = .failed }
  }

  private func perform(
    _ runtime: NativeBYOK, operation: @escaping @MainActor () async throws -> Void
  ) {
    focused = nil
    task?.cancel()
    runtime.cancel()
    working = true
    message = nil
    task = Task {
      do { try await operation() } catch {
        guard !Task.isCancelled else { return }
        message =
          (error as? NativeAIError)?.localizedDescription
          ?? "Couldn’t complete this action. Connect and try again."
      }
      guard !Task.isCancelled else { return }
      working = false
    }
  }
}
