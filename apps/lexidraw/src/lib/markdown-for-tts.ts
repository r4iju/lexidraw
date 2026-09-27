import "server-only";

export type DocChunk = {
  index: number;
  sectionTitle?: string;
  sectionIndex?: number;
  headingDepth?: number;
  text: string;
};

export type Section = {
  title?: string;
  depth: number;
  body: string;
  index: number;
};

const TABLE_LINE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_LINE =
  /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HEADING_LINE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?/;
const QUOTE_MARKER = /^\s*(?:>\s?)+/;
const HORIZONTAL_RULE = /^\s{0,3}(?:[-*_]\s*){3,}$/;
const SENTENCE_END = /[.!?:;,。！？、：；…]["'”’)\]」』）]*$/;
// With CJK's own punctuation and full-width forms, as in "。" and "！".
const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff01-\uff60]/u;

/** Marks a line off as a sentence, so a list item or table row gets a pause. */
function asSentence(text: string): string {
  if (!text || SENTENCE_END.test(text)) return text;
  return CJK.test(text.at(-1) ?? "") ? `${text}。` : `${text}.`;
}

/** A line of markdown as it is heard: links as their text, no emphasis. */
function spokenInline(line: string): string {
  return (
    line
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      .replace(/\$[^$\n]+\$/g, "")
      // A code span inside a sentence is a word of it, so its text stays.
      .replace(/`([^`]*)`/g, "$1")
      .replace(/~~([^~]+)~~/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?=[^\w*]|$)/g, "$1$2")
      // Underscores only at word edges, so snake_case survives.
      .replace(/(^|[^\w])_([^_\s][^_]*?)_(?=[^\w]|$)/g, "$1$2")
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, "$1")
      .replace(/[ \t]+/g, " ")
      .trim()
  );
}

/**
 * A table as lines of cells: the header once, then each row as a sentence.
 * Naming each cell's column again on every row reads as a form being filled
 * in; heard once, the header carries the columns.
 */
function spokenTable(rows: string[][]): string[] {
  return rows
    .map((cells) => asSentence(cells.filter(Boolean).join(", ")))
    .filter(Boolean);
}

function markdownTableRows(lines: string[]): string[][] {
  return lines
    .filter((line) => !TABLE_SEPARATOR_LINE.test(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map(spokenInline),
    )
    .filter((cells) => cells.some(Boolean));
}

/**
 * Markdown as it should be heard. Code, equations and images go; links,
 * emphasis, bullets and quote marks leave their text; a table is read row by
 * row; a list item or table row ends as a sentence. Headings stay markdown,
 * since the parts are cut by them.
 */
export function sanitizeMarkdownForTts(md: string): string {
  const text = md
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .replace(/<tweet[^>]*\/>/g, "");

  const out: string[] = [];
  let table: string[] = [];
  const closeTable = () => {
    if (table.length === 0) return;
    out.push("", ...spokenTable(markdownTableRows(table)), "");
    table = [];
  };
  for (const line of text.split("\n")) {
    if (TABLE_LINE.test(line)) {
      table.push(line);
      continue;
    }
    closeTable();
    if (HORIZONTAL_RULE.test(line)) {
      out.push("");
      continue;
    }
    const heading = line.match(HEADING_LINE);
    const title = heading?.[2] && spokenInline(heading[2]);
    if (heading?.[1] && title) {
      out.push(`${heading[1]} ${title}`);
      continue;
    }
    const unquoted = line.replace(QUOTE_MARKER, "");
    const isItem = LIST_MARKER.test(unquoted);
    const spoken = spokenInline(unquoted.replace(LIST_MARKER, ""));
    out.push(isItem ? asSentence(spoken) : spoken);
  }
  closeTable();

  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (whole, name: string) => {
      if (name[0] === "#") {
        const code =
          name[1] === "x" || name[1] === "X"
            ? Number.parseInt(name.slice(2), 16)
            : Number.parseInt(name.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return ENTITIES[name.toLowerCase()] ?? whole;
    },
  );
}

const stripTags = (html: string) =>
  decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/**
 * A saved article's HTML as it should be heard, with paragraphs apart: each
 * block becomes one, a list item or table row ends as a sentence, and a table
 * is read row by row.
 */
export function htmlToSpeechText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|pre|figure|svg)[\s\S]*?<\/\1>/gi, "")
      .replace(/<table[\s\S]*?<\/table>/gi, (table) => {
        const rows = [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)]
          .map(([row]) =>
            [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
              ([, cell]) => stripTags(cell ?? ""),
            ),
          )
          .filter((cells) => cells.some(Boolean));
        return `\n\n${spokenTable(rows).join("\n")}\n\n`;
      })
      .replace(
        /<li[^>]*>([\s\S]*?)<\/li>/gi,
        (_, item: string) => `\n${asSentence(stripTags(item))}`,
      )
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|blockquote|ul|ol|section|article)>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits markdown into sections based on heading levels (H1-H6).
 * Returns an array of sections with title, depth, and body content.
 */
export function splitMarkdownIntoSections(md: string): Section[] {
  const sections: Section[] = [];
  const lines = md.split("\n");
  let currentSection: Section | null = null;
  let currentBody: string[] = [];
  let sectionCounter = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section if exists; text before the first heading is
      // a section with no title.
      if (currentSection !== null) {
        currentSection.body = currentBody.join("\n").trim();
        sections.push(currentSection);
      } else if (currentBody.join("\n").trim()) {
        sections.push({
          title: undefined,
          depth: 0,
          body: currentBody.join("\n").trim(),
          index: sectionCounter++,
        });
      }

      // Start new section
      const depth = headingMatch[1]?.length;
      const title = headingMatch[2]?.trim();
      if (!depth || !title) continue;
      currentSection = { title, depth, body: "", index: sectionCounter++ };
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  // Save last section
  if (currentSection !== null) {
    currentSection.body = currentBody.join("\n").trim();
    sections.push(currentSection);
  } else if (md.trim()) {
    // No headings found, create a single section with all content
    sections.push({ title: undefined, depth: 0, body: md.trim(), index: 0 });
  }

  return sections;
}

/** Speech a voice keeps up in a second: Latin script, then CJK. */
const CHARS_PER_SECOND = 15;
const CJK_CHARS_PER_SECOND = 5;
const CJK_ALL = new RegExp(CJK.source, "gu");

/** About how long a voice takes to read the text aloud, in seconds. */
export function speakingSeconds(text: string): number {
  const flat = text.replace(/\s+/g, " ").trim();
  const cjk = flat.match(CJK_ALL)?.length ?? 0;
  return cjk / CJK_CHARS_PER_SECOND + (flat.length - cjk) / CHARS_PER_SECOND;
}

/**
 * Sentences at `.!?` followed by a space, and at `。！？` with or without
 * one, each keeping a closing quote or bracket. "3.14" and "e.g.x" stay whole.
 */
export function splitSentences(text: string): string[] {
  return (
    text.match(
      /[\s\S]+?(?:[.!?]+["'”’)\]]*(?=\s|$)|[。！？]+["'”’)\]」』）]*|$)/g,
    ) ?? []
  )
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/** A part's length, in speech. */
const PART_SECONDS = 60;
/**
 * A paragraph this long starts a part of its own. Where parts begin then
 * depends on each paragraph alone, not on everything before it, so an edit
 * remakes the part that holds it and the parts after keep their audio.
 */
const ANCHOR_SECONDS = 15;
/** The opening part is its first sentence, and the next if that one is shorter than this. */
const OPENING_SECONDS = 3;
/**
 * The part after the opening is no longer than this, so it is made while the
 * opening plays, and each part after is made while the one before plays.
 */
const SECOND_SECONDS = 20;

/** A part's text, and whether it starts a part, or ends one. */
type Piece = { text: string; anchor: boolean; closed?: boolean };

/** Sentences as one text: CJK ones run on, as they were written. */
function joinUnits(units: string[]): string {
  return units.reduce(
    (text, unit) =>
      !text
        ? unit
        : CJK.test(text.at(-1) ?? "") && CJK.test(unit[0] ?? "")
          ? text + unit
          : `${text} ${unit}`,
    "",
  );
}

/**
 * Cuts text too long for one part at its sentences, or failing those, its
 * commas and spaces, into pieces of even length, so none is a stub.
 */
function pieces(text: string, seconds: number, hardCap: number): string[] {
  const fits = (t: string) =>
    speakingSeconds(t) <= seconds && t.length <= hardCap;
  if (fits(text)) return [text];
  const sentences = splitSentences(text);
  const units =
    sentences.length > 1
      ? sentences
      : text
          .split(/(?<=[\s、，,])/)
          .map((unit) => unit.trim())
          .filter(Boolean);
  if (units.length <= 1) {
    const at = Math.max(
      1,
      Math.min(hardCap, Math.floor(seconds * CJK_CHARS_PER_SECOND)),
    );
    return [text.slice(0, at), ...pieces(text.slice(at), seconds, hardCap)];
  }
  const total = speakingSeconds(text);
  const count = Math.max(
    Math.ceil(total / seconds),
    Math.ceil(text.length / hardCap),
  );
  const even = total / count;
  const out: string[] = [];
  let buffer: string[] = [];
  let spoken = 0;
  for (const unit of units) {
    const next = speakingSeconds(unit);
    // Cut where the running time is nearer the next even mark than past it.
    if (buffer.length > 0 && spoken + next / 2 > even * (out.length + 1)) {
      out.push(joinUnits(buffer));
      buffer = [];
    }
    buffer.push(unit);
    spoken += next;
  }
  if (buffer.length > 0) out.push(joinUnits(buffer));
  return out.flatMap((piece) =>
    fits(piece) ? [piece] : pieces(piece, seconds, hardCap),
  );
}

/**
 * Cuts sections into parts of about a minute of speech, in any language.
 *
 * - A heading is read with the text after it, never as a part of its own
 *   unless nothing follows it.
 * - A paragraph of 15 seconds or more starts a part; shorter ones join the
 *   part before them while it has room.
 * - A paragraph too long for a part is cut at its sentences.
 * - The file's first part is one or two sentences, and its second at most 20
 *   seconds, so listening starts soon and each part is made while the one
 *   before it plays.
 */
export function chunkSections(
  sections: Section[],
  opts?: { targetSeconds?: number; hardCap?: number },
): DocChunk[] {
  const target = opts?.targetSeconds ?? PART_SECONDS;
  const hardCap = opts?.hardCap ?? 4000;
  const chunks: DocChunk[] = [];
  let headings: string[] = [];

  for (const section of sections) {
    if (section.title) {
      headings.push(
        `${"#".repeat(Math.max(1, section.depth))} ${section.title}`,
      );
    }
    const paragraphs = section.body
      .split(/\n{2,}/g)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length === 0) continue;

    const all: Piece[] = paragraphs.flatMap((paragraph) => {
      const cut = pieces(paragraph, target, hardCap);
      return cut.map((text) => ({
        text,
        anchor: cut.length > 1 || speakingSeconds(text) >= ANCHOR_SECONDS,
      }));
    });
    if (chunks.length === 0 && all[0]) {
      const [first = "", second, ...rest] = splitSentences(all[0].text);
      const opening =
        second !== undefined && speakingSeconds(first) < OPENING_SECONDS
          ? [first, second]
          : [first];
      const after = [second, ...rest]
        .slice(opening.length - 1)
        .filter((unit) => unit !== undefined);
      all.splice(0, 1, {
        text: joinUnits(opening),
        anchor: true,
        closed: true,
      });
      if (after.length > 0) {
        all.splice(1, 0, { text: joinUnits(after), anchor: true });
      }
    }
    const secondAt = chunks.length === 0 ? 1 : chunks.length === 1 ? 0 : -1;
    const second = all[secondAt];
    if (second) {
      const [lead = "", ...tail] = pieces(second.text, SECOND_SECONDS, hardCap);
      all.splice(
        secondAt,
        1,
        { text: lead, anchor: true, closed: true },
        ...(tail.length > 0
          ? pieces(joinUnits(tail), target, hardCap).map((text) => ({
              text,
              anchor: true,
            }))
          : []),
      );
    }

    let part: string[] = [];
    let seconds = 0;
    const flush = () => {
      if (part.length === 0) return;
      chunks.push({
        index: chunks.length,
        sectionTitle: section.title,
        sectionIndex: section.index,
        headingDepth: section.depth,
        text: [...headings, ...part].join("\n\n"),
      });
      headings = [];
      part = [];
      seconds = 0;
    };
    let closed = false;
    for (const piece of all) {
      const next = speakingSeconds(piece.text);
      const length = part.join("\n\n").length + piece.text.length + 2;
      if (
        piece.anchor ||
        closed ||
        seconds + next > target ||
        length > hardCap
      ) {
        flush();
      }
      part.push(piece.text);
      seconds += next;
      closed = piece.closed ?? false;
    }
    flush();
  }

  // Headings with no text after them are still read.
  if (headings.length > 0) {
    const last = sections.at(-1);
    chunks.push({
      index: chunks.length,
      sectionTitle: last?.title,
      sectionIndex: last?.index,
      headingDepth: last?.depth,
      text: headings.join("\n\n"),
    });
  }

  return chunks;
}

/**
 * Splits HTML into sections based on heading levels (H1-H6).
 * Returns an array of sections with title, depth, and body content.
 * Similar to splitMarkdownIntoSections but works with HTML.
 */
export function splitHtmlIntoSections(html: string): Section[] {
  const sections: Section[] = [];
  let sectionCounter = 0;

  // Extract headings and their positions
  const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi;
  const headings: Array<{
    depth: number;
    title: string;
    startIndex: number;
    endIndex: number;
  }> = [];

  let match: RegExpExecArray | null = null;
  // biome-ignore lint/suspicious/noAssignInExpressions: needed for regex loop
  while ((match = headingRegex.exec(html)) !== null) {
    const depth = Number.parseInt(match[1] ?? "1", 10);
    const titleText = match[2]?.replace(/<[^>]+>/g, "").trim() ?? "";
    if (titleText && match.index !== undefined) {
      headings.push({
        depth,
        title: titleText,
        startIndex: match.index,
        endIndex: match.index + (match[0]?.length ?? 0),
      });
    }
  }

  if (headings.length === 0) {
    // No headings found, create a single section with all content
    sections.push({ title: undefined, depth: 0, body: html, index: 0 });
    return sections;
  }

  // Split HTML into sections based on heading positions
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    if (!heading) continue;
    const nextHeadingStart =
      i < headings.length - 1
        ? (headings[i + 1]?.startIndex ?? html.length)
        : html.length;

    // Extract section body (everything after this heading tag and before the next heading)
    const sectionBody = html.slice(heading.endIndex, nextHeadingStart);

    sections.push({
      title: heading.title,
      depth: heading.depth,
      body: sectionBody.trim(),
      index: sectionCounter++,
    });
  }

  return sections;
}

/**
 * Normalizes text for consistent hashing and TTS synthesis.
 * Applies Unicode normalization and collapses whitespace.
 */
export function normalizeForTts(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}
