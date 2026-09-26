import Foundation
import LexicalFuzz
import LexicalReference
import LexicalSwift

enum Support {
  static let iosRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()

  /// Where the fuzzer writes new fixtures, so they land in the source tree.
  static let fixturesSource = iosRoot.appending(path: "Tests/LexicalSwiftTests/Fixtures")

  /// The committed node schema the payload types are generated from.
  static let nodeSchema = iosRoot.appending(path: "../../packages/lexical-nodes/node-schema.json")

  static func referenceEditor() throws -> ReferenceEditor {
    let bundle = iosRoot.appending(path: "reference/dist/lexical-reference.js")
    guard FileManager.default.fileExists(atPath: bundle.path) else {
      throw SupportError("The JS reference isn't built; run `bun run build:reference` in apps/ios")
    }
    return try ReferenceEditor(scriptURL: bundle)
  }

  static func environment(_ name: String) -> String? {
    ProcessInfo.processInfo.environment[name]
  }
}

struct SupportError: Error, CustomStringConvertible {
  let description: String
  init(_ description: String) { self.description = description }
}

func text(_ text: String, format: TextFormat = []) -> JSONValue {
  LexicalJSON.text(text, format: format)
}

func paragraph(_ children: JSONValue...) -> JSONValue {
  LexicalJSON.paragraph(children)
}

func document(_ children: JSONValue...) -> JSONValue {
  LexicalJSON.document(children)
}
