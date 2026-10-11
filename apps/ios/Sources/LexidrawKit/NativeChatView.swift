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
  public private(set) var unscopedOperations: [ProChatOperation] = []
  public private(set) var ownedOperations: [ProChatOperation] = []
  public private(set) var ownedReadState: ProReadState = .current
  public private(set) var cancellationUnconfirmed: Set<String> = []
  private var document: String?
  private var session: Session?
  private let local: NativeLocalText
  private var byok: NativeBYOK?
  private var historyKey: String?
  private var context = ""
  private var operation: ProChatOperation?
  private var task: Task<Void, Never>?
  private var stopRequested = false
  // Retained only in this scoped client. A read failure cannot authorize a replacement submission.
  private var pendingAcceptance: (input: NativeChatInput, key: String, document: String, scope: ObjectIdentifier)?
  private var fixture:
    (@MainActor (NativeChatInput, @escaping @MainActor (String) -> Void) async throws -> String)?
  public init(local: NativeLocalText = NativeLocalText()) { self.local = local }
  public init(
    source: AIPowerPreference, messages: [NativeChatMessage], context: String = "",
    stream:
      @escaping @MainActor (NativeChatInput, @escaping @MainActor (String) -> Void) async throws ->
      String
  ) {
    self.local = NativeLocalText()
    self.source = source
    self.messages = messages
    self.context = context
    self.fixture = stream
    self.state = .ready
  }
  public func load(session: Session, document: String, context: String) async {
    let pending = task
    detach()
    await pending?.value
    messages = []
    historyKey = nil
    operation = nil
    ownedOperations = []
    unscopedOperations = []
    cancellationUnconfirmed = []
    ownedReadState = .loading
    if self.document != document || self.session?.scopeID != session.scopeID { pendingAcceptance = nil }
    self.document = document
    byok = nil
    state = .loading
    self.session = session
    self.context = context
    do {
      let account = try await session.accountIdentity()
      guard self.document == document, self.session?.scopeID == session.scopeID else { return }
      await refreshOwnedChats()
      let selected = try await session.powerPreference()
      guard self.document == document, self.session?.scopeID == session.scopeID else { return }
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
        let runtime = try await session.nativeAI()
        guard self.document == document, self.session?.scopeID == session.scopeID else { return }
        byok = runtime
        state = .unavailable(NativeChatError.unavailable.localizedDescription)
      case .pro:
        let capability = try await session.chatCapability()
        guard self.document == document, self.session?.scopeID == session.scopeID else { return }
        state = capability.available ? .ready : .unavailable(capability.reason)
      }
    } catch {
      guard self.document == document, self.session?.scopeID == session.scopeID else { return }
      state = .unavailable("Could not check chat availability. Saved history is preserved.")
    }
  }
  public func send(_ prompt: String, files: [NativeChatFile] = []) {
    guard task == nil else { return }
    if source == .pro && (pendingAcceptance != nil || (fixture == nil && (ownedReadState != .current || (ownedOperations + unscopedOperations).contains(where: { [.reserved, .running, .unknown].contains($0.state) })))) { return }
    stopRequested = false
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
    guard let document else { return }
    let key = UUID().uuidString
    pendingAcceptance = (input, key, document, session.scopeID)
    stopRequested = false
    state = .running
    task = Task {
      defer { task = nil }
      // Keep acceptance alive until its operation ID arrives, even if Stop is pressed.
      let submitted = Task {
        try await session.acceptChat(input, quote: quote, idempotencyKey: key, document: document)
      }
      do {
        let accepted = try await submitted.value
        guard self.document == document, self.session?.scopeID == session.scopeID else { return }
        operation = accepted
        pendingAcceptance = nil
        if let operation { ownedOperations = [operation] + ownedOperations.filter { $0.id != operation.id } }
        if Task.isCancelled, let operation {
          if stopRequested { await cancelOwnedChat(operation.id) }
          state = .result(NativeChatError.cancelled.localizedDescription)
          return
        }
        await run(input)
      } catch {
        guard self.document == document, self.session?.scopeID == session.scopeID else { return }
        ownedReadState = .stale("Acceptance could not be confirmed. Refresh owned chat status before starting another turn.")
        state = .result(NativeChatError.uncertain.localizedDescription)
      }
    }
  }
  public func decline() { state = .ready }
  /// Drops this client's request when the surface is left. An accepted Pro operation keeps settling on the server.
  public func detach() {
    task?.cancel()
    local.cancel()
    byok?.cancel()
    if case .quote = state { decline() }
  }
  /// The explicit Stop: also cancels an accepted Pro operation under its disclosed policy.
  public func stop() {
    stopRequested = true
    detach()
    if let operation { Task { await cancelOwnedChat(operation.id) } }
    else if task == nil {
      for owned in ownedOperations where [.reserved, .running, .unknown].contains(owned.state) { Task { await cancelOwnedChat(owned.id) } }
      for owned in unscopedOperations where [.reserved, .running, .unknown].contains(owned.state) { Task { await cancelUnscopedChat(owned.id) } }
    }
  }
  public func refreshOwnedChats() async {
    guard let session, let document else { return }
    ownedReadState = .loading
    do {
      _ = try session.aiHandle.existing()
      let values = try await session.ownedChats(document: document)
      _ = try session.aiHandle.existing()
      guard self.document == document, self.session?.scopeID == session.scopeID else { return }
      ownedOperations = values
      ownedReadState = .current
      if let pending = pendingAcceptance {
        do {
          let recovered = try await session.recoverChat(pending.input, idempotencyKey: pending.key, document: pending.document)
          guard self.document == document, self.session?.scopeID == pending.scope else { return }
          ownedOperations = [recovered] + ownedOperations.filter { $0.id != recovered.id }
          pendingAcceptance = nil
          if stopRequested && [.reserved, .running, .unknown].contains(recovered.state) { await cancelOwnedChat(recovered.id) }
        } catch {
          guard self.document == document, self.session?.scopeID == pending.scope else { return }
          ownedReadState = .stale("Acceptance is still unconfirmed. Retry this owned read; another turn cannot be submitted.")
        }
      }
      cancellationUnconfirmed = cancellationUnconfirmed.filter { id in (values + unscopedOperations).contains { $0.id == id && [.reserved, .running, .unknown].contains($0.state) } }
    } catch {
      guard self.document == document, self.session?.scopeID == session.scopeID else { return }
      if proAccessDenied(error) { ownedOperations = []; ownedReadState = .denied }
      else { ownedReadState = .stale("Owned chat status could not be loaded. Retained status may be out of date. Retry the read without starting another turn.") }
    }
    do {
      let values = try await session.unscopedChats()
      _ = try session.aiHandle.existing()
      guard self.document == document, self.session?.scopeID == session.scopeID else { return }
      unscopedOperations = values
    } catch {
      guard self.document == document, self.session?.scopeID == session.scopeID else { return }
      if proAccessDenied(error) { unscopedOperations = [] }
      ownedReadState = .stale("Earlier account chat status could not be read. Retry without starting another turn.")
    }
  }
  public func cancelUnscopedChat(_ id: String) async {
    guard let session, let document, unscopedOperations.contains(where: { $0.id == id }) else { return }
    cancellationUnconfirmed.insert(id)
    do {
      let updated = try await Task { try await session.cancelUnscopedChat(id) }.value
      _ = try session.aiHandle.existing()
      guard self.document == document, self.session?.scopeID == session.scopeID else { return }
      guard updated.id == id else { throw NativeChatError.uncertain }
      unscopedOperations = unscopedOperations.map { $0.id == id ? updated : $0 }
      if ![.reserved, .running, .unknown].contains(updated.state) { cancellationUnconfirmed.remove(id) }
    } catch {
      guard self.document == document, self.session?.scopeID == session.scopeID else { return }
      ownedReadState = .stale("Account chat cancellation is not confirmed. Refresh status.") }
  }
  public func cancelOwnedChat(_ id: String) async {
    guard let session, let document, ownedOperations.contains(where: { $0.id == id }) else { return }
    cancellationUnconfirmed.insert(id)
    do {
      let updated = try await Task { try await session.cancelOwnedChat(document: document, id: id) }.value
      _ = try session.aiHandle.existing()
      guard self.document == document, self.session?.scopeID == session.scopeID else { return }
      guard updated.id == id else { throw NativeChatError.uncertain }
      ownedOperations = ownedOperations.map { $0.id == id ? updated : $0 }
      if ![.reserved, .running, .unknown].contains(updated.state) { cancellationUnconfirmed.remove(id) }
      ownedReadState = .current
    } catch {
      guard self.document == document, self.session?.scopeID == session.scopeID else { return }
      ownedReadState = .stale("Cancellation is not confirmed. Further work may still be running. Refresh owned chat status.") }
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
          ownedOperations = ownedOperations.map { $0.id == value.id ? value : $0 }
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
      Section("Owned Pro chats") {
        switch flow.ownedReadState {
        case .current: if flow.ownedOperations.isEmpty { Text("No owned Pro chat operation.") }
        case .loading: Text("Checking owned chat status...")
        case .stale(let message): Text(message); Button("Retry owned chat read") { Task { await flow.refreshOwnedChats() } }
        case .denied: Text("Owned chat access is unavailable.")
        }
        ForEach(flow.ownedOperations, id: \.id) { operation in
          Text("Chat: \(operation.state.rawValue). Charged \(Double(operation.charged)/1_000_000) credits.")
          if let text = operation.result { Text(text) }
          if flow.cancellationUnconfirmed.contains(operation.id) { Text("Cancellation is not confirmed. Further work may still be running.") }
          if [.reserved, .running, .unknown].contains(operation.state) { Button("Cancel owned chat") { Task { await flow.cancelOwnedChat(operation.id) } } }
        }
        if !flow.unscopedOperations.isEmpty {
          Text("Earlier account Pro chats have no recorded document identity.")
          ForEach(flow.unscopedOperations, id: \.id) { operation in
            Text("Account chat: \(operation.state.rawValue).")
            if let text = operation.result { Text(text) }
            if flow.cancellationUnconfirmed.contains(operation.id) { Text("Account chat cancellation is not confirmed. Further work may still be running.") }
            if [.reserved, .running, .unknown].contains(operation.state) { Button("Cancel account chat") { Task { await flow.cancelUnscopedChat(operation.id) } } }
          }
        }
        Button("Refresh owned chats") { Task { await flow.refreshOwnedChats() } }
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
    }.onDisappear { flow.detach() }
  }
}
