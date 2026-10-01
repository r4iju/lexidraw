import Foundation
import JavaScriptCore
import LexicalSwift

/// Headless JS Lexical with the web editor's core node registry, running in
/// JavaScriptCore: the differential fuzzer's oracle.
public final class ReferenceEditor: EditorModel {
  private let context: JSContext
  private let api: JSValue
  private let runTimers: JSValue
  private let encoder = JSONEncoder()
  private let decoder = JSONDecoder()

  /// `scriptURL` is the bundle `bun run build:reference` writes.
  public init(scriptURL: URL) throws {
    guard let context = JSContext() else { throw ReferenceError("Couldn't create a JSContext") }
    self.context = context
    // Lexical only needs the console to exist. Its one timer resets how many
    // updates in a row update listeners have queued, so timers run as the
    // call that set them returns, as the next task would before a user can
    // do anything else.
    context.evaluateScript(
      """
      var console = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
      var timers = [];
      function setTimeout(callback) { timers.push(callback); return timers.length; }
      function runTimers() { while (timers.length > 0) timers.shift()(); }
      """)
    context.defineTextEncoding()
    context.evaluateScript(try String(contentsOf: scriptURL, encoding: .utf8), withSourceURL: scriptURL)
    if let exception = context.exception {
      throw ReferenceError("The reference bundle failed to load: \(exception)")
    }
    guard let api = context.objectForKeyedSubscript("LexicalReference"), api.isObject else {
      throw ReferenceError("The reference bundle didn't define LexicalReference")
    }
    self.api = api
    runTimers = context.objectForKeyedSubscript("runTimers")
  }

  /// JSON crosses as the text JavaScript reads and writes, so key order
  /// crosses with it.
  public func load(_ state: JSONValue) throws {
    _ = try call("load", state.stringified)
  }

  /// Lexical edits every node it has registered.
  public var isEditable: Bool { true }

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

  public func serializedState() throws -> JSONValue {
    try JSONValue(parsing: call("serializedState"))
  }

  public func selection() throws -> Selection? {
    try decoder.decode(Selection?.self, from: Data(try call("selection").utf8))
  }

  /// Parsed as `snapshot` parses, so text holding half a surrogate pair,
  /// which Lexical can leave, crosses whole.
  public func node(at path: [Int]) throws -> JSONValue {
    try JSONValue(parsing: call("node", try pathJSON(path)))
  }

  public func elementFormatting(at path: [Int]) throws -> JSONValue {
    try JSONValue(parsing: call("elementFormatting", try pathJSON(path)))
  }

  public func childKeys(at path: [Int]) throws -> [String] {
    try decoder.decode([String].self, from: Data(try call("childKeys", try pathJSON(path)).utf8))
  }

  public func nodePath(for key: String) throws -> [Int] {
    try decoder.decode([Int].self, from: Data(try call("nodePath", key).utf8))
  }

  private func pathJSON(_ path: [Int]) throws -> String {
    String(decoding: try encoder.encode(path), as: UTF8.self)
  }

  private func call(_ name: String, _ argument: String? = nil) throws -> String {
    context.exception = nil
    let result = api.invokeMethod(name, withArguments: argument.map { [$0] } ?? [])
    let exception = context.exception
    context.exception = nil
    runTimers.call(withArguments: [])
    if let exception = exception ?? context.exception {
      context.exception = nil
      throw Self.error(from: exception)
    }
    return result?.isString == true ? result?.toString() ?? "" : ""
  }

  /// The `EditorError` a thrown `EditorError` from `reference/editor-error.ts`
  /// stands for.
  private static func error(from exception: JSValue) -> EditorError {
    let kind = exception.forProperty("kind")?.toString().flatMap(EditorError.Kind.init)
    let message = (kind == nil ? exception.toString() : exception.forProperty("message")?.toString()) ?? "\(exception)"
    switch kind {
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
