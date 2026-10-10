import Foundation
import Observation
import SwiftUI
import UniformTypeIdentifiers

@MainActor @Observable public final class NativeChatFlow {
  public enum State {
    case loading, ready
    case unavailable(String)
    case quote(NativeChatInput, ProChatQuote)
    case running
    case result(String)
  }
  public private(set) var state: State = .loading
  public private(set) var source = AIPowerPreference.local
  public private(set) var messages: [NativeChatMessage] = []
  private var session: Session?
  private let local = NativeLocalText()
  private var byok: NativeBYOK?
  private var historyKey: String?
  private var context = ""
  private var operation: ProChatOperation?
  private var task: Task<Void, Never>?
  private var fixture:
    (@MainActor (NativeChatInput, @escaping @MainActor (String) -> Void) async throws -> String)?
  public init() {}
  public init(
    source: AIPowerPreference, messages: [NativeChatMessage], context: String = "",
    stream:
      @escaping @MainActor (NativeChatInput, @escaping @MainActor (String) -> Void) async throws ->
      String
  ) {
    self.source = source
    self.messages = messages
    self.context = context
    self.fixture = stream
    self.state = .ready
  }
  public func load(session: Session, document: String, context: String) async {
    let pending = task
    stop()
    await pending?.value
    messages = []
    historyKey = nil
    operation = nil
    byok = nil
    state = .loading
    self.session = session
    self.context = context
    do {
      async let identity = session.accountIdentity()
      async let preference = session.powerPreference()
      let (account, selected) = try await (identity, preference)
      source = selected
      let key = "chat-v1:" + account.id + ":" + document
      historyKey = key
      if let data = UserDefaults.standard.data(forKey: key), data.count <= 1_048_576 {
        try NativeCredentialGuard.shared.check(data)
        messages = try JSONDecoder().decode([NativeChatMessage].self, from: data)
      }
      switch source {
      case .local:
        let availability = local.availability(action: "chat")
        state = availability == .available ? .ready : .unavailable(availability.message)
      case .byok:
        byok = try await session.nativeAI()
        state = .unavailable(NativeChatError.unavailable.localizedDescription)
      case .pro:
        let capability = try await session.chatCapability()
        state = capability.available ? .ready : .unavailable(capability.reason)
      }
    } catch {
      state = .unavailable("Could not check chat availability. Saved history is preserved.")
    }
  }
  public func send(_ prompt: String, files: [NativeChatFile] = []) {
    guard task == nil else { return }
    let input = NativeChatInput(
      prompt: prompt, messages: messages.filter { !$0.content.isEmpty }, context: context,
      files: files)
    do { _ = try nativeChatPrepared(input) } catch {
      state = .result(NativeChatError.capability.localizedDescription)
      return
    }
    task = Task {
      defer { task = nil }
      if source == .pro, fixture == nil {
        do {
          guard let session else { throw NativeChatError.unavailable }
          state = .quote(input, try await session.quoteChat(input))
        } catch { state = .result(NativeChatError.unavailable.localizedDescription) }
      } else {
        await run(input)
      }
    }
  }
  public func accept() {
    guard case .quote(let input, let quote) = state, let session, task == nil else { return }
    state = .running
    task = Task {
      defer { task = nil }
      // Keep acceptance alive until its operation ID arrives, even if Stop is pressed.
      let submitted = Task {
        try await session.acceptChat(input, quote: quote, idempotencyKey: UUID().uuidString)
      }
      do {
        operation = try await submitted.value
        if Task.isCancelled, let operation {
          try? await session.cancelChat(operation.id)
          state = .result(NativeChatError.cancelled.localizedDescription)
          return
        }
        await run(input)
      } catch { state = .result(NativeChatError.uncertain.localizedDescription) }
    }
  }
  public func decline() { state = .ready }
  public func stop() {
    task?.cancel()
    local.cancel()
    byok?.cancel()
    if let session, let operation { Task { try? await session.cancelChat(operation.id) } }
    if case .quote = state { decline() }
  }
  private func save() throws {
    let data = try JSONEncoder().encode(messages)
    guard data.count <= 1_048_576 else { throw NativeChatError.capability }
    try NativeCredentialGuard.shared.check(data)
    if let historyKey { UserDefaults.standard.set(data, forKey: historyKey) }
  }
  private func run(_ input: NativeChatInput) async {
    state = .running
    messages.append(
      .init(
        role: "user",
        content: input.prompt
          + input.files.map { "\n\nAttachment \($0.name):\n\($0.text)" }.joined()))
    messages.append(.init(role: "assistant", content: ""))
    let index = messages.count - 1
    let update: @MainActor (String) -> Void = { text in
      guard !Task.isCancelled else { return }
      self.messages[index] = .init(role: "assistant", content: text)
    }
    do {
      let result: String
      if let fixture {
        result = try await fixture(input, update)
      } else {
        switch source {
        case .local: result = try await local.chat(input, onText: update)
        case .byok:
          guard let byok else { throw NativeChatError.unavailable }
          result = try await byok.chat(input, reference: byok.credentialReference(), onText: update)
        case .pro:
          guard let session, let operation else { throw NativeChatError.unavailable }
          let value = try await session.streamChat(
            input, operation: operation, onText: { text in await update(text) })
          result = value.result ?? ""
          self.operation = value
        }
      }
      try NativeCredentialGuard.shared.check(Data(result.utf8))
      messages[index] = .init(role: "assistant", content: result)
      try save()
      state = .ready
    } catch {
      // Preserve safe partial output and keep provider diagnostics out of saved conversation data.
      try? save()
      state = .result(
        Task.isCancelled
          ? NativeChatError.cancelled.localizedDescription
          : (error as? LocalTextError)?.localizedDescription
            ?? NativeChatError.uncertain.localizedDescription)
    }
  }
}

