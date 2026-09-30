import emojiList from "../../../packages/lexical-nodes/src/emoji-list";
import { swiftString } from "./swift";

export const EMOJI_ALIASES_PATH = new URL(
  "../Sources/LexicalSwift/WebEmojiAliases.swift",
  import.meta.url,
);

export function swiftForEmojiAliases(): string {
  const aliases = new Map<string, string>();
  for (const entry of emojiList) {
    if (typeof entry.emoji !== "string" || !Array.isArray(entry.aliases)) {
      throw new Error("Unknown web emoji entry shape");
    }
    for (const alias of entry.aliases) {
      if (typeof alias !== "string")
        throw new Error("Unknown emoji alias shape");
      if (!aliases.has(alias)) aliases.set(alias, entry.emoji);
    }
  }
  return `// Generated from the web emoji list by apps/ios/codegen/social.ts.\n\nenum WebEmojiAliases {\n  static let values: [String: String] = [\n${[...aliases].map(([alias, emoji]) => `    ${swiftString(alias)}: ${swiftString(emoji)},`).join("\n")}\n  ]\n}\n`;
}
