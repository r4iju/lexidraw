import LexicalFuzz
import LexicalSwift

enum TestDocuments {
  /// A heading, a paragraph, a table of `rows`, an embedded video and a
  /// paragraph after it.
  static func titledTable(_ rows: [[String]]) -> JSONValue {
    LexicalJSON.document([
      LexicalJSON.element("heading", [LexicalJSON.text("Title")], ["tag": "h2"]),
      LexicalJSON.paragraph([LexicalJSON.text("before")]),
      LexicalJSON.table(rows),
      LexicalJSON.youtube("abc"),
      LexicalJSON.paragraph([LexicalJSON.text("after")]),
    ])
  }
}