public struct NativeChatView: View {
  @Bindable private var flow: NativeChatFlow
  @State private var prompt = ""
  @State private var files: [NativeChatFile] = []
  @State private var importing = false
  @State private var fileMessage: String?
  public init(flow: NativeChatFlow) { self.flow = flow }
  public var body: some View {
    Form {
      Section("Chat · \(flow.source.rawValue)") {
        Text(
          "Saved conversation and document context are included. Text attachments only; images, PDF, audio and tools are unavailable. No automatic source fallback."
        )
        if flow.messages.isEmpty { Text("No saved conversation.") }
        ForEach(Array(flow.messages.enumerated()), id: \.offset) { _, message in
          Text("\(message.role): \(message.content)").accessibilityIdentifier("chat message")
        }
      }
      switch flow.state {
      case .loading: ProgressView("Checking chat...")
      case .unavailable(let message): Text(message)
      case .quote(_, let quote):
        Text("Maximum reservation: \(Double(quote.maximum)/1_000_000) credits.")
        Text(quote.policy)
        Button("Accept maximum") { flow.accept() }
        Button("Decline") { flow.decline() }
      case .running:
        ProgressView("Chat streaming...")
        Button("Stop") { flow.stop() }
      case .result(let message):
        Text(message)
        Button("Continue") { flow.decline() }
      case .ready:
        TextField("Ask about this document", text: $prompt, axis: .vertical)
          .accessibilityIdentifier("chat input")
        if let fileMessage { Text(fileMessage) }
        ForEach(Array(files.enumerated()), id: \.offset) { _, file in Text(file.name) }
        Button("Text attachment") { importing = true }
        Button("Send") { flow.send(prompt, files: files) }.disabled(
          fileMessage != nil || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
      }
    }.fileImporter(
      isPresented: $importing, allowedContentTypes: [.plainText, .text],
      allowsMultipleSelection: true
    ) { result in
      do {
        let urls = try result.get()
        guard urls.count <= 2 else { throw NativeChatError.capability }
        files = try urls.map { url in
          let access = url.startAccessingSecurityScopedResource()
          defer { if access { url.stopAccessingSecurityScopedResource() } }
          guard ["txt", "md"].contains(url.pathExtension.lowercased()),
            (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 1501) <= 1500
          else { throw NativeChatError.capability }
          let data = try Data(contentsOf: url)
          try NativeCredentialGuard.shared.check(data)
          guard data.count <= 1500, let text = String(data: data, encoding: .utf8) else {
            throw NativeChatError.capability
          }
          return NativeChatFile(
            name: url.lastPathComponent,
            type: url.pathExtension.lowercased() == "md" ? "text/markdown" : "text/plain",
            text: text)
        }
        fileMessage = nil
      } catch { fileMessage = NativeChatError.capability.localizedDescription }
    }.onDisappear { flow.stop() }
  }
}
