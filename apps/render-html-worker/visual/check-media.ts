import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { signInToDev } from "./check-typography";
import { appUrl } from "./app-url";

export async function checkMedia(
  page: Page,
  fixtureId: string,
  output: string,
) {
  await signInToDev(page);
  await page.goto(`${appUrl}/documents/${fixtureId}`, {
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
        hero.height <= Math.min(height * 0.6, 448) + 1,
        `An unsized image is at most 60% of ${height}px and 28rem; got ${hero.height}`,
      );
      assert(
        Math.abs(hero.width / hero.height - 0.5) < 0.01,
        "Tall image keeps its aspect ratio",
      );
      assert(
        Math.abs(hero.center - hero.columnCenter) < 2,
        "Standalone image is centered",
      );
      assert(!hero.filter.includes("invert"), "Photos are never inverted");
      assert(
        theme === "dark"
          ? /brightness\(0\.\d+\)/.test(hero.filter)
          : hero.filter === "none",
        `A photo is dimmed a little in dark mode only: ${hero.filter}`,
      );

      const layout = await page.evaluate(() => {
        const content = document.querySelector(".document-content");
        const text = content?.querySelector(":scope > p");
        const half = document.querySelector(
          'img[alt="Half the column · 半分"]',
        );
        const [columns, wide] = [
          ...document.querySelectorAll(
            ".document-content > [data-lexical-layout-container]",
          ),
        ];
        const firstText = (element: Element | null | undefined) =>
          element
            ?.querySelector("[data-lexical-text]")
            ?.getBoundingClientRect();
        if (!text || !half || !columns || !wide)
          throw new Error("Missing text, figure or columns");
        const column = text.getBoundingClientRect();
        const marker = document.querySelector(
          ".document-content sup.footnote-ref",
        );
        const digit = marker?.querySelector("a")?.firstChild;
        const before = marker?.previousElementSibling?.getClientRects();
        const range = document.createRange();
        if (digit) range.selectNodeContents(digit);
        const note = document.querySelector(".document-content > .footnote");
        const body = note?.querySelector(".footnote-body")?.getClientRects();
        const back = note
          ?.querySelector(".footnote-backref")
          ?.getBoundingClientRect();
        const lastBefore = before?.[before.length - 1];
        const lastBody = body?.[body.length - 1];
        return {
          column: { left: column.left, width: column.width },
          half: half.getBoundingClientRect().width,
          columns: firstText(columns)?.left,
          wide: wide.getBoundingClientRect().width,
          gap: lastBefore
            ? range.getBoundingClientRect().left - lastBefore.right
            : null,
          raise: lastBefore
            ? lastBefore.top - range.getBoundingClientRect().top
            : null,
          noteLines: body?.length ?? 0,
          back: back &&
            lastBody && {
              gap: back.left - lastBody.right,
              drop: Math.abs(back.bottom - lastBody.bottom),
            },
        };
      });
      assert(
        width < 640
          ? Math.abs(layout.half - layout.column.width) < 1
          : Math.abs(layout.half - layout.column.width / 2) < 1,
        `A half-column figure fills a phone's column and is half of a wider one: ${JSON.stringify(layout)}`,
      );
      assert(
        Math.abs((layout.columns ?? 0) - layout.column.left) < 1,
        `Columns start where the text does: ${JSON.stringify(layout)}`,
      );
      if (width === 1280)
        assert(layout.wide > 1000, "Columns written wide use the wide column");
      assert(
        layout.gap !== null && layout.gap < 1,
        `A footnote marker hugs its word: ${layout.gap}`,
      );
      assert(
        layout.raise !== null && layout.raise < 4,
        `A footnote marker sits like a superscript: ${layout.raise}`,
      );
      if (width === 375) {
        assert(layout.noteLines > 1, "The first note wraps on a phone");
        assert(
          layout.back && layout.back.gap < 12 && layout.back.drop < 6,
          `The way back follows the note's last word: ${JSON.stringify(layout.back)}`,
        );
      }
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
  assert.deepEqual(
    await page.$eval(".document-viewport", (viewport) => {
      const tinted: string[] = [];
      for (let e: Element | null = viewport; e; e = e.parentElement) {
        const { backgroundColor } = getComputedStyle(e);
        const canvas = document.createElement("canvas").getContext("2d");
        if (!canvas) break;
        canvas.fillStyle = backgroundColor;
        canvas.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
        if (a !== 0 && (r !== 255 || g !== 255 || b !== 255))
          tinted.push(`${e.tagName.toLowerCase()} ${backgroundColor}`);
      }
      return tinted;
    }),
    [],
    "The paper is white behind the document",
  );
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
