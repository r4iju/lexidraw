import Foundation
import JavaScriptCore
import LexidrawJSON

/// The existing web's pure settings rules, evaluated once at document load.
/// Editing, font shaping, and layout remain native.
public struct DocumentSettings: Sendable, Decodable {
  public let language: String?
  public let fontFamily: String
  public let fontResource: String?
  public let text: String

  public init(state: JSONValue, appState: JSONValue?) throws {
    guard let context = JSContext() else {
      throw DocumentSettingsUnsupported("JavaScriptCore unavailable")
    }
    context.evaluateScript(documentSettingsScript)
    guard context.exception == nil else {
      throw DocumentSettingsUnsupported(context.exception?.toString() ?? "Settings bundle failed")
    }
    let arguments: [Any] = [state.stringified, appState?.stringified as Any? ?? NSNull()]
    let result = context.objectForKeyedSubscript("documentSettingsMetadata")?.call(
      withArguments: arguments)
    guard context.exception == nil, let json = result?.toString() else {
      throw DocumentSettingsUnsupported(
        context.exception?.toString() ?? "Settings were not returned")
    }
    self = try JSONDecoder().decode(Self.self, from: Data(json.utf8))
  }
}

public struct DocumentSettingsUnsupported: Error, LocalizedError, Sendable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? {
    "Document settings aren’t supported yet (#130): \(message)"
  }
}
