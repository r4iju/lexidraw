import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  type TextNode,
} from "lexical";
export const EMOJI_TRIGGER = ":";
export const EMOJI_MIN_LENGTH = 0;
export const EMOJI_LIMIT = 10;
export type EmojiEntry = { emoji: string; aliases: string[]; tags: string[] };
export function emojiOptions(entries: EmojiEntry[]) {
  return entries.map(({ emoji, aliases, tags }) => ({
    title: aliases[0] ?? "",
    emoji,
    keywords: [...aliases, ...tags],
  }));
}
export function emojiSuggestions<T extends { keywords: string[] }>(
  options: T[],
  queryString: string | null,
) {
  const query = queryString?.toLowerCase() ?? "";
  return options
    .filter((option) =>
      option.keywords.some((keyword) => keyword.toLowerCase().includes(query)),
    )
    .slice(0, EMOJI_LIMIT);
}

export function $selectEmoji(emoji: string, nodeToRemove: TextNode | null) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  if (nodeToRemove) nodeToRemove.remove();
  selection.insertNodes([$createTextNode(emoji)]);
  return true;
}
