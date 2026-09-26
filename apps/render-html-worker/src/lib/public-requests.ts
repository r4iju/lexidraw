import {
  publicAddress,
  type Resolve,
  reachable,
  systemResolve,
} from "@packages/lib/public-address";
import type { HTTPRequest, Page } from "puppeteer-core";

/**
 * Lets `page` load only what is at a public http(s) address, or inline in
 * it: every request the page makes, redirects among them, is checked as it
 * is made.
 */
export async function guardRequests(
  page: Page,
  resolve: Resolve = systemResolve,
) {
  await page.setRequestInterception(true);
  page.on("request", async (request: HTTPRequest) => {
    const src = request.url();
    const url = reachable(src);
    const allowed =
      src.startsWith("data:") ||
      src.startsWith("blob:") ||
      (url !== undefined &&
        (await publicAddress(url, resolve).catch(() => undefined)) !==
          undefined);
    await (allowed ? request.continue() : request.abort("blockedbyclient"));
  });
}
