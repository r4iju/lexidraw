import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";

/** The labels of the drawing embedded in the document `checkExcalidrawAssets` opens. */
export const DRAWN_LABELS = ["Hand-drawn label", "Nunito label"];

/**
 * A document holding a drawing with text draws it with Excalidraw's fonts
 * fetched from the app, never a CDN, and embeds them into the picture from
 * a worker the app serves, rather than falling back to the page's thread.
 */
export async function checkExcalidrawAssets(page: Page, drawnId: string) {
  const tab = await page.browser().newPage();
  await tab.bringToFront();
  const outside: string[] = [];
  const workers: string[] = [];
  const errors: string[] = [];
  tab.on("request", (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && !url.startsWith(appUrl)) outside.push(url);
  });
  tab.on("workercreated", (worker) => workers.push(worker.url()));
  tab.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await tab.goto(`${appUrl}/documents/${drawnId}`, {
      waitUntil: "networkidle0",
    });
    const picture = await tab.waitForFunction(
      async () => {
        const image = document.querySelector<HTMLImageElement>(
          "img.excalidraw-embed[src]",
        );
        if (!image?.complete) return false;
        return (await fetch(image.src)).text();
      },
      { timeout: 30_000 },
    );
    const svg = String(await picture.jsonValue());

    assert.deepEqual(
      outside.filter((url) => /excalidraw|\.woff2|worker/i.test(url)),
      [],
      "Excalidraw fetches nothing from outside the app",
    );
    for (const family of ["Excalifont", "Nunito"])
      assert.match(
        svg,
        new RegExp(`font-family: ${family}; src: url\\(data:font/woff2`),
        `the picture embeds ${family}`,
      );
    assert.ok(
      workers.includes(`${appUrl}/excalidraw-assets/subset-worker.chunk.js`),
      `the fonts are cut down in the app's worker, started: ${workers.join(", ") || "none"}`,
    );
    assert.deepEqual(
      errors.filter((text) => /worker|subset/i.test(text)),
      [],
      "no worker falls back to the page's thread",
    );
  } finally {
    await tab.close();
  }
}
