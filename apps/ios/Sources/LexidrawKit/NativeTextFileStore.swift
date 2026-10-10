import Foundation

/// The file adapter stores only a completed, bounded text result. JavaScript
/// has no path/file API and unfinished work is never represented as durable.
public struct NativeTextFileStore: Sendable {
  private let directory: URL
  private var file: URL { directory.appending(path: "last-suggestion.json") }
  private struct Record: Codable { let text: String }
  public init(directory: URL) { self.directory = directory }

  public func save(_ text: String) throws {
    guard text.utf8.count <= 16_384 else { throw NativeAIError.unavailable }
    let bytes = try JSONEncoder().encode(Record(text: text))
    try NativeCredentialGuard.shared.check(bytes)
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      var folder = directory
      var attributes = URLResourceValues()
      attributes.isExcludedFromBackup = true
      try folder.setResourceValues(attributes)
      #if os(iOS)
        try bytes.write(to: file, options: [.atomic, .completeFileProtection])
      #else
        try bytes.write(to: file, options: .atomic)
      #endif
    } catch { throw NativeAIError.unavailable }
  }

  public func load() throws -> String? {
    guard FileManager.default.fileExists(atPath: file.path) else { return nil }
    let bytes: Data
    do { bytes = try Data(contentsOf: file) }
    catch { throw NativeAIError.unavailable }
    guard bytes.count <= 1 << 17 else { throw NativeAIError.unavailable }
    try NativeCredentialGuard.shared.check(bytes)
    guard let record = try? JSONDecoder().decode(Record.self, from: bytes) else { throw NativeAIError.unavailable }
    return record.text
  }

  public func clear() throws {
    guard FileManager.default.fileExists(atPath: file.path) else { return }
    do { try FileManager.default.removeItem(at: file) }
    catch { throw NativeAIError.unavailable }
  }
}
