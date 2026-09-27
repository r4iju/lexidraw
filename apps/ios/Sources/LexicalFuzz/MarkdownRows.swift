/// GFM table rows, one to three cells of what @lexical/markdown's import
/// reads: emphasis and code delimiters, escapes, character references,
/// block starts, and `\n` for a new line.
public struct MarkdownRows {
  private var random: SplitMix64

  public init(seed: UInt64) {
    random = SplitMix64(seed: seed)
  }

  public mutating func next() -> String { Self.row(using: &random) }

  static func row(using random: inout SplitMix64) -> String {
    let cells = (0..<Int.random(in: 1...3, using: &random)).map { _ in
      (0..<Int.random(in: 0...8, using: &random)).map { _ in pieces.randomElement(using: &random)! }.joined()
    }
    return "|" + cells.joined(separator: "|") + "|"
  }

  private static let pieces = [
    "a", "b", "é", "👍", " ", " ", ".", "!", "*", "*", "**", "***", "_", "_", "__", "~", "~~", "=", "==", "`", "``",
    #"\"#, #"\*"#, #"\_"#, #"\`"#, #"\\"#, #"\|"#, #"\n"#, #"\n"#, "&#65;", "&#42;", "\t", "# ", "> ", "- ", "1. ",
    "- [x] ", "---", "  ",
  ]
}
