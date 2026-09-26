import Testing

@testable import DrawingKit

@Suite struct TextMeasuringTests {
  /// Widths Chromium's canvas `measureText` gave for the bundled fonts, to
  /// the bit: a text whose width is measured again after an edit keeps it,
  /// as it does on the web, instead of changing by a rounding error.
  @Test(arguments: [
    ("20px Excalifont, Xiaolai, Segoe UI Emoji", "friend", 56.81993103027344),
    ("20px Excalifont, Xiaolai, Segoe UI Emoji", "Hello there", 102.91995239257812),
    ("20px Excalifont, Xiaolai, Segoe UI Emoji", "Scale me", 81.27993774414062),
    ("28px Excalifont, Xiaolai, Segoe UI Emoji", "Hello there friend", 234.83587646484375),
    ("36px Excalifont, Xiaolai, Segoe UI Emoji", "Wavy lines, AV To", 307.223876953125),
    ("20px Nunito, Segoe UI Emoji", "Nunito AVATAR office", 197.85983276367188),
    ("20px Lilita One, Segoe UI Emoji", "Lilita AVATAR office", 170.9598388671875),
    ("20px Comic Shanns, Segoe UI Emoji", "Comic Shanns code()", 209),
    ("20px Excalifont, Xiaolai, Segoe UI Emoji", "你好世界", 80),
    ("13.7px Excalifont, Xiaolai, Segoe UI Emoji", "odd size text", 92.33790588378906),
  ])
  func measuresAsChromiumMeasures(_ font: String, _ text: String, _ width: Double) {
    #expect(FontLibrary.shared.width(of: text, font: font) == width)
  }
}
