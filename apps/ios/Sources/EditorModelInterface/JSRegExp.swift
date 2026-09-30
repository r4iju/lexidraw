import JavaScriptCore
import Synchronization

/// A JavaScript regular expression. JavaScriptCore evaluates it, so it
/// matches as it does in the web editor.
public struct JSRegExp: Sendable {
  public let source: String
  public let flags: String

  public init(_ source: String, flags: String) {
    self.source = source
    self.flags = flags
  }

  /// `text.match(regExp)`: where the first match starts, in UTF-16 code
  /// units, and its groups, the whole match first.
  public func firstMatch(in text: String) -> (index: Int, groups: [String?])? {
    precondition(!flags.contains("g"), "A global pattern's match has no groups")
    let result = Self.functions.withLock { $0.forProperty("match").call(withArguments: [source, flags, text]) }
    guard let values = result?.toArray(), let index = values.first as? Int else { return nil }
    return (index, values.dropFirst().map { $0 as? String })
  }

  /// `text.match(regExp)?.length ?? 0` of a global pattern: how many times
  /// it matches.
  public func matchCount(in text: String) -> Int {
    precondition(flags.contains("g"), "Only a global pattern matches more than once")
    return Int(Self.functions.withLock { $0.forProperty("count").call(withArguments: [source, flags, text]).toInt32() })
  }

  /// JavaScript String.split, including its zero-width boundary handling.
  public func split(_ text: String) -> [String] {
    Self.functions.withLock { $0.forProperty("split").call(withArguments: [source, flags, text]).toArray() as? [String] ?? [] }
  }

  public func replacingMatches(in text: String, with replacement: String) -> String {
    Self.functions.withLock { $0.forProperty("replace").call(withArguments: [source, flags, text, replacement]).toString() }
  }

  private static let functions = Mutex(
    JSContext().evaluateScript(
      """
      const compiled = new Map();
      const compile = (source, flags) => {
        const key = `/${source}/${flags}`;
        if (!compiled.has(key)) compiled.set(key, new RegExp(source, flags));
        return compiled.get(key);
      };
      ({
        match: (source, flags, text) => {
          const match = text.match(compile(source, flags));
          return match && [match.index, ...Array.from(match, (group) => group ?? null)];
        },
        split: (source, flags, text) => text.split(compile(source, flags)),
        replace: (source, flags, text, replacement) => text.replace(compile(source, flags), replacement),
        count: (source, flags, text) => text.match(compile(source, flags))?.length ?? 0,
      })
      """
    )!
  )
}
