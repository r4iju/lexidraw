import "server-only";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import sanitizeHtml from "sanitize-html";

export type ExtractedArticle = {
  title: string;
  contentText: string; // plain text
  byline?: string | null;
};

export async function extractArticleFromUrl(
  url: string,
  opts?: { maxChars?: number; keepQuotes?: boolean },
): Promise<ExtractedArticle> {
  const res = await fetch(url, {
    // identify politely; user agent may be proxied by platform
    headers: { accept: "text/html,application/xhtml+xml" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch article: ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;
  const reader = new Readability(doc);
  const article = reader.parse();
  const title = article?.title?.trim() || (doc.title || "").trim();
  const safeHtml = sanitizeHtml(article?.content || "", {
    allowedTags: [
      "p",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "blockquote",
      "strong",
      "em",
      "code",
      "pre",
      "br",
    ],
    allowedAttributes: { "*": [] },
    exclusiveFilter: (frame) => frame.tag === "script" || frame.tag === "style",
  });
  let contentText = htmlToPlainText(safeHtml);
  if (opts?.keepQuotes === false) {
    // remove long quoted blocks heuristically (lines starting with ">" or wrapped in quotes)
    contentText = contentText
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (trimmed.startsWith(">")) return false;
        if (trimmed.length > 80 && /^".*"$/.test(trimmed)) return false;
        return true;
      })
      .join("\n")
      .trim();
  }
  if (typeof opts?.maxChars === "number" && opts.maxChars > 0) {
    contentText = contentText.slice(0, opts.maxChars);
  }
  return { title, contentText, byline: article?.byline ?? null };
}

function htmlToPlainText(html: string): string {
  // rough: replace block tags with newlines; collapse whitespace
  const withBreaks = html
    .replace(/<\/(p|div|h[1-6]|li|blockquote|pre)>/gi, "\n")
    .replace(/<br\s*\/?>(?=\s*\n?)/gi, "\n");
  const noTags = withBreaks.replace(/<[^>]+>/g, "");
  return noTags
    .replace(/\r\n|\r|\n/g, "\n")
    .replace(/[\t\u00A0]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
