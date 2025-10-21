import "server-only";

import { JSDOM } from "jsdom";
import sanitizeHtml, { type IOptions } from "sanitize-html";
import { Readability } from "@mozilla/readability";
import { z } from "zod";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { getNordHttpsProxyUrls } from "../network/nord-proxy";
import env from "@packages/env";

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

function devLog(...args: unknown[]) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[extract]", ...args);
  }
}

function computeWordCount(html: string): number {
  return html
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function pickLargestTextContainer(document: Document): Element | null {
  const candidates = Array.from(
    document.querySelectorAll(
      "article, main, [role='main'], #content, .content, .article-body, .entry-content, .post-content",
    ),
  );
  if (candidates.length === 0) return null;
  let best: { el: Element; score: number } | null = null;
  for (const el of candidates) {
    const text = el.textContent?.trim() || "";
    const score = text.length;
    if (!best || score > best.score) best = { el, score };
  }
  return best?.el ?? null;
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

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textToHtml(text: string): string {
  const blocks = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (blocks.length === 0) return "";
  return blocks.map((p) => `<p>${escapeHtmlText(p)}</p>`).join("\n");
}

function extractJsonLdArticle(document: Document): {
  html: string;
  bestImageUrl?: string | null;
} | null {
  const scripts = Array.from(
    document.querySelectorAll("script[type='application/ld+json']"),
  );

  // Schemas and helpers
  const ImageObjectSchema = z.object({ url: z.string() }).passthrough();
  const ImageSchema = z.union([
    z.string(),
    ImageObjectSchema,
    z.array(z.union([z.string(), ImageObjectSchema])),
  ]);
  const ArticleLikeSchema = z
    .object({
      "@type": z.union([z.string(), z.array(z.string())]),
      articleBody: z.string().optional(),
      text: z.string().optional(),
      image: ImageSchema.optional(),
    })
    .passthrough();

  const isArticleType = (t: string | string[]): boolean => {
    const arr = Array.isArray(t) ? t : [t];
    return arr.some(
      (v) => v === "Article" || v === "NewsArticle" || v === "BlogPosting",
    );
  };

  type JsonLdImage = z.infer<typeof ImageSchema>;
  const firstImageUrl = (image?: JsonLdImage): string | null => {
    if (!image) return null;
    if (typeof image === "string") return image;
    if (Array.isArray(image)) {
      for (const item of image) {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const urlVal = (item as Record<string, unknown>).url;
          if (typeof urlVal === "string") return urlVal;
        }
      }
      return null;
    }
    if (image && typeof image === "object") {
      const urlVal = (image as Record<string, unknown>).url;
      return typeof urlVal === "string" ? urlVal : null;
    }
    return null;
  };

  const collectObjects = (root: unknown): unknown[] => {
    if (Array.isArray(root)) return root;
    if (root && typeof root === "object") {
      const maybeGraph = (root as Record<string, unknown>)["@graph"];
      if (Array.isArray(maybeGraph)) return maybeGraph as unknown[];
    }
    return [root];
  };

  const candidates: Array<{ html: string; bestImageUrl?: string | null }> = [];
  for (const s of scripts) {
    const raw = s.textContent || "";
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw);
      const objects = collectObjects(parsed);
      for (const obj of objects) {
        const parsedObj = ArticleLikeSchema.safeParse(obj);
        if (!parsedObj.success) continue;
        const data = parsedObj.data;
        if (!isArticleType(data["@type"])) continue;
        const body = (data.articleBody ?? data.text ?? "").trim();
        if (!body) continue;
        const html = textToHtml(body);
        if (!html) continue;
        const bestImageUrl = firstImageUrl(data.image);
        candidates.push({ html, bestImageUrl });
      }
    } catch {
      // ignore JSON parse errors in LD+JSON blocks
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.html.length - a.html.length);
  return candidates[0] ?? null;
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
  // replace username and password with *
  const loggableUrl = url.replace(/https?:\/\/[^/]+@/, "https://***@");

  // Build dispatcher attempts: 1 direct + up to 20 Nord HTTPS proxies
  let attemptDispatchers: Array<{ label: string; dispatcher?: unknown }> = [
    { label: "direct", dispatcher: undefined },
  ];
  try {
    const user = env.NORDVPN_SERVICE_USER;
    const pass = env.NORDVPN_SERVICE_PASS;
    if (user && pass) {
      const urls = (
        await getNordHttpsProxyUrls({ user, pass, limit: 50 })
      ).slice(0, 20);
      attemptDispatchers = [
        { label: "direct", dispatcher: undefined },
        ...urls.map((proxyUrl) => ({
          label: `proxy:${proxyUrl}`,
          dispatcher: new ProxyAgent(proxyUrl),
        })),
      ];
    }
  } catch (e) {
    devLog(
      "nord:proxy_fetch_error",
      e instanceof Error ? e.message : String(e),
    );
  }

  type AttemptResult = {
    distilled: DistilledArticle;
    qualityWords: number;
    qualityChars: number;
  };
  let best: AttemptResult | null = null;
  let lastError: unknown = null;

  const runAttempt = async (dispatcher: unknown): Promise<AttemptResult> => {
    const performFetch = (
      input: string,
      init: RequestInit & { dispatcher?: unknown } = {} as any,
    ) => {
      // use undici's fetch with dispatcher for proxy support
      return undiciFetch(input, { ...init, dispatcher } as any);
    };

    let finalHtml = html;
    if (!finalHtml) {
      devLog("fetch:start", {
        url: loggableUrl,
        withCookies: Boolean(cookiesHeader),
      });
      const fetchOnce = async (
        customHeaders: Record<string, string>,
      ): Promise<{ status: number; text: string }> => {
        const controller = AbortSignal.timeout(timeoutMs);
        const res = await performFetch(url, {
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
        } as any);
        const text = await res.text();
        devLog("fetch:done", { status: res.status, length: text.length });
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
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        });

        // If still 403, try AMP/mobile alternate if present in 403 body
        if (secondary.status === 403) {
          try {
            const doc403 = new JSDOM(primary.text).window.document;
            const altHref =
              doc403
                .querySelector("link[rel='amphtml']")
                ?.getAttribute("href") ||
              doc403
                .querySelector("link[rel='alternate'][media]")
                ?.getAttribute("href");
            if (altHref) {
              const ampUrl = absolutizeUrl(url, altHref);
              const controller = AbortSignal.timeout(timeoutMs);
              const altRes = await performFetch(ampUrl, {
                headers: {
                  "user-agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                  "accept-language": "en-US,en;q=0.9",
                  ...(cookiesHeader ? { cookie: cookiesHeader } : {}),
                },
                signal: controller,
              } as any);
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
      devLog("fetch:primary_ok", { chars: finalHtml.length });
    }

    const dom = new JSDOM(finalHtml, { url });
    const doc = dom.window.document;
    const reader = new Readability(doc);
    const article = reader.parse();
    devLog("readability:parsed", {
      hasArticle: Boolean(article),
      contentChars: article?.content?.length || 0,
      title: article?.title || null,
      byline: article?.byline || null,
      excerptChars: article?.excerpt?.length || 0,
    });

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
    let selectedContentHtml = sanitize(contentHtmlRaw, url);
    let selectedDocForMeta: Document = doc;

    const initialWordCount = computeWordCount(selectedContentHtml);
    const isTooShort =
      selectedContentHtml.length < 200 || initialWordCount < 50;
    devLog("sanitize:primary", {
      chars: selectedContentHtml.length,
      words: initialWordCount,
      tooShort: isTooShort,
    });

    // Fallback 1: Try AMP/alternate even if original fetch was 200
    if (isTooShort) {
      try {
        const altHref =
          doc.querySelector("link[rel='amphtml']")?.getAttribute("href") ||
          doc
            .querySelector("link[rel='alternate'][media]")
            ?.getAttribute("href");
        devLog("fallback:amp:link", { hasAlt: Boolean(altHref), altHref });
        if (altHref) {
          const ampUrl = absolutizeUrl(url, altHref);
          const controller = AbortSignal.timeout(timeoutMs);
          const altRes = await performFetch(ampUrl, {
            headers: {
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
              "accept-language": "en-US,en;q=0.9",
              ...(cookiesHeader ? { cookie: cookiesHeader } : {}),
            },
            signal: controller,
          });
          devLog("fallback:amp:response", { status: altRes.status });
          if (altRes.ok) {
            const altHtml = await altRes.text();
            const altDom = new JSDOM(altHtml, { url: ampUrl });
            const altDoc = altDom.window.document;
            const altReader = new Readability(altDoc);
            const altArticle = altReader.parse();
            const altRaw = altArticle?.content || "";
            const altSanitized = sanitize(altRaw, ampUrl);
            const altCount = computeWordCount(altSanitized);
            if (
              altSanitized.length > selectedContentHtml.length ||
              altCount > initialWordCount
            ) {
              selectedContentHtml = altSanitized;
              selectedDocForMeta = altDoc;
              devLog("fallback:amp:chosen", {
                prevChars: selectedContentHtml.length,
                prevWords: initialWordCount,
                altChars: altSanitized.length,
                altWords: altCount,
              });
            }
          }
        }
      } catch {
        // ignore; proceed to DOM fallback
      }
    }

    // Fallback 2: Pick largest common content container if still short
    const afterAmpCount = computeWordCount(selectedContentHtml);
    const stillShort = selectedContentHtml.length < 200 || afterAmpCount < 50;
    if (stillShort) {
      try {
        const selector =
          "article, main, [role='main'], #content, .content, .article-body, .entry-content, .post-content";
        const all = Array.from(selectedDocForMeta.querySelectorAll(selector));
        devLog("fallback:dom:candidates", { count: all.length });
        const container = pickLargestTextContainer(selectedDocForMeta);
        if (container) {
          const desc = (() => {
            const id = container.getAttribute("id");
            const cls = container.getAttribute("class");
            return `${container.tagName.toLowerCase()}${id ? `#${id}` : ""}${
              cls ? `.${cls.split(/\s+/).slice(0, 2).join(".")}` : ""
            }`;
          })();
          const fallbackSanitized = sanitize(container.innerHTML, url);
          const fallbackCount = computeWordCount(fallbackSanitized);
          if (
            fallbackSanitized.length > selectedContentHtml.length ||
            fallbackCount > afterAmpCount
          ) {
            devLog("fallback:dom:chosen", {
              container: desc,
              prevChars: selectedContentHtml.length,
              prevWords: afterAmpCount,
              fallbackChars: fallbackSanitized.length,
              fallbackWords: fallbackCount,
            });
            selectedContentHtml = fallbackSanitized;
          }
        }
      } catch {
        // ignore
      }
    }

    // Fallback 3: Canonical URL fetch if still short
    const afterDomCount = computeWordCount(selectedContentHtml);
    const stillShortAfterDom =
      selectedContentHtml.length < 200 || afterDomCount < 50;
    if (stillShortAfterDom) {
      try {
        const canonicalHref = doc
          .querySelector("link[rel='canonical']")
          ?.getAttribute("href");
        const canonicalUrl = canonicalHref
          ? absolutizeUrl(url, canonicalHref)
          : null;
        devLog("fallback:canonical:link", {
          hasCanonical: Boolean(canonicalHref),
          canonicalHref,
          canonicalUrl,
        });
        if (canonicalUrl && canonicalUrl !== url) {
          const controller = AbortSignal.timeout(timeoutMs);
          const canRes = await performFetch(canonicalUrl, {
            headers: {
              "user-agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
              "accept-language": "en-US,en;q=0.9",
              ...(cookiesHeader ? { cookie: cookiesHeader } : {}),
            },
            signal: controller,
          });
          devLog("fallback:canonical:response", { status: canRes.status });
          if (canRes.ok) {
            const canHtml = await canRes.text();
            const canDom = new JSDOM(canHtml, { url: canonicalUrl });
            const canDoc = canDom.window.document;
            const canReader = new Readability(canDoc);
            const canArticle = canReader.parse();
            const canRaw = canArticle?.content || "";
            const canSanitized = sanitize(canRaw, canonicalUrl);
            const canCount = computeWordCount(canSanitized);
            if (
              canSanitized.length > selectedContentHtml.length ||
              canCount > afterDomCount
            ) {
              selectedContentHtml = canSanitized;
              selectedDocForMeta = canDoc;
              devLog("fallback:canonical:chosen", {
                prevChars: selectedContentHtml.length,
                prevWords: afterDomCount,
                canChars: canSanitized.length,
                canWords: canCount,
              });
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // Fallback 4: JSON-LD articleBody/text if still short
    const afterCanonicalCount = computeWordCount(selectedContentHtml);
    const stillShortAfterCanonical =
      selectedContentHtml.length < 200 || afterCanonicalCount < 50;
    if (stillShortAfterCanonical) {
      try {
        const jsonLd = extractJsonLdArticle(selectedDocForMeta);
        devLog("fallback:jsonld:found", {
          has: Boolean(jsonLd),
          chars: jsonLd?.html.length || 0,
        });
        if (jsonLd?.html) {
          const jsonLdSanitized = sanitize(jsonLd.html, url);
          const jsonLdCount = computeWordCount(jsonLdSanitized);
          if (
            jsonLdSanitized.length > selectedContentHtml.length ||
            jsonLdCount > afterCanonicalCount
          ) {
            selectedContentHtml = jsonLdSanitized;
            devLog("fallback:jsonld:chosen", {
              prevChars: selectedContentHtml.length,
              prevWords: afterCanonicalCount,
              jsonLdChars: jsonLdSanitized.length,
              jsonLdWords: jsonLdCount,
            });
          }
        }
      } catch {
        // ignore
      }
    }

    // Fallback 5: Inspect iframes (srcdoc and same-origin src)
    const afterJsonLdCount = computeWordCount(selectedContentHtml);
    const stillShortAfterJsonLd =
      selectedContentHtml.length < 200 || afterJsonLdCount < 50;
    if (stillShortAfterJsonLd) {
      try {
        const iframes = Array.from(
          selectedDocForMeta.querySelectorAll("iframe"),
        );
        devLog("fallback:iframe:candidates", { count: iframes.length });
        const baseHost = new URL(url).host;
        for (const iframe of iframes.slice(0, 3)) {
          // Try srcdoc first
          const srcdoc = iframe.getAttribute("srcdoc");
          if (srcdoc?.trim().length) {
            try {
              const sdDom = new JSDOM(srcdoc, { url });
              const sdDoc = sdDom.window.document;
              const sdReader = new Readability(sdDoc);
              const sdArticle = sdReader.parse();
              const sdRaw = sdArticle?.content || sdDoc.body?.innerHTML || "";
              const sdSanitized = sanitize(sdRaw, url);
              const sdCount = computeWordCount(sdSanitized);
              if (
                sdSanitized.length > selectedContentHtml.length ||
                sdCount > afterJsonLdCount
              ) {
                selectedContentHtml = sdSanitized;
                selectedDocForMeta = sdDoc;
                devLog("fallback:iframe:chosen", {
                  type: "srcdoc",
                  prevChars: selectedContentHtml.length,
                  prevWords: afterJsonLdCount,
                  newChars: sdSanitized.length,
                  newWords: sdCount,
                });
                break;
              }
            } catch {
              // ignore parse errors
            }
          }

          // Try same-origin src
          const src = iframe.getAttribute("src");
          if (!src) continue;
          try {
            const abs = absolutizeUrl(url, src);
            if (!isHttpUrl(abs)) {
              devLog("fallback:iframe:bad_url", { src, abs });
              continue;
            }
            const childHost = new URL(abs).host;
            if (childHost !== baseHost) {
              devLog("fallback:iframe:skip_cross_origin", { src: abs });
              continue; // avoid fetching arbitrary third-party frames
            }
            const controller = AbortSignal.timeout(timeoutMs);
            const frRes = await performFetch(abs, {
              headers: {
                "user-agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
                "accept-language": "en-US,en;q=0.9",
                ...(cookiesHeader ? { cookie: cookiesHeader } : {}),
              },
              signal: controller,
            });
            devLog("fallback:iframe:response", {
              status: frRes.status,
              url: abs,
            });
            if (!frRes.ok) continue;
            const frHtml = await frRes.text();
            const frDom = new JSDOM(frHtml, { url: abs });
            const frDoc = frDom.window.document;
            const frReader = new Readability(frDoc);
            const frArticle = frReader.parse();
            const frRaw = frArticle?.content || frDoc.body?.innerHTML || "";
            const frSanitized = sanitize(frRaw, abs);
            const frCount = computeWordCount(frSanitized);
            if (
              frSanitized.length > selectedContentHtml.length ||
              frCount > afterJsonLdCount
            ) {
              selectedContentHtml = frSanitized;
              selectedDocForMeta = frDoc;
              devLog("fallback:iframe:chosen", {
                type: "src",
                frameUrl: abs,
                prevChars: selectedContentHtml.length,
                prevWords: afterJsonLdCount,
                newChars: frSanitized.length,
                newWords: frCount,
              });
              break;
            }
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }
    }

    // Gather images from selected sanitized content
    const tempDom = new JSDOM(selectedContentHtml);
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

    const wordCount = computeWordCount(selectedContentHtml);

    const datePublished =
      doc
        .querySelector("meta[property='article:published_time']")
        ?.getAttribute("content") ||
      doc.querySelector("time[datetime]")?.getAttribute("datetime") ||
      null;

    // Choose best image
    const ogImage =
      selectedDocForMeta
        .querySelector("meta[property='og:image']")
        ?.getAttribute("content") ||
      selectedDocForMeta
        .querySelector("meta[name='og:image']")
        ?.getAttribute("content") ||
      null;
    const firstContentImg = images[0]?.src || null;
    const faviconHref =
      selectedDocForMeta
        .querySelector("link[rel~='icon']")
        ?.getAttribute("href") || "/favicon.ico";
    const bestImageUrl =
      (ogImage ? absolutizeUrl(url, ogImage) : null) ||
      (firstContentImg ? absolutizeUrl(url, firstContentImg) : null) ||
      absolutizeUrl(url, faviconHref);
    devLog("images:summary", {
      hasOg: Boolean(ogImage),
      hasContentImg: Boolean(firstContentImg),
      favicon: faviconHref,
      bestImageUrl,
    });

    const result: DistilledArticle = {
      status: "ready",
      title,
      byline,
      siteName,
      lang,
      wordCount,
      excerpt,
      contentHtml: selectedContentHtml,
      images,
      datePublished,
      bestImageUrl,
      updatedAt: new Date().toISOString(),
    };
    devLog("result", {
      title,
      words: wordCount,
      chars: selectedContentHtml.length,
    });
    return {
      distilled: result,
      qualityWords: wordCount || 0,
      qualityChars: selectedContentHtml.length,
    };
  };

  // Try direct + randomized proxies until quality threshold is met
  for (const { label, dispatcher } of attemptDispatchers) {
    const loggableLabel = label.replace(/https?:\/\/[^/]+@/, "https://***@");
    try {
      devLog("attempt", { transport: loggableLabel });
      const { distilled, qualityWords, qualityChars } =
        await runAttempt(dispatcher);
      const isGood = (qualityWords ?? 0) >= 50 && (qualityChars ?? 0) >= 200;
      if (
        !best ||
        qualityWords > best.qualityWords ||
        qualityChars > best.qualityChars
      ) {
        best = { distilled, qualityWords, qualityChars };
      }
      if (isGood) return distilled;
      // otherwise continue to next proxy
    } catch (e) {
      lastError = e;
      devLog("attempt:error", {
        transport: loggableLabel,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
  }

  if (best) {
    return best.distilled;
  }
  // All attempts failed
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to distill article: all attempts failed");
}
