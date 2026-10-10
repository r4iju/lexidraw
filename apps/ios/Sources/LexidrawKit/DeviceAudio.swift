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
    try NativeCredentialGuard.shared.checkPCM(data)
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

// Recognize only the same fixed uncompressed container emitted by the shared audio adapter.
enum NativeAudioFormat {
  static func isCanonicalWAV(_ data: Data) -> Bool {
    guard data.count >= 46, data.count <= 5_760_044, (data.count - 44) % 2 == 0 else { return false }
    func word(_ offset: Int, _ count: Int) -> Int {
      (0..<count).reduce(0) { $0 | Int(data[data.startIndex + offset + $1]) << ($1 * 8) }
    }
    func tag(_ offset: Int, _ text: String) -> Bool {
      data[(data.startIndex + offset)..<(data.startIndex + offset + 4)] == Data(text.utf8)
    }
    return tag(0, "RIFF") && word(4, 4) == data.count - 8 && tag(8, "WAVE")
      && tag(12, "fmt ") && word(16, 4) == 16 && word(20, 2) == 1 && word(22, 2) == 1
      && word(24, 4) == 24_000 && word(28, 4) == 48_000 && word(32, 2) == 2
      && word(34, 2) == 16 && tag(36, "data") && word(40, 4) == data.count - 44
  }
}
