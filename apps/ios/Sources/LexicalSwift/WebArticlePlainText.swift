// Generated from the web htmlToPlainText converter.
import EditorModelInterface

enum WebArticlePlainText {
  static let rules: [(JSRegExp, String)] = [
    (JSRegExp("<\\/(p|div|h[1-6]|li|blockquote|pre)>", flags: "gi"), "\n"),
    (JSRegExp("<br\\s*\\/?>(?=\\s*\\n?)", flags: "gi"), "\n"),
    (JSRegExp("<[^>]+>", flags: "g"), ""),
    (JSRegExp("\\r\\n|\\r|\\n", flags: "g"), "\n"),
    (JSRegExp("[\\t\\u00A0]+", flags: "g"), " "),
    (JSRegExp("\\s{2,}", flags: "g"), " "),
    (JSRegExp("\\n{3,}", flags: "g"), "\n\n"),
  ]
  static func convert(_ html: String) -> String {
    JSRegExp("^\\s+|\\s+$", flags: "g").replacingMatches(in: rules.reduce(html) { $1.0.replacingMatches(in: $0, with: $1.1) }, with: "")
  }
}
