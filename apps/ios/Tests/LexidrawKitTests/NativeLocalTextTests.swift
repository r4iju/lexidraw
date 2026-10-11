import Foundation
import FoundationModels
import Testing

@testable import LexidrawKit

@MainActor struct NativeLocalTextTests {
  @Test func supportedContinuationUsesSharedFragmentContractWithoutCredentials() async throws {
    let model = LocalModelFixture()
    let runtime = NativeLocalText(model: model)
    #expect(runtime.availability() == .available)
    let output = try await runtime.suggest(title: "Garden", before: "We planted sun", after: "")
    #expect(output == "flowers today.")
    #expect(model.request?.system.contains("<cursor/>") == true)
    #expect(model.request?.prompt.contains("<fragment>sun</fragment>") == true)
    #expect(model.request?.maximumResponseTokens == 32)
  }
  @Test func continuationDoesNotRepeatFragmentClippedByLocalContextBudget() async throws {
    let model = LocalModelFixture()
    model.output = String(repeating: "x", count: 1200) + "done"
    let runtime = NativeLocalText(model: model)
    let output = try await runtime.suggest(
      title: "", before: String(repeating: "x", count: 1300), after: "")
    #expect(output == "done")
  }
  @Test func unicodeBoundaryWindowsDecodeAndFinishWithoutSplitScalars() async throws {
    let model = LocalModelFixture()
    let suffix = String(repeating: "x", count: 1199)
    model.output = suffix + "done"
    let runtime = NativeLocalText(model: model)
    let output = try await runtime.suggest(
      title: String(repeating: "a", count: 199) + "😀tail",
      before: "😀" + suffix,
      after: String(repeating: "z", count: 299) + "😀tail")
    #expect(output == "done")
    #expect(model.request?.prompt ==
      "Document title: " + String(repeating: "a", count: 199) + "\n\n" + suffix
      + "<cursor/>" + String(repeating: "z", count: 299) + "\n\n<fragment>" + suffix + "</fragment>")
    #expect(model.request?.maximumResponseTokens == 32)
  }
  @Test func credentialInLocalModelResultIsBlockedBeforeFragmentCleanup() async throws {
    let credential = "sk-local-boundary-282-distinct-fixture"
    try NativeCredentialGuard.shared.remember(credential)
    let model = LocalModelFixture()
    model.output = credential
    let runtime = NativeLocalText(model: model)
    // Fragment cleanup would remove "sk" and conceal a credential from a late-only check.
    await #expect(throws: NativeAIError.self) {
      try await runtime.suggest(title: "", before: "sk", after: "")
    }
  }

  @Test(arguments: [
    LocalTextAvailability.unsupportedOS, .deviceNotEligible,
    .intelligenceDisabled, .modelNotReady, .unsupportedLanguage, .unsupportedAction,
  ])
  func unavailableCapabilityNeverStartsModel(reason: LocalTextAvailability) async throws {
    let model = LocalModelFixture()
    model.status = reason
    let runtime = NativeLocalText(model: model)
    #expect(runtime.availability() == reason)
    await #expect(throws: LocalTextError.unavailable(reason)) {
      try await runtime.suggest(title: "", before: "Hello ", after: "")
    }
    #expect(model.request == nil)
  }
  @Test func contextLimitDoesNotReturnOrRetryResult() async {
    guard #available(macOS 26, iOS 26, *) else { return }
    let model = LocalModelFixture()
    model.failure = LanguageModelSession.GenerationError.exceededContextWindowSize(
      .init(debugDescription: "fixture"))
    let runtime = NativeLocalText(model: model)
    await #expect(throws: LocalTextError.contextLimit) {
      try await runtime.suggest(title: "", before: "Hello ", after: "")
    }
    #expect(model.responses == 1)
  }
  @Test func cancellationDiscardsUncooperativeModelResult() async throws {
    let model = LocalModelFixture()
    model.hold = true
    let runtime = NativeLocalText(model: model)
    let operation = Task { try await runtime.suggest(title: "", before: "Hello ", after: "") }
    while model.pending == nil { await Task.yield() }
    runtime.cancel()
    model.pending?.resume(returning: "world.")
    await #expect(throws: LocalTextError.cancelled) { try await operation.value }
  }

}

@MainActor private final class LocalModelFixture: LocalTextModel {
  var status = LocalTextAvailability.available
  var failure: (any Error)?
  var output = "sunflowers today."
  var responses = 0
  var hold = false
  var pending: CheckedContinuation<String, Never>?
  var request: LocalTextRequest?
  func availability(locale: Locale) -> LocalTextAvailability { status }
  func respond(_ request: LocalTextRequest) async throws -> String {
    self.request = request
    responses += 1
    if let failure { throw failure }
    if hold { return await withCheckedContinuation { pending = $0 } }
    return output
  }
}
