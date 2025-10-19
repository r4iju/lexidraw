import "server-only";

import { JSDOM } from "jsdom";
import sanitizeHtml, { type IOptions } from "sanitize-html";
import { Readability } from "@mozilla/readability";

type DistilledImage = {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
};

export type DistilledArticle = {
  status: "ready" | "processing" | "failed";
  title: string;
  byline?: string | null;
  siteName?: string | null;
  lang?: string | null;
  wordCount?: number | null;
  excerpt?: string | null;
  contentHtml: string;
  images?: DistilledImage[];
  datePublished?: string | null;
  updatedAt: string; // ISO string
};

function isHttpUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Basic private IP guard; not exhaustive but reduces SSRF surface
function isPrivateHostname(hostname: string): boolean {
  // Block localhost and .local domains; deeper DNS/IP checks would require resolver
  return (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

function absolutizeUrl(baseUrl: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return maybeRelative;
  }
}

function sanitize(contentHtml: string, baseUrl: string): string {
  const options: IOptions = {
    allowedTags: [
      "article",
      "section",
      "header",
      "footer",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "strong",
      "em",
      "a",
      "img",
      "figure",
      "figcaption",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "hr",
      "br",
      "span",
      "div",
    ],
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: ["src", "alt", "width", "height", "loading"],
      "*": ["class", "id", "aria-*", "role", "data-*"],
    },
    transformTags: {
      a: (_tagName: string, attribs) => {
        const href = attribs.href
          ? absolutizeUrl(baseUrl, attribs.href)
          : undefined;
        return {
          tagName: "a",
          attribs: {
            ...attribs,
            ...(href ? { href } : {}),
            rel: "nofollow noopener noreferrer",
            target: "_blank",
          },
        };
      },
      img: (_tagName: string, attribs) => {
        const src = attribs.src
          ? absolutizeUrl(baseUrl, attribs.src)
          : undefined;
        return {
          tagName: "img",
          attribs: {
            ...attribs,
            ...(src ? { src } : {}),
            loading: "lazy",
          },
        };
      },
    },
    allowVulnerableTags: false,
    allowIframeRelativeUrls: false,
    // Ensure scripts/styles are dropped by default
  };
  return sanitizeHtml(contentHtml, options);
}

export async function extractAndSanitizeArticle({
  url,
  html,
  timeoutMs = 15000,
  maxBytes = 8 * 1024 * 1024, // 8MB
}: {
  url: string;
  html?: string;
  timeoutMs?: number;
  maxBytes?: number;
}): Promise<DistilledArticle> {
  if (!isHttpUrl(url)) {
    throw new Error("Only http/https URLs are supported");
  }
  const { hostname } = new URL(url);
  if (isPrivateHostname(hostname)) {
    throw new Error("Private hostnames are not allowed");
  }

  let finalHtml = html;
  if (!finalHtml) {
    const controller = AbortSignal.timeout(timeoutMs);
    const res = await fetch(url, {
      method: "GET",
      headers: {
        // Modest UA; do not impersonate browsers aggressively
        "user-agent": "Lexidraw-Reader/1.0 (+https://lexidraw.app)",
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
      signal: controller,
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch URL (${res.status})`);
    }

    // Size guard
    const reader = res.body?.getReader();
    if (!reader) {
      finalHtml = await res.text();
    } else {
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          if (received > maxBytes) {
            reader.cancel();
            throw new Error("Response too large");
          }
        }
      }
      finalHtml = new TextDecoder("utf-8").decode(Buffer.concat(chunks));
    }
  }

  const dom = new JSDOM(finalHtml, { url });
  const doc = dom.window.document;
  const reader = new Readability(doc);
  const article = reader.parse();

  const title =
    article?.title ||
    doc.querySelector("meta[property='og:title']")?.getAttribute("content") ||
    doc.title ||
    new URL(url).hostname;

  const byline = article?.byline ?? null;
  const siteName =
    doc
      .querySelector("meta[property='og:site_name']")
      ?.getAttribute("content") || new URL(url).hostname;
  const lang = doc.documentElement.getAttribute("lang");
  const excerpt =
    article?.excerpt ||
    doc.querySelector("meta[name='description']")?.getAttribute("content") ||
    null;

  const contentHtmlRaw = article?.content || "";
  const contentHtml = sanitize(contentHtmlRaw, url);

  // Gather images from sanitized content
  const tempDom = new JSDOM(contentHtml);
  const images: DistilledImage[] = Array.from(
    tempDom.window.document.querySelectorAll("img"),
  ).map((img) => ({
    src: img.getAttribute("src") || "",
    alt: img.getAttribute("alt") || undefined,
    width: img.getAttribute("width")
      ? Number(img.getAttribute("width"))
      : undefined,
    height: img.getAttribute("height")
      ? Number(img.getAttribute("height"))
      : undefined,
  }));

  const wordCount = contentHtml
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

  const datePublished =
    doc
      .querySelector("meta[property='article:published_time']")
      ?.getAttribute("content") ||
    doc.querySelector("time[datetime]")?.getAttribute("datetime") ||
    null;

  return {
    status: "ready",
    title,
    byline,
    siteName,
    lang,
    wordCount,
    excerpt,
    contentHtml,
    images,
    datePublished,
    updatedAt: new Date().toISOString(),
  };
}
