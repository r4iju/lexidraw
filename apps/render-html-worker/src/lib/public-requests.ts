import {
  type Address,
  publicAddress,
  reachable,
} from "@packages/lib/public-address";
import type { HTTPRequest, Page } from "puppeteer-core";

/** Where to connect for `url`, when a rendered page may reach it at all. */
export type Check = (url: URL) => Promise<Address | undefined>;
export const publicCheck: Check = (url) => publicAddress(url);

/**
 * Lets `page` load only what is at a public http(s) address, or inline in
 * it: every request the page makes, redirects among them, is checked as it
 * is made.
 */
export async function guardRequests(page: Page, check: Check = publicCheck) {
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
