/** Scripts written without spaces between words. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/** Characters a word boundary may sit after. */
const BOUNDARY = /[\s.,;:!?。、！？]/;

/**
 * An echo shorter than this is kept: "that that" and "had had" are real
 * English, while models that echo repeat a long word or the whole sentence.
 */
const MIN_ECHO = 6;

/**
 * The model's reply as text to show after `before`: one line, without the
 * words it repeated from before the cursor, and spaced against them.
 */
export function normalizeCompletion(before: string, raw: string): string {
  let text =
    raw
      .replace(/^[ \t]*\n+/, "")
      .split("\n")[0]
      ?.trimEnd() ?? "";
  if (!text.trim()) return "";

  const lead = text.match(/^\s*/)?.[0] ?? "";
  const body = text.slice(lead.length);
  for (let n = Math.min(before.length, body.length); n >= MIN_ECHO; n--) {
    const echo = body.slice(0, n);
    const at = before.length - n;
    if (!before.endsWith(echo)) continue;
    if (at > 0 && !BOUNDARY.test(before[at - 1] ?? "")) continue;
    const next = body[n];
    if (
      next !== undefined &&
      !BOUNDARY.test(next) &&
      !BOUNDARY.test(echo.at(-1) ?? "")
    )
      continue;
    text = body.slice(n);
    break;
  }
  if (!text.trim()) return "";

  if (/\s$/.test(before)) return text.trimStart();
  if (UNSPACED.test(text[0] ?? "")) return text;
  // After a full stop only a capital starts a new sentence: "example.com" is one word.
  const newWord = /[,;:!?]$/.test(before)
    ? /^[\p{L}\p{N}]/u.test(text)
    : /\.$/.test(before) && /^\p{Lu}/u.test(text);
  return newWord ? ` ${text}` : text;
}

export type ShownSuggestion = { prefix: string; suggestion: string };

/**
 * What is left of a suggestion once the user typed `current`, or null when
 * they typed something else, deleted into the prefix, or typed all of it.
 */
export function typedThrough(
  shown: ShownSuggestion,
  current: string,
): string | null {
  const full = shown.prefix + shown.suggestion;
  if (current.length < shown.prefix.length || current.length >= full.length) {
    return null;
  }
  return full.startsWith(current) ? full.slice(current.length) : null;
}

/** The next word of a suggestion, with the space before it. */
export function firstWord(suggestion: string): string {
  const lead = suggestion.match(/^\s*/)?.[0] ?? "";
  const rest = suggestion.slice(lead.length);
  if (UNSPACED.test(rest[0] ?? "")) return lead + rest[0];
  return lead + (rest.match(/^\S+/)?.[0] ?? "");
}
