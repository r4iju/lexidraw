import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";
import { signInToDev } from "@packages/dev-stack";

type Box = { left: number; top: number; width: number; height: number };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What a browser paints before any script runs: the markup up to the first
 * streamed segment, which stays hidden until the rest of the page arrives.
 */
async function firstHtml(page: Page, path: string) {
  const html = await page.evaluate(
    (url) => fetch(url).then((response) => response.text()),
    `${appUrl}${path}`,
  );
  const streamed = html.indexOf('<div hidden id="S:');
  return streamed === -1 ? html : html.slice(0, streamed);
}

/** The first shown box matching `selector`, in page coordinates. */
async function box(page: Page, selector: string): Promise<Box> {
  const found = await page.$$eval(selector, (elements) => {
    const shown = elements.find((element) => element.checkVisibility());
    if (!shown) return null;
    const rect = shown.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top + scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
  assert(found, `Nothing shown matches ${selector}`);
  return found;
}

/**
 * The page as it paints from its first flush alone, as a slow server would
 * leave it: the markup up to the first streamed segment, with its inline
 * scripts (the theme's among them) run, and nothing streamed after it.
 */
async function firstFlush<T>(
  page: Page,
  path: string,
  read: (probe: Page) => Promise<T>,
) {
  const probe = await page.browser().newPage();
  try {
    await probe.setViewport(page.viewport() ?? { width: 1280, height: 900 });
    const url = `${appUrl}${path}`;
    const shell = await firstHtml(page, path);
    await probe.setRequestInterception(true);
    probe.on("request", (request) => {
      if (request.url() === url)
        void request.respond({
          status: 200,
          contentType: "text/html",
          body: shell,
        });
      else void request.continue();
    });
    await probe.goto(url, { waitUntil: "load" });
    // Placeholders show only once a load has taken a moment.
    await pause(600);
    return await read(probe);
  } finally {
    await probe.close();
  }
}

/** The page as a browser without scripts paints it. */
async function withoutScript<T>(
  page: Page,
  path: string,
  read: () => Promise<T>,
) {
  await page.setJavaScriptEnabled(false);
  try {
    await page.goto(`${appUrl}${path}`, { waitUntil: "domcontentloaded" });
    return await read();
  } finally {
    await page.setJavaScriptEnabled(true);
  }
}

/** Relative luminance of a computed CSS colour, drawn through a canvas. */
async function luminance(page: Page, selector: string) {
  return page.$eval(selector, (element) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No canvas");
    context.fillStyle = getComputedStyle(element).backgroundColor;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });
}

function near(actual: Box, expected: Box, label: string, keys: (keyof Box)[]) {
  for (const key of keys)
    assert(
      Math.abs(actual[key] - expected[key]) <= 2,
      `${label}: the loading state's ${key} is ${actual[key]}, the page's ${expected[key]}`,
    );
}

/**
 * Each page's first HTML is its frame, in the reader's theme, with a loading
 * state laid out like the page it becomes.
 */
export async function checkFirstPaint(
  page: Page,
  {
    fixtureId,
    emptyId,
    drawingId,
  }: { fixtureId: string; emptyId: string; drawingId: string },
) {
  await page.bringToFront();
  await signInToDev(page, appUrl);
  const theme = await page.evaluate(() => localStorage.getItem("theme"));
  const routes = {
    home: "/dashboard?flex=flex-col",
    document: `/documents/${fixtureId}`,
    drawing: `/drawings/${drawingId}`,
  };
  try {
    for (const [kind, path] of Object.entries(routes)) {
      const shell = await firstHtml(page, path);
      const bar = shell.indexOf('data-component-name="AppBar"');
      assert(bar > -1, `${kind}: the first HTML holds the app bar`);
      assert(
        shell.includes(`data-loading="${kind}"`),
        `${kind}: the first HTML holds the ${kind}'s loading state`,
      );
      const script = shell.search(/<script>[^<]*localStorage/);
      assert(
        script > -1 && script < bar,
        `${kind}: the theme is set before the app bar paints`,
      );
    }

    // A dark system with no theme chosen paints dark before any script, and
    // a dark reader's first flush is dark all through.
    await page.evaluate(() => localStorage.removeItem("theme"));
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: "dark" },
    ]);
    for (const [kind, path] of Object.entries(routes)) {
      const bare = await withoutScript(page, path, () =>
        luminance(page, "body"),
      );
      assert(bare < 0.2, `${kind}: a dark system paints dark first (${bare})`);
    }
    await page.evaluate(() => localStorage.setItem("theme", "dark"));
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: "light" },
    ]);
    for (const [kind, path] of Object.entries(routes)) {
      const bar = await firstFlush(page, path, (probe) =>
        luminance(probe, '[data-component-name="AppBar"]'),
      );
      assert(
        bar < 0.2,
        `${kind}: a dark reader's first frame is dark (${bar})`,
      );
    }
    await page.evaluate(() => localStorage.setItem("theme", "light"));

    for (const [width, height] of [
      [375, 812],
      [1280, 900],
    ] as const) {
      await page.setViewport({ width, height });

      const column = await firstFlush(page, routes.document, (probe) =>
        box(probe, '[data-loading="document"] .document-content'),
      );
      await page.goto(`${appUrl}${routes.document}`, {
        waitUntil: "networkidle2",
      });
      await page.waitForSelector('[id^="lexical-content-"]');
      near(
        column,
        await box(page, '[id^="lexical-content-"]'),
        `${width} document column`,
        ["left", "width"],
      );

      // Without a cover, the title sits where its placeholder did.
      const title = await firstFlush(page, `/documents/${emptyId}`, (probe) =>
        box(probe, '[data-loading="document"] .document-title'),
      );
      await page.goto(`${appUrl}/documents/${emptyId}`, {
        waitUntil: "networkidle2",
      });
      await page.waitForSelector('[id^="lexical-content-"]');
      near(
        title,
        await box(page, ".document-title"),
        `${width} document title`,
        ["left", "top"],
      );

      const canvas = await firstFlush(page, routes.drawing, (probe) =>
        box(probe, '[data-loading="drawing"] [data-canvas]'),
      );
      await page.goto(`${appUrl}${routes.drawing}`, {
        waitUntil: "networkidle2",
      });
      await page.waitForSelector(".excalidraw");
      near(canvas, await box(page, ".excalidraw"), `${width} drawing canvas`, [
        "left",
        "top",
        "width",
        "height",
      ]);

      for (const flex of ["flex-col", "flex-row"]) {
        const path = `/dashboard?flex=${flex}`;
        const skeleton = await firstFlush(page, path, (probe) =>
          box(probe, '[data-loading="home"] [data-skeleton-item]'),
        );
        await page.goto(`${appUrl}${path}`, { waitUntil: "networkidle2" });
        near(
          skeleton,
          await box(page, 'main [id^="entity-"]'),
          `${width} Home ${flex} first item`,
          flex === "flex-col"
            ? ["left", "top", "width", "height"]
            : ["left", "width"],
        );
      }
    }

    // The sort control names its order in the server's HTML, not after mount.
    await page.setViewport({ width: 1280, height: 900 });
    const html = await page.evaluate(
      (url) => fetch(url).then((response) => response.text()),
      `${appUrl}/dashboard?sortBy=updatedAt`,
    );
    const trigger = html.match(
      /aria-label="Sort by"[^>]*>([\s\S]*?)<\/button>/,
    );
    assert(
      trigger?.[1]?.includes("Last edited"),
      "Home: the sort control shows its label from the first frame",
    );
  } finally {
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: "light" },
    ]);
    await page.evaluate((theme) => {
      if (theme) localStorage.setItem("theme", theme);
      else localStorage.removeItem("theme");
    }, theme);
  }
  console.log(
    "First paint: frame and theme in the first HTML, dark before scripts, loading states laid out like their pages, sort label",
  );
}
