import assert from "node:assert/strict";
import type { HTTPRequest, Page } from "puppeteer";
import { appUrl } from "./app-url";
import { setAutoSave } from "./check-frame";
import { signInToDev } from "./check-typography";

const CONTENT = '[id^="lexical-content-"]';
const IMAGE = 'img[alt="A banner"]';
const DRAWING = "img.excalidraw-embed";
export const BANNER = "/images/banner.png";

type Box = { left: number; top: number; width: number; height: number };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A tab whose requests matching `held` wait until released, as on a slow
 * network, and which records every layout shift from its first paint on.
 */
async function slowTab(page: Page, held: (url: string) => boolean) {
  const tab = await page.browser().newPage();
  await tab.bringToFront();
  let waiting: HTTPRequest[] = [];
  let holding = true;
  await tab.setRequestInterception(true);
  tab.on("request", (request) => {
    if (holding && held(request.url())) waiting.push(request);
    else void request.continue();
  });
  await tab.evaluateOnNewDocument(() => {
    const shifts: { value: number; sources: string[] }[] = [];
    (window as unknown as { shifts: typeof shifts }).shifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        sources?: { node?: Node | null }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        shifts.push({
          value: entry.value,
          sources: (entry.sources ?? []).map(
            ({ node }) =>
              (node instanceof Element
                ? `${node.tagName}.${node.className}`
                : node?.nodeName) ?? "?",
          ),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  return {
    tab,
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      for (const request of waiting) void request.continue();
      waiting = [];
    },
    shifts: () =>
      tab.evaluate(
        () =>
          (
            window as unknown as {
              shifts: { value: number; sources: string[] }[];
            }
          ).shifts,
      ),
  };
}

async function box(page: Page, selector: string): Promise<Box> {
  const found = await page.$eval(selector, (element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top + scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
  return found;
}

/** Waits for an image to be drawn, not only fetched. */
async function imageShown(page: Page, selector = IMAGE) {
  await page.waitForFunction(
    (selector) => {
      const image = document.querySelector<HTMLImageElement>(selector);
      return Boolean(
        image?.complete && image.naturalWidth && image.checkVisibility(),
      );
    },
    { timeout: 20_000 },
    selector,
  );
}

/**
 * Media keeps its place while it loads: an image, a diagram and a drawing
 * reserve the box they will fill, from the natural size stored the first time they
 * loaded, or 16:9 before anyone has seen them; and a button keeps its width
 * while it shows a spinner.
 */
export async function checkReservedSizes(
  page: Page,
  { sizedId, emptyId }: { sizedId: string; emptyId: string },
) {
  await page.bringToFront();
  await signInToDev(page);
  const path = `${appUrl}/documents/${sizedId}`;
  // Not the sized document: opening it is what measures it.
  const elsewhere = `${appUrl}/documents/${emptyId}`;
  await page.goto(elsewhere, { waitUntil: "networkidle2" });
  await page.waitForSelector(CONTENT);
  const autoSave = await setAutoSave(page, true);
  try {
    const banner = (url: string) => url.includes(BANNER);
    const first = await slowTab(page, banner);
    await first.tab.setViewport({ width: 1280, height: 900 });
    await first.tab.goto(path, { waitUntil: "domcontentloaded" });
    await first.tab.waitForSelector(`${CONTENT} p`);
    await pause(300);
    const unknown = await box(first.tab, '.editor-image [aria-busy="true"]');
    assert(
      Math.abs(unknown.width / unknown.height - 16 / 9) < 0.02,
      `An image never measured reserves 16:9, not ${unknown.width}×${unknown.height}`,
    );
    first.release();
    await imageShown(first.tab);
    await first.tab.waitForSelector("img[data-mermaid]");
    await imageShown(first.tab, DRAWING);
    // The measurement saves like an edit, after auto-save's pause.
    await pause(2500);
    await first.tab.close();

    for (const [width, height] of [
      [1280, 900],
      [375, 812],
    ] as const) {
      const slow = await slowTab(page, banner);
      await slow.tab.setViewport({ width, height });
      await slow.tab.goto(path, { waitUntil: "domcontentloaded" });
      await slow.tab.waitForSelector("img[data-mermaid]", { timeout: 20_000 });
      await pause(300);
      const reserved = await box(slow.tab, '.editor-image [aria-busy="true"]');
      slow.release();
      await imageShown(slow.tab);
      await imageShown(slow.tab, DRAWING);
      await pause(300);
      const shown = await box(slow.tab, IMAGE);
      for (const key of ["left", "top", "width", "height"] as const)
        assert(
          Math.abs(reserved[key] - shown[key]) <= 1,
          `${width}: the image reserves its ${key} (${reserved[key]}, then ${shown[key]})`,
        );
      const shifts = await slow.shifts();
      const total = shifts.reduce((sum, { value }) => sum + value, 0);
      assert(
        total < 0.005,
        `${width}: nothing moves as the page loads (${total.toFixed(4)}: ${JSON.stringify(shifts)})`,
      );
      await slow.tab.close();
    }

    // A button that shows a spinner while it works keeps its width.
    const rename = (url: string) => url.includes("entities.update");
    const busy = await slowTab(page, rename);
    await busy.tab.setViewport({ width: 1280, height: 900 });
    await busy.tab.goto(path, { waitUntil: "networkidle2" });
    await busy.tab
      .locator(
        '[data-component-name="AppBar"] button[aria-label="Document actions"]',
      )
      .click();
    await busy.tab.waitForSelector('[role="menu"]', { visible: true });
    await busy.tab.evaluate(() => {
      const item = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((element) => element.textContent?.trim().startsWith("Rename"));
      if (!item) throw new Error("Missing Rename");
      item.click();
    });
    await busy.tab.waitForSelector('[role="dialog"] button[type="submit"]');
    await pause(300);
    const submit = '[role="dialog"] button[type="submit"]';
    const idle = await box(busy.tab, submit);
    await busy.tab.locator(`${submit}`).click();
    await busy.tab.waitForSelector(`${submit}[aria-busy="true"]`);
    const working = await box(busy.tab, submit);
    assert.deepEqual(
      working,
      idle,
      "A button keeps its size while it shows its spinner",
    );
    busy.release();
    await busy.tab.close();
  } finally {
    await page.bringToFront();
    await page.goto(elsewhere, { waitUntil: "networkidle2" });
    await setAutoSave(page, autoSave);
  }
  console.log(
    "Reserved sizes: 16:9 before a first load, the stored natural size after, nothing moves, spinner buttons keep their width",
  );
}
