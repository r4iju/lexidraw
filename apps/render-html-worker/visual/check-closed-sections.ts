import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";
import { signInToDev } from "./check-typography";

const CONTENT = '[data-slot="accordion-content"]';
const TRIGGER = '[data-slot="accordion-trigger"]';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PICTURE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iNDAwIj48cmVjdCB3aWR0aD0iNjAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iI2RjZmNlNyIvPjxjaXJjbGUgY3g9IjMwMCIgY3k9IjIwMCIgcj0iMTMzIiBmaWxsPSIjMTZhMzRhIi8+PC9zdmc+";

/**
 * A document of sections as a shopping list keeps them: one open, and after
 * it several closed, each holding pictures.
 */
export const CLOSED_SECTIONS_MARKDOWN = [
  "Sections, one open and the rest closed.",
  "<details open>\n<summary>Open section</summary>\n\nWhat the open section says.\n\n</details>",
  ...Array.from(
    { length: 6 },
    (_, index) =>
      `<details>\n<summary>Closed section ${index + 1}</summary>\n\nWhat closed section ${index + 1} holds.\n\n![Picture ${index + 1}](${PICTURE})\n\n![Another ${index + 1}](${PICTURE})\n\n</details>`,
  ),
  "After the sections.",
].join("\n\n");

type Frame = { state: string | undefined; height: number }[];

/**
 * A tab that notes, every frame from the first, each section's state and
 * height, and every layout shift.
 */
async function watchedTab(page: Page, width: number, theme: string) {
  const tab = await page.browser().newPage();
  await tab.bringToFront();
  await tab.setViewport({ width, height: width < 500 ? 812 : 900 });
  await tab.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: theme },
  ]);
  await tab.evaluateOnNewDocument((content) => {
    const watch = window as unknown as {
      frames: Frame[];
      shifts: { value: number; sources: string[] }[];
    };
    watch.frames = [];
    watch.shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        hadRecentInput: boolean;
        sources?: { node?: Node | null }[];
      }[]) {
        if (entry.hadRecentInput) continue;
        watch.shifts.push({
          value: entry.value,
          sources: (entry.sources ?? []).map(({ node }) =>
            node instanceof Element
              ? `${node.tagName}.${node.className}`
              : (node?.nodeName ?? "?"),
          ),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
    const frame = () => {
      const sections = document.querySelectorAll<HTMLElement>(content);
      if (sections.length)
        watch.frames.push(
          [...sections].map((section) => ({
            state: section.dataset.state,
            height: section.getBoundingClientRect().height,
          })),
        );
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }, CONTENT);
  const read = () =>
    tab.evaluate(() => {
      const watch = window as unknown as {
        frames: Frame[];
        shifts: { value: number; sources: string[] }[];
      };
      return { frames: watch.frames, shifts: watch.shifts };
    });
  return { tab, read };
}

/**
 * Sections paint in the state they were saved in from the first frame, so
 * nothing moves as the page opens; opening one by hand still animates; and
 * paper prints every section open, as it always has.
 */
export async function checkClosedSections(
  page: Page,
  {
    closedId,
    printedText,
  }: { closedId: string; printedText: (id: string) => Promise<string> },
) {
  await page.bringToFront();
  await signInToDev(page);
  const path = `${appUrl}/documents/${closedId}`;
  for (const width of [1280, 375]) {
    for (const theme of ["light", "dark"]) {
      const label = `${width} ${theme}`;
      const { tab, read } = await watchedTab(page, width, theme);
      await tab.goto(path, { waitUntil: "load" });
      await tab.waitForSelector(CONTENT);
      await pause(1500);
      const { frames, shifts } = await read();
      const last = frames.at(-1);
      assert(last && last.length === 7, `${label}: seven sections show`);
      for (const [index, { state }] of last.entries())
        assert.equal(
          state,
          index === 0 ? "open" : "closed",
          `${label}: section ${index} is in its saved state`,
        );
      const full = last[0]?.height ?? 0;
      for (const [at, frame] of frames.entries())
        for (const [index, { height }] of frame.entries()) {
          if (index === 0)
            assert(
              Math.abs(height - full) <= 1,
              `${label}: the open section is its full height from the first frame (frame ${at}: ${height}px, then ${full}px)`,
            );
          else
            assert.equal(
              height,
              0,
              `${label}: closed section ${index} is closed from the first frame (frame ${at}: ${height}px)`,
            );
        }
      const total = shifts.reduce((sum, { value }) => sum + value, 0);
      assert(
        total < 0.005,
        `${label}: nothing moves as the page opens (${total.toFixed(4)}: ${JSON.stringify(shifts)})`,
      );

      await tab.close();
    }
  }
  // Opening a section by hand unfolds it, over more than one frame. Last, as
  // opening one may save it open.
  const { tab, read } = await watchedTab(page, 1280, "light");
  await tab.goto(path, { waitUntil: "load" });
  await tab.waitForSelector(CONTENT);
  await pause(1500);
  const before = (await read()).frames.length;
  await tab.$$eval(TRIGGER, (triggers) =>
    (triggers[1] as HTMLElement | undefined)?.click(),
  );
  await pause(1000);
  const after = (await read()).frames.slice(before);
  const heights = [...new Set(after.map((frame) => frame[1]?.height))];
  const opened = after.at(-1)?.[1];
  assert(
    opened?.state === "open" && opened.height > 0,
    "A closed section opens when its title is clicked",
  );
  assert(
    heights.filter((height) => height && height < opened.height).length > 1,
    `A section unfolds rather than jumps open (${heights.join(", ")})`,
  );
  await tab.close();
  await page.bringToFront();

  const printed = await printedText(closedId);
  for (let index = 1; index <= 6; index++)
    assert(
      printed.includes(`What closed section ${index} holds.`),
      `Paper prints closed section ${index} open`,
    );
  console.log(
    "Closed sections: saved state from the first frame at 1280 and 375, light and dark, nothing moves, a click unfolds one, paper prints them open",
  );
}
