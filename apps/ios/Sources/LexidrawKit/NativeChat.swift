import Foundation
import JavaScriptCore

public enum NativeChatError: Error, LocalizedError, Equatable, Sendable {
  case capability, unavailable, uncertain, cancelled
  public var errorDescription: String? {
    switch self {
    case .capability:
      "Chat supports bounded text conversations and text attachments. Choose fewer complete saved turns or an explicit document excerpt before sending. Images, PDF, audio and tools are unavailable. Saved history is preserved."
    case .unavailable:
      "Chat is unavailable for this AI Power source until provider streaming and bounds are verified. Saved history is preserved."
    case .uncertain:
      "Chat outcome is uncertain. No automatic repeat was performed. Check the existing operation."
    case .cancelled:
      "Chat stopped. An issued provider request may still be billed. No automatic repeat was performed."
    }
  }
}
public struct NativeChatMessage: Codable, Sendable, Equatable, Identifiable {
  public var id: String { role + ":" + content }
  public let role: String
  public let content: String
  public init(role: String, content: String) {
    self.role = role
    self.content = content
  }
}
public struct NativeChatFile: Codable, Sendable {
  public let name: String
  public let type: String
  public let text: String
  public init(name: String, type: String, text: String) {
    self.name = name
    self.type = type
    self.text = text
  }
}
public struct NativeChatInput: Codable, Sendable {
  public let prompt: String
  public let messages: [NativeChatMessage]
  public let context: String
  public let files: [NativeChatFile]
  public init(
    prompt: String, messages: [NativeChatMessage] = [], context: String = "",
    files: [NativeChatFile] = []
  ) {
    self.prompt = prompt
    self.messages = messages
    self.context = context
    self.files = files
  }
}
@MainActor func nativeChatPrepared(_ input: NativeChatInput, local: Bool = false) throws -> String {
  let data = try JSONEncoder().encode(input)
  try NativeCredentialGuard.shared.check(data)
  guard let context = JSContext() else { throw NativeChatError.unavailable }
  context.evaluateScript(nativeGenerationScript)
  guard
    let request = context.objectForKeyedSubscript(
      local ? "nativeLocalChatRequest" : "nativeChatRequest")?.call(withArguments: [
        String(decoding: data, as: UTF8.self)
      ])?.toString(), context.exception == nil
  else { throw NativeChatError.capability }
  try NativeCredentialGuard.shared.check(Data(request.utf8))
  return request
}

public enum NativeChatPreparation {
  case ready(NativeChatInput, String)
  case needsSelection(String)
}
@MainActor func nativeChatSelection(_ source: NativeChatInput, turnIndices: [Int], documentExcerpt: String) throws -> NativeChatPreparation {
  struct Turn: Encodable { let id: String; let role: String; let content: String }
  struct Source: Encodable { let prompt: String; let messages: [Turn]; let context: String; let files: [NativeChatFile] }
  struct Choice: Encodable { let turnIds: [String]; let documentExcerpt: String }
  struct Result: Decodable { let kind: String; let input: NativeChatInput?; let summary: String?; let message: String? }
  let full = Source(prompt: source.prompt, messages: source.messages.enumerated().map { Turn(id: String($0.offset), role: $0.element.role, content: $0.element.content) }, context: source.context, files: source.files)
  let data = try JSONEncoder().encode(full)
  try NativeCredentialGuard.shared.check(data)
  let choice = try JSONEncoder().encode(Choice(turnIds: turnIndices.map(String.init), documentExcerpt: documentExcerpt))
  guard let runtime = JSContext() else { throw NativeChatError.unavailable }
  runtime.evaluateScript(nativeGenerationScript)
  guard let json = runtime.objectForKeyedSubscript("nativeChatSelection")?.call(withArguments: [String(decoding: data, as: UTF8.self), String(decoding: choice, as: UTF8.self)])?.toString(), runtime.exception == nil else { throw NativeChatError.capability }
  try NativeCredentialGuard.shared.check(Data(json.utf8))
  let result = try JSONDecoder().decode(Result.self, from: Data(json.utf8))
  if result.kind == "ready", let input = result.input, let summary = result.summary {
    _ = try nativeChatPrepared(input)
    return .ready(input, summary)
  }
  if result.kind == "needs_selection", let message = result.message { return .needsSelection(message) }
  throw NativeChatError.capability
}
