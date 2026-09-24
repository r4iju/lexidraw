import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { signInToDev } from "./check-typography";

export async function checkMedia(
  page: Page,
  fixtureId: string,
  output: string,
) {
  await signInToDev(page);
  await page.goto(`http://localhost:3025/documents/${fixtureId}`, {
    waitUntil: "networkidle2",
  });
  for (const [width, height] of [
    [375, 812],
    [768, 1024],
    [1280, 900],
  ] as const) {
    await page.setViewport({ width: width, height: height });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) =>
          document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      );
      await page.waitForSelector('img[alt="Tall hero · 2000px"]');
      const hero = await page.$eval(
        'img[alt="Tall hero · 2000px"]',
        (image) => {
          const rect = image.getBoundingClientRect();
          const root = image
            .closest(".document-content")
            ?.getBoundingClientRect();
          if (!root) throw new Error("Missing document column");
          return {
            width: rect.width,
            height: rect.height,
            center: rect.x + rect.width / 2,
            columnCenter: root.x + root.width / 2,
            filter: getComputedStyle(image).filter,
          };
        },
      );
      assert(
        hero.height <= height * 0.8 + 1,
        `Tall image must fit 80% of ${height}px; got ${hero.height}`,
      );
      assert(
        Math.abs(hero.width / hero.height - 0.5) < 0.01,
        "Tall image keeps its aspect ratio",
      );
      assert(
        Math.abs(hero.center - hero.columnCenter) < 2,
        "Standalone image is centered",
      );
      assert.equal(hero.filter, "none", "Photos are never inverted");
      assert(
        await page.$('img[src="/images/image-broken.svg"]'),
        "Broken image has a placeholder",
      );
      assert(
        await page.$eval(".document-content", (root) =>
          root.textContent?.includes("Missing landscape · 画像なし"),
        ),
        "Broken image exposes its alt text",
      );

      const media = await page.$$eval(
        '.document-content iframe, .document-content video, .document-content img, .document-content .recharts-wrapper, .document-content [data-node-type="page-break"], .document-content .slide-view-outer-viewport',
        (elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              label:
                element.getAttribute("title") ||
                element.getAttribute("alt") ||
                element.tagName,
              left: rect.left,
              right: rect.right,
              width: rect.width,
              height: rect.height,
            };
          }),
      );
      for (const item of media)
        assert(
          item.left >= 15 && item.right <= width - 15,
          `${item.label} must fit the column at ${width}: ${JSON.stringify(item)}`,
        );
      const chart = await page.$eval(".recharts-wrapper", (e) => ({
        width: e.getBoundingClientRect().width,
        height: e.getBoundingClientRect().height,
      }));
      assert(
        Math.abs(chart.width / chart.height - 2) < 0.02,
        "Default chart is 2:1",
      );
      for (const selector of ["video", 'iframe[title="YouTube video"]']) {
        const ratio = await page.$eval(
          selector,
          (e) =>
            e.getBoundingClientRect().width / e.getBoundingClientRect().height,
        );
        assert(Math.abs(ratio - 16 / 9) < 0.02, `${selector} defaults to 16:9`);
      }
      if (width === 375) {
        const columns = await page.$$eval(".document-column", (els) =>
          els.map((e) => e.getBoundingClientRect().toJSON()),
        );
        assert(
          columns[1] && columns[0] && columns[1].top >= columns[0].bottom,
          "Columns stack on a phone",
        );
      }
      assert(
        await page.$eval(".document-content", (e) =>
          e.textContent?.includes("Edit chart to add data"),
        ),
        "Empty chart explains how to add data",
      );
      assert(
        await page.$eval(".document-content", (e) =>
          e.textContent?.includes("Edit slides to add"),
        ),
        "Empty slide deck explains how to add slides",
      );

      const poll = await page.$eval("[data-poll]", (e) => ({
        rect: e.getBoundingClientRect().toJSON(),
        text: e.textContent,
      }));
      assert(
        Math.abs(poll.rect.x + poll.rect.width / 2 - width / 2) < 2,
        "Poll is centered",
      );
      assert(
        poll.rect.width <= Math.min(520, width - 32),
        "Poll fits column and caps at 520px",
      );
      assert(
        poll.text?.includes("2 votes · 67%") &&
          poll.text.includes("3 votes total"),
      );
      const sticky = await page.$eval(".sticky-note-container", (e) => ({
        inDocument: Boolean(e.closest(".document-content")),
        position: getComputedStyle(e).position,
      }));
      assert(sticky.inDocument, "Sticky note belongs to the document flow");
      if (width === 375)
        assert.equal(
          sticky.position,
          "static",
          "Compact sticky cannot cover text",
        );
      const drawingFilter = await page.$eval(
        'img[alt="Excalidraw"]',
        (e) => getComputedStyle(e).filter,
      );
      assert.equal(
        drawingFilter !== "none",
        theme === "dark",
        "Drawing follows screen theme",
      );
      for (const selector of [
        'iframe[title="Figma Embed"]',
        'iframe[title="YouTube video"]',
      ]) {
        assert.equal(
          await page.$eval(selector, (e) => getComputedStyle(e).colorScheme),
          "normal",
        );
      }
    }
  }

  await page.setViewport({ width: 1280, height: 900 });
  await page.$eval(".document-viewport", (e) => {
    if (e instanceof HTMLElement) e.style.width = "500px";
  });
  const narrowed = await page.$$eval(".document-column", (els) =>
    els.map((e) => e.getBoundingClientRect().toJSON()),
  );
  assert(
    narrowed[1] && narrowed[0] && narrowed[1].top >= narrowed[0].bottom,
    "Columns stack when a sidebar narrows the container",
  );
  await page.$eval(".document-viewport", (e) => {
    if (e instanceof HTMLElement) e.style.width = "";
  });
  await page.emulateMediaType("print");
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  const lead = await page.$$eval(".document-content p", (elements) => {
    const paragraph = elements.find(
      (e) => e.textContent === "The following figure shows the blue sky.",
    );
    return paragraph && getComputedStyle(paragraph).breakAfter;
  });
  assert.equal(lead, "avoid", "A lead-in stays with its figure");
  const print = await page.$eval('img[alt="Tall hero · 2000px"]', (e) => ({
    height: e.getBoundingClientRect().height,
    breakInside: getComputedStyle(e.closest(".document-figure") ?? e)
      .breakInside,
  }));
  assert(print.height <= 435, "Print image is capped at 115mm");
  assert.equal(print.breakInside, "avoid", "A figure and caption never split");
  assert.equal(
    await page.$eval(
      'img[alt="Excalidraw"]',
      (e) => getComputedStyle(e).filter,
    ),
    "none",
    "Dark-session drawing prints light",
  );
  const pollInputs = await page.$$eval(
    "[data-poll] input",
    (els) => els.filter((e) => getComputedStyle(e).display !== "none").length,
  );
  assert.equal(pollInputs, 0, "Printed polls show results rather than inputs");
  assert(
    await page.$eval(
      ".slide-view-outer-viewport",
      (e) => e.getBoundingClientRect().width > 200,
    ),
    "Printed slide retains its content width",
  );
  for (const selector of [".chart-component", ".slide-view-outer-viewport"]) {
    assert.equal(
      await page.$eval(selector, (e) => getComputedStyle(e).breakInside),
      "avoid",
      `${selector} stays on one page`,
    );
  }
  assert(
    await page.$eval(
      ".recharts-surface",
      (e) => e.getBoundingClientRect().width > 200,
    ),
    "Printed chart keeps a visible SVG",
  );
  await page.pdf({
    path: `${output}/kitchen-sink-dark-session.pdf`,
    format: "A4",
    printBackground: true,
  });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMediaType("screen");
  console.log("Media: tall hero fits and broken image exposes alt text");
}
