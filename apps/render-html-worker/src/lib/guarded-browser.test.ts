import { afterAll, beforeAll, expect, test } from "bun:test";
import { publicAddress } from "@packages/lib/public-address";
import type { Browser } from "puppeteer-core";
import { launchGuardedBrowser } from "./guarded-browser";
import { type Check, guardRequests } from "./public-requests";

/** What the machine's own services were asked for. */
const asked: string[] = [];
let site: ReturnType<typeof Bun.serve>;

/**
 * A public site, as far as the check knows, that no DNS answers for: the
 * browser reaches it only at the address the check gave.
 */
const check: Check = async (url) =>
  url.hostname === "site.test"
    ? { address: "127.0.0.1", family: 4 }
    : publicAddress(url, async () => []);

beforeAll(() => {
  site = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      asked.push(pathname);
      if (pathname !== "/") return new Response("secret");
      const inside = `127.0.0.1:${site.port}`;
      return new Response(
        `<link rel="icon" href="data:,">
        <img src="http://${inside}/image.png">
        <img src="http://169.254.169.254/latest/meta-data/">
        <iframe src="http://localhost:${site.port}/frame"></iframe>
        <script>fetch("http://${inside}/xhr").catch(() => {})</script>`,
        { headers: { "content-type": "text/html" } },
      );
    },
  });
});
afterAll(() => site.stop(true));

async function load(guarded: (browser: Browser) => Promise<void>) {
  asked.length = 0;
  const browser = await launchGuardedBrowser({
    viewport: { width: 800, height: 600 },
    check,
  });
  try {
    await guarded(browser);
  } finally {
    await browser.close();
  }
}

test("a rendered page reaches nothing inside, whatever asks for it", async () => {
  const refused: string[] = [];
  await load(async (browser) => {
    const page = await browser.newPage();
    await guardRequests(page, check);
    page.on("requestfailed", (request) => refused.push(request.url()));
    await page.goto(`http://site.test:${site.port}/`, {
      waitUntil: "networkidle0",
    });
  });

  expect(asked).toEqual(["/"]);
  expect(refused.sort()).toEqual(
    [
      `http://127.0.0.1:${site.port}/image.png`,
      "http://169.254.169.254/latest/meta-data/",
      `http://localhost:${site.port}/frame`,
      `http://127.0.0.1:${site.port}/xhr`,
    ].sort(),
  );
}, 30_000);

/**
 * Past the per-request check the browser would look each host up again,
 * and a second answer could be an inside address.
 */
test("the browser connects only to the address that was checked", async () => {
  await load(async (browser) => {
    const page = await browser.newPage();
    const answer = await page.goto(`http://site.test:${site.port}/`, {
      waitUntil: "networkidle0",
    });
    expect(answer?.ok()).toBe(true);
  });

  expect(asked).toEqual(["/"]);
}, 30_000);
