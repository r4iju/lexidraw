import Foundation
import JavaScriptCore

public enum NativeChatError: Error, LocalizedError, Equatable, Sendable {
  case capability, unavailable, uncertain, cancelled
  public var errorDescription: String? {
    switch self {
    case .capability:
      "Chat supports bounded text conversations and text attachments. Shorten the history or document context. Images, PDF, audio and tools are unavailable. Saved history is preserved."
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
