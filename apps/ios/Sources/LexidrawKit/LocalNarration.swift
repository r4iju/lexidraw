import CryptoKit
import Foundation
import LexidrawJSON

/// Text for Apple's device voices, never a synced cloud recording.
public struct LocalNarration: Sendable, Equatable {
  public let parts: [String]
  public let language: String?

  public func resumeID(file: String) -> String {
    let digest = SHA256.hash(
      data: Data((parts.joined(separator: "\n") + "\n" + (language ?? "")).utf8)
    )
    .map { String(format: "%02x", $0) }.joined()
    return "local.\(file).\(digest)"
  }

  public init(text: String, language: String?) throws {
    let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else {
      throw ListenFailed(message: "There is nothing in this document to read aloud.")
    }
    guard text.utf8.count <= 100_000 else {
      throw ListenFailed(
        message: "Built-in narration supports up to 100 KB of text. Listen to a shorter document.")
    }
    // Stable paragraph boundaries let a reopened document resume in the same part.
    parts = text.components(separatedBy: .newlines).filter {
      !$0.trimmingCharacters(in: .whitespaces).isEmpty
    }
    self.language = language
  }
}

public enum NarrationSource: Sendable {
  case local(LocalNarration)
  case saved(Recording)
}

extension Session {
  /// Resolve the account's choice before any generation. Nonlocal playback
  /// only opens existing audio; it cannot implicitly spend Pro credits.
  public func narration(of file: String, savedOnly: Bool = false) async throws -> NarrationSource {
    if !savedOnly, try await powerPreference() == .local {
      let entity = try await ask { try await $0.entitiesLoad(path: .init(id: file)) }.ok.body.json
      guard entity.entityType == .document else {
        throw ListenFailed(
          message:
            "Built-in narration reads documents. For a saved link, choose Play Saved Recording.")
      }
      let settings = try DocumentSettings(
        state: JSONValue(parsing: entity.elements),
        appState: try entity.appState.map { try JSONValue(parsing: $0) })
      return .local(try LocalNarration(text: settings.text, language: settings.language))
    }
    return .saved(
      try await recording(
        of: file,
        authorizeGeneration: {
          throw ListenFailed(
            message:
              "No saved recording. Choose Built-in local in AI Power for free iOS narration. Cloud generation is unavailable here."
          )
        }))
  }
}
