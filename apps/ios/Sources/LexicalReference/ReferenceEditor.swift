import Foundation
import JavaScriptCore
import LexicalSwift

/// The editor-model interface backed by headless JS Lexical with the web
/// editor's core node registry, running in JavaScriptCore. The differential
/// fuzzer's oracle, and the fallback model if LexicalSwift can't match it.
public final class ReferenceEditor: EditorModel {
  private let context: JSContext
  private let api: JSValue
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  /// `scriptURL` is the bundle `bun run build:reference` writes.
  public init(scriptURL: URL) throws {
    guard let context = JSContext() else { throw ReferenceError("Couldn't create a JSContext") }
    self.context = context
    // Lexical only needs these hosts' globals to exist; a timer would mean an
    // update escaped the synchronous path the model relies on.
    context.evaluateScript(
      """
      var console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
      function setTimeout() { throw new Error("setTimeout is not available to the reference"); }
      """)
    context.evaluateScript(try String(contentsOf: scriptURL, encoding: .utf8), withSourceURL: scriptURL)
    if let exception = context.exception {
      throw ReferenceError("The reference bundle failed to load: \(exception)")
    }
    guard let api = context.objectForKeyedSubscript("LexicalReference"), api.isObject else {
      throw ReferenceError("The reference bundle didn't define LexicalReference")
    }
    self.api = api
  }

  public func load(_ state: JSONValue) throws {
    _ = try call("load", String(decoding: try encoder.encode(state), as: UTF8.self))
  }

  @discardableResult
  public func apply(_ command: EditorCommand) throws -> ChangeSet {
    let result = try call("apply", String(decoding: try encoder.encode(command), as: UTF8.self))
    return try decoder.decode(ChangeSet.self, from: Data(result.utf8))
  }

  public func snapshot() throws -> Snapshot {
    try decoder.decode(Snapshot.self, from: Data(try call("snapshot").utf8))
  }

  private func call(_ name: String, _ argument: String? = nil) throws -> String {
    context.exception = nil
    let result = api.invokeMethod(name, withArguments: argument.map { [$0] } ?? [])
    if let exception = context.exception {
      context.exception = nil
      throw ReferenceError(exception.toString() ?? "\(exception)")
    }
    return result?.isString == true ? result?.toString() ?? "" : ""
  }
}

public struct ReferenceError: Error, CustomStringConvertible {
  public let description: String
  init(_ description: String) { self.description = description }
}
