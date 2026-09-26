import Foundation
import JavaScriptCore
import LexicalSwift

/// Headless JS Lexical with the web editor's core node registry, running in
/// JavaScriptCore: the differential fuzzer's oracle.
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

  /// JSON crosses as the text JavaScript reads and writes, so key order
  /// crosses with it.
  public func load(_ state: JSONValue) throws {
    _ = try call("load", state.stringified)
  }

  @discardableResult
  public func apply(_ command: EditorCommand) throws -> ChangeSet {
    let result = try call("apply", String(decoding: try encoder.encode(command), as: UTF8.self))
    return try decoder.decode(ChangeSet.self, from: Data(result.utf8))
  }

  public func snapshot() throws -> Snapshot {
    let snapshot = try JSONValue(parsing: call("snapshot"))
    var selection: Selection?
    if let json = snapshot["selection"], json != .null {
      selection = try decoder.decode(Selection.self, from: Data(json.stringified.utf8))
    }
    return Snapshot(state: snapshot["state"] ?? .null, selection: selection)
  }

  public func selection() throws -> Selection? {
    try decoder.decode(Selection?.self, from: Data(try call("selection").utf8))
  }

  public func node(at path: [Int]) throws -> JSONValue {
    try decoder.decode(JSONValue.self, from: Data(try call("node", try pathJSON(path)).utf8))
  }

  public func childKeys(at path: [Int]) throws -> [String] {
    try decoder.decode([String].self, from: Data(try call("childKeys", try pathJSON(path)).utf8))
  }

  private func pathJSON(_ path: [Int]) throws -> String {
    String(decoding: try encoder.encode(path), as: UTF8.self)
  }

  private func call(_ name: String, _ argument: String? = nil) throws -> String {
    context.exception = nil
    let result = api.invokeMethod(name, withArguments: argument.map { [$0] } ?? [])
    if let exception = context.exception {
      context.exception = nil
      throw Self.error(from: exception)
    }
    return result?.isString == true ? result?.toString() ?? "" : ""
  }

  /// The `EditorError` a thrown `EditorError` from `reference/editor-error.ts`
  /// stands for.
  private static func error(from exception: JSValue) -> EditorError {
    let message = exception.toString() ?? "\(exception)"
    switch exception.forProperty("kind")?.toString().flatMap(EditorError.Kind.init) {
    case .noNode: return .noNode(path: (exception.forProperty("path")?.toArray() as? [Int]) ?? [])
    case .noSelection: return .noSelection
    case .unsupported: return .unsupported(message)
    case .invalidState, nil: return .invalidState(message)
    }
  }
}

public struct ReferenceError: Error, CustomStringConvertible {
  public let description: String
  init(_ description: String) { self.description = description }
}
