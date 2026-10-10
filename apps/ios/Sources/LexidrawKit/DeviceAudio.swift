import Foundation
import JavaScriptCore

@MainActor func narrationContext() throws -> JSContext {
  guard let context = JSContext() else { throw NativeAIError.unavailable }
  let decode: @convention(block) (String) -> String? = { value in
    Data(base64Encoded: value).flatMap { String(data: $0, encoding: .isoLatin1) }
  }
  let encode: @convention(block) (String) -> String? = { value in
    value.data(using: .isoLatin1)?.base64EncodedString()
  }
  context.setObject(decode, forKeyedSubscript: "atob" as NSString)
  context.setObject(encode, forKeyedSubscript: "btoa" as NSString)
  context.evaluateScript(nativeGenerationScript)
  guard context.exception == nil else { throw NativeAIError.unavailable }
  return context
}
public struct DeviceAudio: Codable, Sendable {
  public let audio: String
  public let seconds: Double
  @MainActor public static func pcm(_ data: Data) throws -> Self {
    guard data.count <= 5_760_000 else { throw NativeAIError.rejected }
    try NativeCredentialGuard.shared.check(data)
    let context = try narrationContext()
    guard
      let output = context.objectForKeyedSubscript("nativeNarrationPCM")?.call(withArguments: [
        data.base64EncodedString()
      ])?.toString(), context.exception == nil
    else { throw NativeAIError.rejected }
    try NativeCredentialGuard.shared.check(Data(output.utf8))
    return try JSONDecoder().decode(Self.self, from: Data(output.utf8)).validated()
  }
  @MainActor public func validated() throws -> Self {
    try NativeCredentialGuard.shared.check(Data(audio.utf8))
    guard let bytes = Data(base64Encoded: audio) else { throw NativeAIError.rejected }
    try NativeCredentialGuard.shared.check(bytes)
    let context = try narrationContext()
    guard
      let output = context.objectForKeyedSubscript("nativeNarrationResult")?.call(withArguments: [
        audio
      ])?.toString(), context.exception == nil
    else { throw NativeAIError.rejected }
    let result = try JSONDecoder().decode(Self.self, from: Data(output.utf8))
    guard result.seconds == seconds else { throw NativeAIError.rejected }
    return result
  }
}
