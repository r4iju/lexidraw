import { createHeadlessEditor } from "@lexical/headless";
import { $createMentionNode, MentionNode } from "@packages/lexical-nodes";
import { basicTypeaheadPattern } from "./typeahead-trigger";
import {
  AtSignMentionsRegex,
  AtSignMentionsRegexAliasRegex,
  dummyMentionsData,
  MENTION_LOOKUP_DELAY,
  SUGGESTION_LIST_LENGTH_LIMIT,
  MENTION_MINIMUM_QUERY_LENGTH,
  MENTION_SLASH_TRIGGER,
  MENTION_SLASH_MINIMUM_LENGTH,
} from "../../lexidraw/src/app/documents/[documentId]/plugins/MentionsPlugin/source";
import { swiftString } from "./swift";
export const MENTIONS_PATH = new URL(
  "../Sources/EditorModelInterface/MentionTypeaheadConfiguration.swift",
  import.meta.url,
);
export async function swiftForMentions(): Promise<string> {
  const slash = await basicTypeaheadPattern(
    MENTION_SLASH_TRIGGER,
    MENTION_SLASH_MINIMUM_LENGTH,
  );
  let nodeJSON = "";
  createHeadlessEditor({
    nodes: [MentionNode],
    onError(error) {
      throw error;
    },
  }).update(
    () => {
      nodeJSON = JSON.stringify($createMentionNode("").exportJSON());
    },
    { discrete: true },
  );
  if (!nodeJSON) throw new Error("Mention factory did not run");
  return `// Generated from the actual web MentionsPlugin match, dataset and timing.
import Foundation

public enum MentionTypeaheadConfiguration {
  public struct Match: Equatable, Sendable {
    public let leadOffset: Int
    public let matchingString: String
    public let replaceableString: String
  }
  public static let lookupDelayMilliseconds = ${MENTION_LOOKUP_DELAY}
  public static let suggestionLimit = ${SUGGESTION_LIST_LENGTH_LIMIT}
  public static let names: [String] = [${dummyMentionsData.map(swiftString).join(", ")}]
  private static let expressions = [${[AtSignMentionsRegex, AtSignMentionsRegexAliasRegex].map((value) => `JSRegExp(${swiftString(value.source)}, flags: ${swiftString(value.flags)})`).join(", ")}]
  private static let slash = JSRegExp(${swiftString(slash)}, flags: "")
  public static let mentionNodeJSON = ${swiftString(nodeJSON)}
  public static func match(_ prefix: String) -> Match? {
    guard slash.firstMatch(in: prefix) == nil else { return nil }
    for expression in expressions {
      guard let result = expression.firstMatch(in: prefix), result.groups.count >= 4,
        let whitespace = result.groups[1], let query = result.groups[3], let replacement = result.groups[2]
      else { continue }
      guard query.utf16.count >= ${MENTION_MINIMUM_QUERY_LENGTH} else { return nil }
      return Match(leadOffset: result.index + whitespace.utf16.count, matchingString: query, replaceableString: replacement)
    }
    return nil
  }
  public static func lookup(_ query: String) -> [String] {
    names.filter { $0.lowercased().contains(query.lowercased()) }
  }
}
`;
}
