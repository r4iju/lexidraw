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
  /**
   * Best representative image for the article. Priority:
   * 1) OpenGraph image (og:image)
   * 2) First <img> inside the sanitized article content
   * 3) Site favicon (link rel="icon"), else /favicon.ico
   */
  bestImageUrl?: string | null;
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
  cookiesHeader,
}: {
  url: string;
  html?: string;
  timeoutMs?: number;
  maxBytes?: number;
  /** Optional raw Cookie header string for this host, e.g. "SID=...; HSID=..." */
  cookiesHeader?: string;
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
    const fetchOnce = async (
      customHeaders: Record<string, string>,
    ): Promise<{ status: number; text: string }> => {
      const controller = AbortSignal.timeout(timeoutMs);
      const res = await fetch(url, {
        method: "GET",
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          ...customHeaders,
          ...(cookiesHeader ? { cookie: cookiesHeader } : {}),
        },
        redirect: "follow",
        signal: controller,
      });
      const text = await res.text();
      return { status: res.status, text };
    };

    // Primary attempt: modest UA
    let primary = await fetchOnce({
      "user-agent": "Lexidraw-Reader/1.0 (+https://lexidraw.app)",
    });

    // Retry once on 429/5xx
    if (primary.status === 429 || primary.status >= 500) {
      await new Promise((r) => setTimeout(r, 500));
      primary = await fetchOnce({
        "user-agent": "Lexidraw-Reader/1.0 (+https://lexidraw.app)",
      });
    }

    // If 403, try with a common browser UA and reduced accept header
    if (primary.status === 403) {
      const secondary = await fetchOnce({
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      });

      // If still 403, try AMP/mobile alternate if present in 403 body
      if (secondary.status === 403) {
        try {
          const doc403 = new JSDOM(primary.text).window.document;
          const altHref =
            doc403.querySelector("link[rel='amphtml']")?.getAttribute("href") ||
            doc403
              .querySelector("link[rel='alternate'][media]")
              ?.getAttribute("href");
          if (altHref) {
            const ampUrl = absolutizeUrl(url, altHref);
            const controller = AbortSignal.timeout(timeoutMs);
            const altRes = await fetch(ampUrl, {
              headers: {
                "user-agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                "accept-language": "en-US,en;q=0.9",
                ...(cookiesHeader ? { cookie: cookiesHeader } : {}),
              },
              signal: controller,
            });
            if (altRes.ok) {
              primary = { status: 200, text: await altRes.text() };
            } else {
              throw new Error(`AMP_FALLBACK_MISS ${altRes.status}`);
            }
          } else {
            throw new Error("AMP_FALLBACK_MISS");
          }
        } catch (e) {
          throw new Error(
            `FETCH_403_SECONDARY: Failed to fetch URL (403). ${
              e instanceof Error ? e.message : String(e)
            }`,
          );
        }
      }

      if (primary.status !== 200) {
        // Either secondary succeeded and set primary to 200, or throw
        if (secondary && secondary.status === 200) {
          // do nothing; handled above
        } else if (primary.status === 403) {
          throw new Error("FETCH_403_PRIMARY: Failed to fetch URL (403)");
        }
      }
    }

    if (primary.status !== 200) {
      throw new Error(`Failed to fetch URL (${primary.status})`);
    }

    // Size guard after we have the text: enforce maxBytes by length
    const encoder = new TextEncoder();
    const bytes = encoder.encode(primary.text);
    if (bytes.byteLength > maxBytes) {
      throw new Error("Response too large");
    }
    finalHtml = primary.text;
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

  // Choose best image
  const ogImage =
    doc.querySelector("meta[property='og:image']")?.getAttribute("content") ||
    doc.querySelector("meta[name='og:image']")?.getAttribute("content") ||
    null;
  const firstContentImg = images[0]?.src || null;
  const faviconHref =
    doc.querySelector("link[rel~='icon']")?.getAttribute("href") ||
    "/favicon.ico";
  const bestImageUrl =
    (ogImage ? absolutizeUrl(url, ogImage) : null) ||
    (firstContentImg ? absolutizeUrl(url, firstContentImg) : null) ||
    absolutizeUrl(url, faviconHref);

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
    bestImageUrl,
    updatedAt: new Date().toISOString(),
  };
}
