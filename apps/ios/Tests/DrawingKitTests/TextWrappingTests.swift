import Testing

@testable import DrawingKit

@Suite struct TextWrappingTests {
  /// Where Excalidraw 0.18.1's own line-break expression cuts each line, so
  /// a label wraps at the same words on iOS as on the web.
  @Test(arguments: [
    ("Hello world-wide web", ["Hello", " ", "world-", "wide", " ", "web"]),
    ("Hello(한글)", ["Hello(한", "글)"]),
    ("Hello「た」 World", ["Hello", "「た」", " ", "World"]),
    ("Price￥100", ["Price", "￥100"]),
    ("👍🏽 hi 🇯🇵 x", ["👍🏽", " ", "hi", " ", "🇯🇵", " ", "x"]),
    ("a  b\tc", ["a", " ", " ", "b", "\t", "c"]),
    ("日本語のテキスト。次", ["日", "本", "語", "の", "テ", "キ", "ス", "ト。", "次"]),
    ("wait...(yes)", ["wait...", "(yes)"]),
    ("e\u{301}", ["é"]),
  ])
  func breaksLinesWhereTheWebDoes(_ line: String, _ tokens: [String]) {
    #expect(TextWrapping.tokens(line) == tokens)
  }
}
