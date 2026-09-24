/**
 * The words a person reads in a stored entity, as plain text: what search
 * matches and quotes, and what a link preview starts with. The stored JSON's
 * own vocabulary ("paragraph", "version") is never part of it.
 */
export function entityText(entityType: string, elements: string | null) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(elements ?? "");
  } catch {
    return "";
  }
  switch (entityType) {
    case "document":
      return collapse(lexicalText((parsed as { root?: unknown })?.root));
    case "drawing":
      return collapse(drawingText(parsed));
    case "url":
      return collapse(linkText(parsed));
    default:
      return "";
  }
}

/** Nodes that sit inside a line of text rather than starting one. */
const INLINE = new Set(["link", "autolink", "mark", "hashtag", "emoji"]);

function lexicalText(node: unknown): string {
  if (typeof node !== "object" || node === null) return "";
  const { text, children, type } = node as {
    text?: unknown;
    children?: unknown;
    type?: unknown;
  };
  if (typeof text === "string") return text;
  if (!Array.isArray(children)) return "";
  const inner = children.map(lexicalText).join("");
  return INLINE.has(type as string) ? inner : `${inner}\n`;
}

function drawingText(parsed: unknown): string {
  const elements = Array.isArray(parsed)
    ? parsed
    : (parsed as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return "";
  return elements
    .filter(
      (element): element is { text: string; isDeleted?: boolean } =>
        typeof element?.text === "string" && !element.isDeleted,
    )
    .map((element) => element.text)
    .join("\n");
}

function linkText(parsed: unknown): string {
  const { distilled } = (parsed ?? {}) as {
    distilled?: { excerpt?: unknown; contentHtml?: unknown };
  };
  const html =
    typeof distilled?.contentHtml === "string" ? distilled.contentHtml : "";
  const excerpt =
    typeof distilled?.excerpt === "string" ? distilled.excerpt : "";
  return `${excerpt}\n${html.replace(/<[^>]*>/g, " ")}`;
}

function collapse(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * About a line of `text` around the first place `query` appears, with an
 * ellipsis where it was cut; null when the query isn't in the text.
 */
export function snippetAround(text: string, query: string, length = 110) {
  const at = text.toLowerCase().indexOf(query.trim().toLowerCase());
  if (at < 0 || !query.trim()) return null;
  const lead = Math.round(length / 3);
  let start = Math.max(0, at - lead);
  let end = Math.min(text.length, start + length);
  start = Math.max(0, Math.min(start, end - length));
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space > 0 && space < at) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > at + query.length) end = space;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
