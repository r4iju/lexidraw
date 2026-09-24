import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { signInToDev } from "./check-typography";
import { appUrl } from "./app-url";

export async function checkRichBlocks(
  page: Page,
  fixtureId: string,
  output: string,
) {
  await signInToDev(page);
  await page.goto(`${appUrl}/documents/${fixtureId}`, {
    waitUntil: "networkidle2",
  });
  await page.waitForSelector(".editor-equation .katex");
  for (const [width, height] of [
    [375, 812],
    [768, 1024],
    [1280, 900],
  ] as const) {
    await page.setViewport({ width, height });
    for (const theme of ["light", "dark"]) {
      await page.evaluate(
        (theme) =>
          document.documentElement.classList.toggle("dark", theme === "dark"),
        theme,
      );
      const result = await page.evaluate(() => {
        const root = document.querySelector<HTMLElement>(".document-content")!;
        const inline = [...root.querySelectorAll(".editor-equation")].find(
          (e) => e.textContent?.includes("E="),
        );
        const code = root.querySelector<HTMLElement>(".document-code");
        const quote = root.querySelector("blockquote");
        const link = root.querySelector('a[href*="a-very-long"]');
        return {
          inline: inline ? getComputedStyle(inline).display : null,
          equationSize: inline?.querySelector(".katex")
            ? getComputedStyle(inline.querySelector(".katex")!).fontSize
            : null,
          codeBackground: code ? getComputedStyle(code).backgroundColor : null,
          lineNumbers: code?.dataset.lineNumbers,
          quoteBorder: quote ? getComputedStyle(quote).borderLeftWidth : null,
          linkDisplay: link ? getComputedStyle(link).display : null,
          linkFits: link
            ? link.getBoundingClientRect().right <=
              root.getBoundingClientRect().right
            : false,
          legend: !!root.querySelector(".recharts-legend-wrapper"),
          collapsibleSize: getComputedStyle(
            root.querySelector('[data-slot="accordion-content"]')!,
          ).fontSize,
        };
      });
      assert(
        await page.$('[aria-label="Copy code"]'),
        "Code header has a keyboard-accessible Copy action",
      );
      assert.equal(
        result.inline,
        "inline",
        "Inline math stays in the text line",
      );
      if (width >= 768) {
        const inlineLine = await page.$$eval(
          ".document-content p",
          (paragraphs) => {
            const line = paragraphs.find((p) =>
              p.textContent?.startsWith("Inline equation before"),
            );
            return line
              ? {
                  height: line.getBoundingClientRect().height,
                  line: Number.parseFloat(getComputedStyle(line).lineHeight),
                }
              : null;
          },
        );
        assert(
          inlineLine && inlineLine.height <= inlineLine.line + 1,
          "Inline equation and surrounding words occupy one line",
        );
      }
      assert.equal(result.equationSize, "16.8px", "Inline math uses 1.05em");
      assert.equal(result.quoteBorder, "3px");
      assert.equal(result.linkDisplay, "inline");
      assert(result.linkFits, "Long URL wraps on a phone");
      assert.equal(result.lineNumbers, "false", "Numbers are opt-in");
      assert.equal(result.legend, false, "Single-series chart has no legend");
      assert.equal(result.collapsibleSize, "16px");
      await page.$eval(".document-code", (e) =>
        e.scrollIntoView({ block: "center" }),
      );
      await page.screenshot({ path: `${output}/rich-${width}-${theme}.png` });
    }
  }
  await page.emulateMediaType("print");
  const print = await page.evaluate(() => ({
    wrapping: getComputedStyle(document.querySelector(".document-code-body")!)
      .whiteSpace,
    skip: [...document.querySelectorAll("a")]
      .filter((e) => e.textContent?.includes("Skip to content"))
      .map((e) => getComputedStyle(e).display),
    numbers: [
      ...document.querySelectorAll(
        '.document-code[data-line-numbers="true"] [data-line-number]',
      ),
    ].map((e) => e.getAttribute("data-line-number")),
  }));
  assert.equal(print.wrapping, "pre-wrap");
  assert(print.skip.every((display) => display === "none"));
  assert.deepEqual(print.numbers, ["1", "2"]);
  await page.emulateMediaType(null);
  await page.locator('[aria-label="Format code"]').click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent === "Formatted",
    ),
  );
}
