import Foundation
import JavaScriptCore
import ImageIO

public enum NativeImageError: Error, LocalizedError, Sendable {
  case unavailable, invalid, syncFailed, reconciling, uploadExpired
  public var errorDescription: String? {
    switch self {
    case .uploadExpired: "Upload expired. Retry the retained image without regeneration."
    case .unavailable: "Image generation is unavailable until account access, parameters, pricing and direct transport are verified. Local AI does not support images."
    case .invalid: "The image or prompt did not meet the bounded image contract."
    case .syncFailed: "Image completed but sync failed. Retry upload without regenerating or paying again."
    case .reconciling: "Image generation is reconciling. Credits remain reserved. Check Pro history before a new action."
    }
  }
}
public struct NativeImageArtifact: Codable, Sendable {
  public let mimeType: String
  public let width: Int
  public let height: Int
  public let base64: String
  public var bytes: Data { Data(base64Encoded: base64) ?? Data() }
  @MainActor public init(base64: String) throws {
    guard let bytes = Data(base64Encoded: base64), bytes.count <= 2 << 20 else { throw NativeImageError.invalid }
    try NativeCredentialGuard.shared.check(bytes)
    try NativeCredentialGuard.shared.check(Data(base64.utf8))
    guard let context = JSContext() else { throw NativeImageError.invalid }
    let decode: @convention(block) (String) -> String? = { value in
      guard let data = Data(base64Encoded: value) else { return nil }
      return String(data: data, encoding: .isoLatin1)
    }
    context.setObject(decode, forKeyedSubscript: "atob" as NSString)
    context.evaluateScript(nativeGenerationScript)
    guard let validated = context.objectForKeyedSubscript("nativeImageResult")?.call(withArguments: [base64])?.toString(), context.exception == nil else { throw NativeImageError.invalid }
    guard let source = CGImageSourceCreateWithData(bytes as CFData, nil), CGImageSourceGetCount(source) == 1,
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil), image.width == 1024, image.height == 1024 else { throw NativeImageError.invalid }
    self = try JSONDecoder().decode(Self.self, from: Data(validated.utf8))
  }
  @MainActor public func validated() throws -> NativeImageArtifact {
    guard mimeType == "image/png", width == 1024, height == 1024 else { throw NativeImageError.invalid }
    return try NativeImageArtifact(base64: base64)
  }
}
@MainActor public struct NativeImageFileStore {
  private let directory: URL
  private var file: URL { directory.appending(path: "completed-image.json") }
  public init(directory: URL) { self.directory = directory }
  public func save(_ artifact: NativeImageArtifact) throws {
    let data = try JSONEncoder().encode(artifact.validated())
    try NativeCredentialGuard.shared.check(data)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var folder = directory
    var attributes = URLResourceValues(); attributes.isExcludedFromBackup = true
    try folder.setResourceValues(attributes)
    #if os(iOS)
      try data.write(to: file, options: [.atomic, .completeFileProtection])
    #else
      try data.write(to: file, options: .atomic)
    #endif
  }
  public func load() throws -> NativeImageArtifact? {
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    let data = try Data(contentsOf: file)
    guard data.count <= 3 << 20 else { throw NativeImageError.invalid }
    try NativeCredentialGuard.shared.check(data)
    return try JSONDecoder().decode(NativeImageArtifact.self, from: data).validated()
  }
  public func clear() throws { if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) } }
}
