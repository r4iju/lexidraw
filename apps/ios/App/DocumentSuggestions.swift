import Foundation
import LexidrawKit
import SwiftUI
import TextKitEditor

@MainActor @Observable final class DocumentSuggestions {
  private(set) var enabled = false
  private(set) var message = "Writing suggestions off"
  private(set) var allowance: ProAllowance?
  private var local = NativeLocalText()
  private var byok: NativeBYOK?
  private weak var editor: EditorView?
  private var mode: AIPowerPreference = .local
  private var session: Session?
  private var title = ""
  private var locale = Locale.autoupdatingCurrent
  private var revision = UUID()

  func load(session: Session, editor: EditorView?, title: String, language: String) async {
    stop()
    let revision = revision
    self.session = session
    self.editor = editor
    self.title = title
    locale = Locale(identifier: language)
    do {
      async let selected = session.powerPreference()
      async let optedIn = session.writingSuggestionsEnabled()
      let mode = try await selected
      let enabled = try await optedIn
      let byok = mode == .byok ? try await session.nativeAI() : nil
      let allowance = mode == .pro ? try await session.proAllowance() : nil
      guard self.revision == revision, !Task.isCancelled else { return }
      self.mode = mode
      self.enabled = enabled
      self.byok = byok
      self.allowance = allowance
      configure()
    } catch {
      guard self.revision == revision, !Task.isCancelled else { return }
      enabled = false
      message = "Suggestions unavailable. Check AI Power."
    }
  }
  func setEnabled(_ value: Bool) async {
    guard let session else { return }
    stop()
    let revision = revision
    do {
      try await session.setWritingSuggestionsEnabled(value)
      guard self.revision == revision, !Task.isCancelled else { return }
      enabled = value
      configure()
    } catch { message = "Could not save writing suggestions." }
  }
  func stop() {
    revision = UUID()
    editor?.setWritingSuggestions(nil)
    local.cancel()
    byok?.cancel()
  }
  private func configure() {
    guard enabled else {
      message = "Writing suggestions off · opt in to use AI Power"
      return
    }
    switch mode {
    case .local:
      let availability = local.availability(locale: locale)
      guard availability == .available else {
        message = availability.message
        return
      }
      message = "On · Apple Intelligence · no Pro credits"
    case .byok:
      guard byok?.hasKey == true else {
        message = "Set up your key on this device in AI Power."
        return
      }
      message = "On · your provider key · no Pro credits"
    case .pro:
      guard allowance?.entitled == true else {
        message = "Pro Coming soon. Private allowance required."
        return
      }
      guard (allowance?.availableSubcredits ?? 0) >= 1_120_000 else {
        message = "Not enough allowance for another suggestion."
        return
      }
      message = "On · Pro suggestions metered in aggregate"
    }
    editor?.onWritingSuggestionStatus = { [weak self] status in self?.message = status }
    editor?.setWritingSuggestions { [weak self] input in
      guard let self, let session else { throw CancellationError() }
      switch mode {
      case .local:
        return try await local.suggest(
          title: title, before: input.before, after: input.after, locale: locale)
      case .byok:
        guard let byok else { throw NativeAIError.missingKey }
        return try await withTaskCancellationHandler {
          try await byok.suggest(title: title, before: input.before, after: input.after)
        } onCancel: {
          Task { @MainActor in byok.cancel() }
        }
      case .pro:
        do {
          let text = try await session.autocompletePro(
            title: title, before: input.before, after: input.after)
          allowance = try? await session.proAllowance()
          if (allowance?.availableSubcredits ?? 0) == 0 {
            message = "Allowance exhausted."
            return ""
          }
          return text
        } catch {
          allowance = try? await session.proAllowance()
          throw error
        }
      }
    }
  }
}
