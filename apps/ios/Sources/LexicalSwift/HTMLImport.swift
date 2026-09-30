import JavaScriptCore
import Synchronization

/// Uses the web's registered converters and their priority order over the
/// native parser's inert DOM; it never evaluates clipboard source as code.
enum HTMLImport {
  static func nodes(_ html: String) throws -> [JSONValue] {
    let tree = try HTMLDOM.parse(html)
    return try context.withLock { context in
      context.exception = nil
      guard let result = context.objectForKeyedSubscript("importClipboardDOM")?.call(withArguments: [tree.stringified]),
        context.exception == nil, let json = result.toString()
      else {
        throw EditorError.unsupported("HTML import failed (#168): \(context.exception?.toString() ?? "importer unavailable")")
      }
      guard let nodes = try JSONValue(parsing: json).arrayValue else {
        throw EditorError.invalidState("HTML importer returned no nodes")
      }
      return nodes
    }
  }

  private static let context = Mutex<JSContext>({
    let context = JSContext()!
    context.defineTextEncoding()
    context.evaluateScript(htmlImportScript)
    return context
  }())
}
