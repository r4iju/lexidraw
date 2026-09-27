import JavaScriptCore
import LexicalSwift
import Testing

@Suite struct TextEncodingTests {
  static func evaluate(_ script: String) -> String? {
    let context = JSContext()!
    context.defineTextEncoding()
    return context.evaluateScript(script)?.toString()
  }

  @Test func encodesUTF8WithALoneSurrogateAsTheReplacementCharacter() {
    #expect(Self.evaluate("Array.from(new TextEncoder().encode('é👍\\uD800')).join()") == "195,169,240,159,145,141,239,191,189")
  }

  @Test func decodesUTF8WithAMalformedSequenceAsTheReplacementCharacter() {
    #expect(Self.evaluate("new TextDecoder().decode(new Uint8Array([195, 169, 255, 97]))") == "é\u{FFFD}a")
  }

  @Test func dropsALeadingByteOrderMarkUnlessToldToKeepIt() {
    let bytes = "new Uint8Array([239, 187, 191, 97])"
    #expect(Self.evaluate("new TextDecoder().decode(\(bytes)).length") == "1")
    #expect(Self.evaluate("new TextDecoder('utf-8', { ignoreBOM: true }).decode(\(bytes)).length") == "2")
  }
}
