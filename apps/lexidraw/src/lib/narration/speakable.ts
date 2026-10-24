const TERMINAL = /[.!?:;。！？…]["'”’)\]]*$/;
const PART_CHARS = 500;

/** Markdown reduced to what a narrator should say: link text without targets, and no images, URLs, comments or markup. */
export function speakableText(markdown: string) {
  return (
    markdown
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Footnote definitions are references, not prose.
      .replace(/^\[\^[^\]]+\]:.*$/gm, "")
      .replace(/^\s*(```|~~~).*$/gm, "")
      .replace(/^[\s|:-]+$/gm, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[\^[^\]]+\]:?/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<?https?:\/\/[^\s>)]+>?/g, " ")
      .replace(/<\/?[a-z][^>]*>/gi, " ")
      .replace(/^\s{0,3}(#{1,6}|>+|[-*+]( \[[ x]\])?|\d+[.)])\s+/gm, "")
      .replace(/[*_~`|]+/g, " ")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      // A heading or list item without punctuation still needs a pause after it.
      .map((line) => (TERMINAL.test(line) ? line : `${line}.`))
      .join(" ")
  );
}

/** Whole sentences packed into parts of at most 500 code points; only an overlong sentence is split, at a space. */
export function speakableParts(markdown: string) {
  // A full stop ends a sentence only before whitespace, so AGENTS.md and 2.5 stay whole.
  const sentences =
    speakableText(markdown).match(
      /[\s\S]*?(?:[。！？]+|[.!?…]+["'”’)\]]*(?=\s|$))\s*|[\s\S]+$/g,
    ) ?? [];
  const parts: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };
  for (const sentence of sentences) {
    if (Array.from(current + sentence).length <= PART_CHARS) {
      current += sentence;
      continue;
    }
    flush();
    let rest = Array.from(sentence.trim());
    while (rest.length > PART_CHARS) {
      const head = rest.slice(0, PART_CHARS).join("");
      const cut = head.lastIndexOf(" ");
      const take =
        cut > PART_CHARS / 2
          ? Array.from(head.slice(0, cut)).length
          : PART_CHARS;
      parts.push(rest.slice(0, take).join("").trim());
      rest = rest.slice(take);
    }
    current = `${rest.join("")} `;
  }
  flush();
  return parts;
}
