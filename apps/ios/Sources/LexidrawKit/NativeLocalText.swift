import Foundation
import FoundationModels
import JavaScriptCore

public enum LocalTextAvailability: Equatable, Sendable {
  case available
  case unsupportedOS, deviceNotEligible, intelligenceDisabled, modelNotReady
  case unsupportedLanguage, unsupportedAction

  public var message: String {
    switch self {
    case .available: "Apple Intelligence text is available on this device."
    case .unsupportedOS: "Local text requires iOS 26 or later."
    case .deviceNotEligible: "This device does not support Apple Intelligence text."
    case .intelligenceDisabled: "Apple Intelligence is not enabled on this device."
    case .modelNotReady:
      "The Apple Intelligence text model is not ready or downloaded. Check Apple Intelligence in Settings."
    case .unsupportedLanguage: "Apple Intelligence text does not support this language or locale."
    case .unsupportedAction:
      "This action is unavailable locally. Only short text continuations are supported here."
    }
  }
}

public enum LocalTextError: Error, LocalizedError, Equatable, Sendable {
  case unavailable(LocalTextAvailability)
  case contextLimit, cancelled, refused, failed
  public var errorDescription: String? {
    switch self {
    case .unavailable(let reason): reason.message
    case .contextLimit:
      "This text exceeds the local model’s context limit. Try a shorter selection."
    case .cancelled: "Local text stopped. No cloud request or Pro charge was made."
    case .refused: "Apple Intelligence could not provide this continuation. Try different text."
    case .failed: "Local text could not complete. Try again."
    }
  }
}

public struct LocalTextRequest: Sendable, Decodable {
  public let system: String
  public let prompt: String
  public let maximumResponseTokens: Int
}

@MainActor public protocol LocalTextModel {
  func availability(locale: Locale) -> LocalTextAvailability
  func respond(_ request: LocalTextRequest) async throws -> String
}

/// This adapter owns no credential, HTTP transport, persistence or credit ledger.
@MainActor public final class NativeLocalText {
  private let model: any LocalTextModel
  private var generation = UUID()
  private var tasks: [UUID: Task<String, Error>] = [:]
  public convenience init() { self.init(model: AppleLocalTextModel()) }
  public func cancel() {
    generation = UUID()
    for task in tasks.values { task.cancel() }
    tasks.removeAll()
  }
  public init(model: any LocalTextModel) { self.model = model }
  public func availability(action: String = "autocomplete", locale: Locale = .autoupdatingCurrent)
    -> LocalTextAvailability
  {
    guard action == "autocomplete" else { return .unsupportedAction }
    return model.availability(locale: locale)
  }
  public func suggest(
    title: String, before: String, after: String, locale: Locale = .autoupdatingCurrent
  ) async throws -> String {
    guard !Task.isCancelled else { throw LocalTextError.cancelled }
    let status = availability(locale: locale)
    guard status == .available else { throw LocalTextError.unavailable(status) }
    guard let context = JSContext() else { throw LocalTextError.failed }
    context.evaluateScript(nativeGenerationScript)
    for text in [title, before, after] { try NativeCredentialGuard.shared.check(Data(text.utf8)) }
    guard
      let json = context.objectForKeyedSubscript("nativeLocalAutocompleteRequest")?
        .call(withArguments: [title, before, after])?.toString(), context.exception == nil,
      let request = try? JSONDecoder().decode(LocalTextRequest.self, from: Data(json.utf8))
    else { throw LocalTextError.failed }
    let id = UUID()
    let startedGeneration = generation
    let response = Task { try await model.respond(request) }
    tasks[id] = response
    defer { tasks.removeValue(forKey: id) }
    let content: String
    do {
      content = try await withTaskCancellationHandler {
        try await response.value
      } onCancel: {
        response.cancel()
      }
      guard !Task.isCancelled, !response.isCancelled, generation == startedGeneration else {
        throw LocalTextError.cancelled
      }
    } catch {
      if Task.isCancelled || response.isCancelled || generation != startedGeneration {
        throw LocalTextError.cancelled
      }
      throw localTextError(error)
    }
    try NativeCredentialGuard.shared.check(Data(content.utf8))
    guard
      let output = context.objectForKeyedSubscript("nativeLocalAutocompleteResult")?
        .call(withArguments: [before, content])?.toString(), context.exception == nil
    else { throw LocalTextError.failed }
    try NativeCredentialGuard.shared.check(Data(output.utf8))
    return output
  }
}

@MainActor public final class AppleLocalTextModel: LocalTextModel {
  public init() {}
  public func availability(locale: Locale) -> LocalTextAvailability {
    guard #available(iOS 26, macOS 26, *) else { return .unsupportedOS }
    let model = SystemLanguageModel.default
    switch model.availability {
    case .unavailable(.deviceNotEligible): return .deviceNotEligible
    case .unavailable(.appleIntelligenceNotEnabled): return .intelligenceDisabled
    case .unavailable(.modelNotReady): return .modelNotReady
    case .available: return model.supportsLocale(locale) ? .available : .unsupportedLanguage
    @unknown default: return .modelNotReady
    }
  }
  public func respond(_ request: LocalTextRequest) async throws -> String {
    guard #available(iOS 26, macOS 26, *) else { throw LocalTextError.unavailable(.unsupportedOS) }
    // An ephemeral session bounds context and prevents previous requests leaking into suggestions.
    // SystemLanguageModel is on-device; no PrivateCloudCompute model or tools are supplied.
    let session = LanguageModelSession(
      model: SystemLanguageModel.default, instructions: request.system)
    return try await session.respond(
      to: request.prompt,
      options: GenerationOptions(
        temperature: 0, maximumResponseTokens: request.maximumResponseTokens)
    ).content
  }
}

private func localTextError(_ error: any Error) -> LocalTextError {
  if let error = error as? LocalTextError { return error }
  if error is CancellationError { return .cancelled }
  if #available(iOS 27, macOS 27, *) {
    if let error = error as? LanguageModelError {
      switch error {
      case .contextSizeExceeded: return .contextLimit
      case .unsupportedLanguageOrLocale: return .unavailable(.unsupportedLanguage)
      case .unsupportedCapability, .unsupportedGenerationGuide:
        return .unavailable(.unsupportedAction)
      case .guardrailViolation, .refusal: return .refused
      default: return .failed
      }
    }
    if error is SystemLanguageModel.Error { return .unavailable(.modelNotReady) }
  }
  if #available(iOS 26, macOS 26, *), let error = error as? LanguageModelSession.GenerationError {
    switch error {
    case .exceededContextWindowSize: return .contextLimit
    case .assetsUnavailable: return .unavailable(.modelNotReady)
    case .unsupportedLanguageOrLocale: return .unavailable(.unsupportedLanguage)
    case .unsupportedGuide: return .unavailable(.unsupportedAction)
    case .guardrailViolation, .refusal: return .refused
    default: return .failed
    }
  }
  return .failed
}
