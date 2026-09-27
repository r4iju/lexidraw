import JavaScriptCore

extension JSContext {
  /// The Encoding Standard's `TextEncoder` and `TextDecoder` for UTF-8, which
  /// JavaScriptCore lacks and whatwg-url's `URL` needs. Swift's own UTF-8
  /// coding does the work: a lone surrogate encodes, and a malformed
  /// sequence decodes, as U+FFFD, as the standard's do.
  public func defineTextEncoding() {
    let encode: @convention(block) (String) -> [UInt8] = { Array($0.utf8) }
    let decode: @convention(block) ([NSNumber], Bool) -> String = { bytes, ignoresBOM in
      let text = String(decoding: bytes.map(\.uint8Value), as: UTF8.self)
      return !ignoresBOM && text.hasPrefix("\u{FEFF}") ? String(text.dropFirst()) : text
    }
    evaluateScript(
      """
      (function (encode, decode) {
        globalThis.TextEncoder = class TextEncoder {
          get encoding() { return "utf-8"; }
          encode(input = "") { return new Uint8Array(encode(String(input))); }
        };
        globalThis.TextDecoder = class TextDecoder {
          #ignoreBOM;
          constructor(label = "utf-8", options = {}) {
            const labels = ["unicode-1-1-utf-8", "unicode11utf8", "unicode20utf8", "utf-8", "utf8", "x-unicode20utf8"];
            if (!labels.includes(String(label).trim().toLowerCase())) throw new RangeError(`No encoding ${label}`);
            if (options.fatal) throw new RangeError("No fatal decoding");
            this.#ignoreBOM = Boolean(options.ignoreBOM);
          }
          get encoding() { return "utf-8"; }
          get ignoreBOM() { return this.#ignoreBOM; }
          decode(input) {
            if (input === undefined) return "";
            const bytes = ArrayBuffer.isView(input)
              ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
              : new Uint8Array(input);
            return decode(Array.from(bytes), this.#ignoreBOM);
          }
        };
      })
      """
    ).call(withArguments: [unsafeBitCast(encode, to: AnyObject.self), unsafeBitCast(decode, to: AnyObject.self)])
  }
}
