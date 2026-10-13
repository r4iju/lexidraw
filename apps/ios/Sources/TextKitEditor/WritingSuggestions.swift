#if canImport(UIKit)
  import UIKit

  public struct WritingSuggestionInput: Equatable, Sendable {
    public let before: String
    public let after: String
    public let offset: Int
  }

  @MainActor final class WritingSuggestions {
    private static var outstanding: (id: UUID, task: Task<Void, Never>)?
    private static var nextAllowedAt = -Double.infinity
    weak var editor: EditorView?
    let generate: @MainActor (WritingSuggestionInput) async throws -> String
    let delay: Double
    let interval: Double
    var input: WritingSuggestionInput?
    var suggestion: String?
    private var pending: Task<Void, Never>?
    private var request: Task<Void, Never>?
    private var revision = UUID()
    private var disposed = false
    private var button: UIButton?

    init(
      editor: EditorView, delay: Double, interval: Double,
      generate: @escaping @MainActor (WritingSuggestionInput) async throws -> String
    ) {
      self.editor = editor
      self.delay = delay
      self.interval = interval
      self.generate = generate
    }
    func stop() {
      disposed = true
      revision = UUID()
      pending?.cancel()
      request?.cancel()
      hide()
    }
    private func hide() {
      suggestion = nil
      button?.removeFromSuperview()
      button = nil
    }
    func refresh() {
      guard !disposed else { return }
      let next = editor?.writingSuggestionInput()
      guard next != input else { return }
      revision = UUID()
      pending?.cancel()
      request?.cancel()
      hide()
      input = next
      schedule()
    }
    private func schedule() {
      guard request == nil, let input, !disposed else { return }
      let revision = revision
      let wait = max(
        delay,
        interval
          - (ProcessInfo.processInfo.systemUptime
            - (editor?.writingSuggestionLastStarted ?? -Double.infinity)))
      pending = Task { [weak self] in
        try? await Task.sleep(for: .seconds(max(0, wait)))
        guard let self else { return }
        while true {
          guard !Task.isCancelled, self.revision == revision, !self.disposed else { return }
          if let previous = Self.outstanding {
            await previous.task.value
            continue
          }
          let remaining =
            interval == 0 ? 0 : Self.nextAllowedAt - ProcessInfo.processInfo.systemUptime
          if remaining > 0 {
            try? await Task.sleep(for: .seconds(remaining))
            continue
          }
          break
        }
        self.editor?.writingSuggestionLastStarted = ProcessInfo.processInfo.systemUptime
        Self.nextAllowedAt = ProcessInfo.processInfo.systemUptime + interval
        let requestID = UUID()
        self.request = Task { [weak self] in
          defer {
            if WritingSuggestions.outstanding?.id == requestID {
              WritingSuggestions.outstanding = nil
            }
          }
          guard let self else { return }
          do {
            let result = try await generate(input)
            if !Task.isCancelled, !disposed, self.revision == revision,
              editor?.writingSuggestionInput() == input, !result.isEmpty
            {
              suggestion = String(
                result.prefix(512).split(separator: "\n", maxSplits: 1).first ?? "")
              show()
            }
          } catch {
            if !Task.isCancelled { editor?.onWritingSuggestionStatus?(error.localizedDescription) }
          }
          request = nil
          if editor?.writingSuggestionRequest?.id == requestID {
            editor?.writingSuggestionRequest = nil
          }
          if self.revision != revision { schedule() }
        }
        if let request {
          editor?.writingSuggestionRequest = (requestID, request)
          Self.outstanding = (requestID, request)
        }
      }
    }
    private func show() {
      guard let editor, let suggestion else { return }
      let button = UIButton(type: .system)
      var configuration = UIButton.Configuration.tinted()
      configuration.title = "Accept: " + suggestion
      configuration.cornerStyle = .medium
      button.configuration = configuration
      button.accessibilityIdentifier = "accept-writing-suggestion"
      button.accessibilityLabel = "Accept suggestion: " + suggestion
      button.addAction(UIAction { [weak self] _ in _ = self?.accept() }, for: .touchUpInside)
      guard let selection = editor.selectedTextRange else { return }
      let caret = editor.caretRect(for: selection.end)
      let below = caret.maxY + 24
      let y = below + 48 <= editor.bounds.maxY ? below : max(editor.bounds.minY, caret.minY - 56)
      button.frame = CGRect(
        x: editor.bounds.minX + 12, y: y,
        width: max(0, min(editor.bounds.width - 24, 500)), height: 48)
      editor.addSubview(button)
      self.button = button
    }
    func accept() -> Bool {
      guard let editor, let input, let suggestion, editor.writingSuggestionInput() == input else {
        return false
      }
      revision = UUID()
      pending?.cancel()
      request?.cancel()
      hide()
      editor.insertText(suggestion)
      return true
    }
  }
#endif
