#if canImport(UIKit)
import UIKit
import EditorModelInterface

@MainActor private enum MentionLookup {
  private static var completed: [String: [String]] = [:]
  static func options(_ query: String) async -> [String] {
    if let cached = completed[query] { return cached }
    do {
      try await Task.sleep(for: .milliseconds(MentionTypeaheadConfiguration.lookupDelayMilliseconds))
    } catch { return [] }
    let names = MentionTypeaheadConfiguration.lookup(query)
    completed[query] = names
    return names
  }
}

extension EditorTypeaheadProvider {
  static let mentions = Self(id: "mentions") { input in
    guard let match = MentionTypeaheadConfiguration.match(input.prefix) else { return nil }
    let names = await MentionLookup.options(match.matchingString)
    guard !Task.isCancelled else { return nil }
    let range = NSRange(location: input.replacementBase + match.leadOffset, length: match.replaceableString.utf16.count)
    let candidates = names.prefix(MentionTypeaheadConfiguration.suggestionLimit).map { name in
      EditorTypeaheadCandidate(id: "mention-option-\(name)", label: name) { editor, range in
        guard var fields = (try? JSONValue(parsing: MentionTypeaheadConfiguration.mentionNodeJSON))?.objectValue else { return }
        fields["text"] = .string(name)
        fields["mentionName"] = .string(name)
        editor.replaceTypeahead(range: range, with: Clipboard(
          plainText: name,
          lexical: LexicalClipboardPayload(namespace: MediaLinks.namespace, nodes: [.object(fields)])), preservingTypingAttributes: true)
      }
    }
    return EditorTypeaheadMatch(range: range, candidates: candidates)
  }
}
#endif
