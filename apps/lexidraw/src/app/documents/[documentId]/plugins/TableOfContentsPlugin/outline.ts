import type { HeadingTagType } from "@lexical/rich-text";

/**
 * How deep each heading sits in the document's outline: under how many of
 * the headings before it that are still open, whatever tag it has.
 */
export function outlineLevels(tags: HeadingTagType[]): number[] {
  const open: number[] = [];
  return tags.map((tag) => {
    const rank = Number(tag.slice(1));
    while (open.length && (open.at(-1) ?? 0) >= rank) open.pop();
    open.push(rank);
    return open.length - 1;
  });
}
