import LexidrawKit
import SwiftUI

struct AIPowerView: View {
  let session: Session
  private enum Setup {
    case loading
    case ready(AIPowerPreference, NativeBYOK, ProAllowance)
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
        case .ready(let preference, let runtime, let allowance):
          Picker(
            "Power source",
            selection: Binding(
              get: { preference },
              set: { choice in
                perform(runtime) {
                  try await session.setPowerPreference(choice)
                  setup = .ready(choice, runtime, allowance)
                  output = nil
                  message = "Power preference saved."
                }
              })
          ) {
            Text("Built-in local").tag(AIPowerPreference.local)
            Text("My OpenRouter key").tag(AIPowerPreference.byok)
            if allowance.eligible { Text("Pro (private trial)").tag(AIPowerPreference.pro) }
          }
          .accessibilityIdentifier("ai-power-source")
          .disabled(working)
          Text("Pro · Coming soon")
            .foregroundStyle(.secondary)
          Text(
            "Built-in local narration is free in a document’s Listen menu, using Apple voices available on this device. It does not create a synced recording. Apple Intelligence text has separate device, model and language requirements. OpenRouter text runs directly on this device. Image and narration access require separate verified capabilities. Unsupported paid tools remain unavailable."
          )
          .font(.footnote)
        }
      }
      if case .ready(let preference, let runtime, let allowance) = setup {
        StoreKitSandboxSection(session: session, eligible: allowance.eligible, refresh: load)
        if preference == .local { LocalTextSection() }
        if let billing = allowance.billing {
          Section("Sandbox/test payment") {
            if allowance.eligible {
              Text("$\(billing.monthlyUsd)/month · \(billing.monthlyCredits) credits per period")
              Text(billing.source == "apple" ? "Apple sandbox subscription. Manage renewal in your device’s sandbox account settings." : "Test payment only, no customer charge. Manage your web sandbox subscription in web settings.")
              Text("Status: \(billing.state.replacingOccurrences(of: "_", with: " "))")
              if !billing.available { Text("Sandbox billing unavailable. External test setup is missing or unsupported.") }
              if let expiry = billing.expiresAt {
                LabeledContent(billing.cancelAtEnd && billing.state == "active" ? "Ends at period expiry" : "Period expiry", value: Date(timeIntervalSince1970: Double(expiry) / 1000).formatted(date: .abbreviated, time: .omitted))
              }
              Text("Billing does not enable unavailable Pro capabilities. No rollover, top-ups, annual plan or overage. Saved playback, local AI and your own key remain usable after expiry.").font(.footnote)
            } else { Text("Pro Coming soon. Public purchases are unavailable.") }
          }
        }
        Section("Pro allowance, shared with web") {
          Text(allowance.entitled ? "Private trial active" : "No active private allowance")
          Text("This screen shares the account allowance and history. Pro text is Coming soon until provider access, quality and output bounds are verified.").font(.footnote)
          LabeledContent("Available credits", value: credits(allowance.availableSubcredits))
          LabeledContent("Reserved credits", value: credits(allowance.reservedSubcredits))
          if let prior = allowance.previousPeriodReservedSubcredits, prior > 0 {
            LabeledContent("Reserved from earlier periods", value: credits(prior))
          }
          LabeledContent("Renewal", value: allowance.renewalAt.map { Date(timeIntervalSince1970: Double($0) / 1000).formatted(date: .abbreviated, time: .omitted) } ?? "No active allowance")
          Text(allowance.policy.disclosure).font(.footnote)
          Button("Refresh allowance") { Task { await load() } }
          if allowance.history.isEmpty { Text("No Pro operations yet.") }
          ForEach(allowance.history) { item in
            VStack(alignment: .leading) {
              Text("\(item.feature): \(item.state)")
              Text("\(credits(item.charged)) credits charged").font(.footnote)
              if ["reserved", "running", "unknown"].contains(item.state) {
                Text("\(credits(item.quote)) credits reserved").font(.footnote)
              }
            }
          }
        }
        Section {
          if runtime.cleanupPending {
            Text("Key removal failed. The remaining key is disabled. Retry Remove Key.")
          } else {
            Text(runtime.hasKey ? "Key saved on this device" : "No key on this device")
          }
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
          }
          if runtime.hasKey || runtime.cleanupPending {
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
      if working, case .ready(_, let runtime, _) = setup {
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
      if case .ready(_, let runtime, _) = setup { runtime.cancel() }
      key = ""
    }
    .onReceive(
      NotificationCenter.default.publisher(for: UIApplication.willResignActiveNotification)
    ) { _ in
      task?.cancel()
      if case .ready(_, let runtime, _) = setup { runtime.cancel() }
      working = false
      message = "Device work interrupted. Start again when you return."
    }
  }

  private func credits(_ value: Int64) -> String {
    (Double(value) / 1_000_000).formatted(.number.precision(.fractionLength(0...6)))
  }

  private func load() async {
    do {
      async let runtimeResult = session.nativeAI()
      async let preferenceResult = session.powerPreference()
      async let allowanceResult = session.proAllowance()
      let (runtime, preference, allowance) = try await (runtimeResult, preferenceResult, allowanceResult)
      try Task.checkCancellation()
      output = try runtime.savedSuggestion()
      setup = .ready(preference, runtime, allowance)
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
