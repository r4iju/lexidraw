import type { ReactNode } from "react";

export const BLOCK_GROUPS = [
  "Text",
  "Basic",
  "Media",
  "Diagrams and data",
  "Embeds",
  "Interactive",
] as const;

export type BlockGroup = (typeof BLOCK_GROUPS)[number];

/** A block the slash menu and the Insert menu offer. */
export type BlockEntry = {
  id: string;
  label: string;
  group: BlockGroup;
  /** Other words it is found by: "hr" for a divider, "todo" for a check list. */
  keywords: readonly string[];
  icon: ReactNode;
  /** Makes or inserts the block at the selection. */
  run: () => void;
};

type Searchable = Pick<BlockEntry, "label" | "keywords">;

/** Whether `query` starts at the start of a word of `text`. */
function startsAWord(text: string, query: string) {
  for (let index = 0; index <= text.length - query.length; index++)
    if (
      (index === 0 || text[index - 1] === " ") &&
      text.startsWith(query, index)
    )
      return true;
  return false;
}

/** Whether `query`'s letters come in order in `text`, from the start of a word. */
function spells(text: string, query: string) {
  let at = -1;
  do at = text.indexOf(query.charAt(0), at + 1);
  while (at > 0 && text[at - 1] !== " ");
  if (at < 0) return false;
  for (const letter of query.slice(1)) {
    at = text.indexOf(letter, at + 1);
    if (at < 0) return false;
  }
  return true;
}

/** How well `entry` matches `query`: lower is better, null is no match. */
function rank(entry: Searchable, query: string): number | null {
  const label = entry.label.toLowerCase();
  const keywords = entry.keywords.map((keyword) => keyword.toLowerCase());
  if (label === query || keywords.includes(query)) return 0;
  if (label.startsWith(query)) return 1;
  if (startsAWord(label, query)) return 2;
  if (keywords.some((keyword) => startsAWord(keyword, query))) return 3;
  if (label.includes(query)) return 4;
  if (query.length > 2 && spells(label, query)) return 5;
  return null;
}

/**
 * `entries` that match `query`, best first and otherwise in their own order:
 * the label as typed, then a word of it, then a keyword, then the letters in
 * order, for three letters or more ("dvdr" finds Divider).
 */
export function searchEntries<Entry extends Searchable>(
  entries: readonly Entry[],
  query: string,
): Entry[] {
  const wanted = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!wanted) return [...entries];
  return entries
    .map((entry, index) => ({ entry, index, rank: rank(entry, wanted) }))
    .filter(
      (each): each is { entry: Entry; index: number; rank: number } =>
        each.rank !== null,
    )
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ entry }) => entry);
}
