import {
  type Address,
  publicAddress,
  reachable,
} from "@packages/lib/public-address";
import type { HTTPRequest, Page } from "puppeteer-core";

/** Where to connect for `url`, when a rendered page may reach it at all. */
export type Check = (url: URL) => Promise<Address | undefined>;

/**
 * What a rendered page may reach: public addresses, and wherever they are,
 * the origins `allowed` names exactly, such as the app's own in development.
 * An allowed origin is reached by its name, as this machine resolves it.
 */
export function renderCheck(
  allowed = process.env.RENDER_WORKER_ALLOWED_ORIGINS ?? "",
): Check {
  const origins = new Set(
    allowed
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => new URL(origin).origin),
  );
  return (url) =>
    origins.has(url.origin)
      ? Promise.resolve({
          address: url.hostname.replace(/^\[|\]$/g, ""),
          family: 0,
        })
      : publicAddress(url);
}

/**
 * Lets `page` load only what is at a public http(s) address, or inline in
 * it: every request the page makes, redirects among them, is checked as it
 * is made.
 */
export async function guardRequests(page: Page, check: Check) {
  await page.setRequestInterception(true);
  page.on("request", async (request: HTTPRequest) => {
    const src = request.url();
    const url = reachable(src);
    const allowed =
      src.startsWith("data:") ||
      src.startsWith("blob:") ||
      (url !== undefined &&
        (await check(url).catch(() => undefined)) !== undefined);
    await (allowed ? request.continue() : request.abort("blockedbyclient"));
  });
}
