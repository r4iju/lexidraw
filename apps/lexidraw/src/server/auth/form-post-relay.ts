import { createHash } from "node:crypto";

const APPLE_ORIGIN = "https://appleid.apple.com";
const SUBMIT = "document.forms[0].submit()";
const SUBMIT_HASH = createHash("sha256").update(SUBMIT).digest("base64");

/**
 * Apple posts its sign-in result from its own site, and a browser keeps this
 * site's SameSite=Lax cookies (the state check, the session) off that post.
 * Posting the same fields again from this site gets them sent.
 */
export function isApplePostFromItsSite(request: Request) {
  if (request.method !== "POST") return false;
  if (!new URL(request.url).pathname.endsWith("/callback/apple")) return false;
  const site = request.headers.get("sec-fetch-site");
  // Browsers that predate Sec-Fetch-Site still send Origin on a form post.
  if (site === null) return request.headers.get("origin") === APPLE_ORIGIN;
  return site === "cross-site";
}

export async function repostFromThisSite(request: Request) {
  const fields = new URLSearchParams(await request.text());
  const inputs = [...fields]
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Signing you in</title></head><body><form method="post">${inputs}<noscript><button type="submit">Continue</button></noscript></form><script>${SUBMIT}</script></body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; script-src 'sha256-${SUBMIT_HASH}'; form-action 'self'; frame-ancestors 'none'`,
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
