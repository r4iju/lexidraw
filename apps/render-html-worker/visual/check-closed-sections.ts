import assert from "node:assert/strict";
import type { ElementHandle, Page } from "puppeteer";
import { appUrl } from "./app-url";
import { signInToDev } from "@packages/dev-stack";

const CONTENT = '[data-slot="accordion-content"]';
const TRIGGER = '[data-slot="accordion-trigger"]';
const CHEVRON = '[data-slot="accordion-chevron"]';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PICTURE =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MDAiIGhlaWdodD0iNDAwIj48cmVjdCB3aWR0aD0iNjAwIiBoZWlnaHQ9IjQwMCIgZmlsbD0iI2RjZmNlNyIvPjxjaXJjbGUgY3g9IjMwMCIgY3k9IjIwMCIgcj0iMTMzIiBmaWxsPSIjMTZhMzRhIi8+PC9zdmc+";

/** A toggle whose title is a heading of `level`, closed. */
const headingSection = (level: number) =>
  `<details>\n<summary><h${level}>Closed heading ${level}</h${level}></summary>\n\nUnder heading ${level}.\n\n</details>`;

/**
 * A document of sections as a shopping list keeps them: one open, and after
 * it several closed, each holding pictures, the last one another section;
 * then sections titled by headings.
 */
export const CLOSED_SECTIONS_MARKDOWN = [
  "Sections, one open and the rest closed.",
  "<details open>\n<summary>Open section</summary>\n\nWhat the open section says.\n\n</details>",
  ...Array.from(
    { length: 6 },
    (_, index) =>
      `<details>\n<summary>Closed section ${index + 1}</summary>\n\nWhat closed section ${index + 1} holds.\n\n![Picture ${index + 1}](${PICTURE})\n\n![Another ${index + 1}](${PICTURE})${index === 5 ? "\n\n<details>\n<summary>Nested section</summary>\n\nWhat the nested section holds.\n\n#### Nested heading\n\nUnder the nested heading.\n\n</details>" : ""}\n\n</details>`,
  ),
  ...[1, 2, 3].map(headingSection),
  "After the sections.",
  "And one line more.",
].join("\n\n");

/** Every section the document holds, nested ones too. */
const SECTION_COUNT = CLOSED_SECTIONS_MARKDOWN.match(/<details/g)?.length ?? 0;

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
            state: section.parentElement?.dataset.state,
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
    markdownOf,
  }: {
    closedId: string;
    printedText: (id: string) => Promise<string>;
    markdownOf: (id: string) => Promise<string>;
  },
) {
  // A heading's level survives the trip through the editor and back.
  const markdown = await markdownOf(closedId);
  for (const level of [1, 2, 3])
    assert(
      markdown.includes(
        `<summary><h${level}>Closed heading ${level}</h${level}></summary>`,
      ),
      `A toggle heading ${level} is written back as one`,
    );

  await page.bringToFront();
  await signInToDev(page, appUrl);
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
      assert(
        last && last.length === SECTION_COUNT,
        `${label}: every section shows (${last?.length} of ${SECTION_COUNT})`,
      );
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
  await checkTitles(page, path);

  // Opening a section by hand unfolds it, over more than one frame. Last, as
  // opening one may save it open.
  const { tab, read } = await watchedTab(page, 1280, "light");
  await tab.goto(path, { waitUntil: "load" });
  await tab.waitForSelector(CONTENT);
  await pause(1500);
  const before = (await read()).frames.length;
  await tab.$$eval(CHEVRON, (chevrons) =>
    (chevrons[1] as HTMLElement | undefined)?.click(),
  );
  await pause(1000);
  const after = (await read()).frames.slice(before);
  const heights = [...new Set(after.map((frame) => frame[1]?.height))];
  const opened = after.at(-1)?.[1];
  assert(
    opened?.state === "open" && opened.height > 0,
    "A closed section opens when its chevron is clicked",
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
    "Closed sections: saved state from the first frame at 1280 and 375, light and dark, nothing moves, titles are text, the chevron turns and unfolds one, keys and shortcuts work, headings round-trip, paper prints them open",
  );
}

/** Where character `at` of section `index`'s title starts, on screen. */
function characterAt(tab: Page, index: number, at: number) {
  return tab.$$eval(
    TRIGGER,
    (triggers, index, at) => {
      const title = triggers[index] as HTMLElement;
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode() as Text;
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + 1);
      const { left, top, height } = range.getBoundingClientRect();
      return { x: left + 1, y: top + height / 2 };
    },
    index,
    at,
  );
}

/** What the page has selected, and the state of section `index`. */
function selected(tab: Page, index: number) {
  return tab.evaluate(
    (content, index) => {
      const selection = getSelection();
      return {
        text: selection?.toString() ?? "",
        offset: selection?.anchorOffset ?? -1,
        state:
          document.querySelectorAll<HTMLElement>(content)[index]?.parentElement
            ?.dataset.state,
      };
    },
    CONTENT,
    index,
  );
}

/**
 * A section's title is text like any other: a click puts the caret where
 * it lands, and opens nothing.
 */
async function checkTitles(page: Page, path: string) {
  const tab = await page.browser().newPage();
  await tab.setViewport({ width: 1280, height: 900 });
  await tab.goto(path, { waitUntil: "load" });
  await tab.waitForSelector(CONTENT);
  await pause(1500);

  // "Closed section 1": the caret lands before "section".
  const { x, y } = await characterAt(tab, 1, 7);
  await tab.mouse.click(x, y);
  await pause(300);
  const clicked = await selected(tab, 1);
  assert.equal(clicked.offset, 7, "A click in a title puts the caret there");
  assert.equal(clicked.state, "closed", "A click in a title opens nothing");

  // Dragging across "Closed " selects it.
  const from = await characterAt(tab, 1, 0);
  const to = await characterAt(tab, 1, 7);
  await tab.mouse.move(from.x - 1, from.y);
  await tab.mouse.down();
  await tab.mouse.move(to.x - 1, to.y, { steps: 8 });
  await tab.mouse.up();
  await pause(300);
  const dragged = await selected(tab, 1);
  assert.equal(dragged.text, "Closed ", "Dragging across a title selects it");
  assert.equal(dragged.state, "closed", "Selecting a title opens nothing");

  // The chevron sits on the middle of the title's first line, whatever the
  // title is, and a toggle is no box.
  const layout = await tab.evaluate(
    (chevron, trigger) =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "[data-slot='accordion-item']",
        ),
      ]
        .filter((item) => item.getBoundingClientRect().height > 0)
        .map((item) => {
          const icon = item.querySelector(`:scope > ${chevron} svg`);
          const title = item.querySelector<HTMLElement>(`:scope > ${trigger}`);
          const text = title
            ? document.createTreeWalker(title, NodeFilter.SHOW_TEXT).nextNode()
            : null;
          const range = document.createRange();
          if (text) {
            range.setStart(text, 0);
            range.setEnd(text, 1);
          }
          const line = range.getBoundingClientRect();
          const box = icon?.getBoundingClientRect();
          return {
            title: title?.textContent ?? "",
            tag: title?.firstElementChild?.tagName,
            border: getComputedStyle(item).borderTopWidth,
            offset: box
              ? box.top + box.height / 2 - (line.top + line.height / 2)
              : null,
          };
        }),
    CHEVRON,
    TRIGGER,
  );
  for (const level of [1, 2, 3])
    assert.equal(
      layout.find(({ title }) => title === `Closed heading ${level}`)?.tag,
      `H${level}`,
      `A toggle heading ${level} shows as a heading`,
    );
  for (const { title, border, offset } of layout) {
    assert(
      offset !== null && Math.abs(offset) <= 1,
      `The chevron is centred on "${title}" (${offset?.toFixed(2)}px off)`,
    );
    assert.equal(border, "0px", `"${title}" is not drawn as a box`);
  }

  // Closed toggles one after another are spaced as paragraphs are.
  const gaps = await tab.evaluate(() => {
    const items = document.querySelectorAll("[data-slot='accordion-item']");
    const lines = [...document.querySelectorAll(".document-content > p")];
    const between = (a?: Element, b?: Element) =>
      a && b
        ? b.getBoundingClientRect().top - a.getBoundingClientRect().bottom
        : Number.NaN;
    return {
      toggles: between(items[1], items[2]),
      paragraphs: between(lines.at(-2), lines.at(-1)),
    };
  });
  assert(
    Math.abs(gaps.toggles - gaps.paragraphs) <= 0.5,
    `Toggles are spaced as paragraphs are (${gaps.toggles}px, ${gaps.paragraphs}px)`,
  );

  // The chevron turns as its toggle opens, over more than one frame.
  const turns = await tab.evaluate(async (chevron) => {
    const button = document.querySelectorAll<HTMLElement>(chevron)[2];
    const icon = button?.querySelector("svg");
    if (!button || !icon) return [];
    const angle = () => {
      const { a, b } = new DOMMatrix(getComputedStyle(icon).transform);
      const rotate = getComputedStyle(icon).rotate;
      const degrees = rotate === "none" ? 0 : Number.parseFloat(rotate);
      return Math.round(degrees + (Math.atan2(b, a) * 180) / Math.PI);
    };
    const seen = [angle()];
    button.click();
    for (let frame = 0; frame < 30; frame++) {
      await new Promise(requestAnimationFrame);
      seen.push(angle());
    }
    return seen;
  }, CHEVRON);
  assert.equal(turns[0], 0, "A closed toggle's chevron points along the line");
  assert.equal(turns.at(-1), 90, "An open toggle's chevron points down");
  assert(
    new Set(turns.filter((angle) => angle > 0 && angle < 90)).size > 1,
    `The chevron turns rather than jumps (${[...new Set(turns)].join(", ")})`,
  );
  assert.equal((await selected(tab, 2)).state, "open", "The chevron opens it");
  await tab.$$eval(CHEVRON, (chevrons) =>
    (chevrons[2] as HTMLElement | undefined)?.click(),
  );
  await pause(400);
  assert.equal((await selected(tab, 2)).state, "closed", "And closes it");

  // Cmd/Ctrl+Enter in a title opens and closes its toggle.
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  const third = await characterAt(tab, 3, 2);
  await tab.mouse.click(third.x, third.y);
  // Lexical takes up the caret on selectionchange, after the click.
  await pause(300);
  await tab.keyboard.down(modifier);
  await tab.keyboard.press("Enter");
  await tab.keyboard.up(modifier);
  await pause(400);
  assert.equal(
    (await selected(tab, 3)).state,
    "open",
    `${modifier}+Enter opens`,
  );
  await tab.keyboard.down(modifier);
  await tab.keyboard.press("Enter");
  await tab.keyboard.up(modifier);
  await pause(400);
  assert.equal(
    (await selected(tab, 3)).state,
    "closed",
    `${modifier}+Enter closes`,
  );

  // ">> " at the start of a line makes a toggle, open, and its empty
  // content says what goes there.
  await tab.evaluate(() => {
    const lines = document.querySelectorAll(".document-content > p");
    const last = lines[lines.length - 1];
    const text = last?.lastChild?.lastChild ?? last?.lastChild;
    if (!text) return;
    const range = document.createRange();
    range.setStart(text, text.textContent?.length ?? 0);
    range.collapse(true);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  });
  await pause(200);
  await tab.keyboard.press("Enter");
  await tab.keyboard.type(">> Typed toggle", { delay: 20 });
  await pause(400);
  const typed = await tab.evaluate((content) => {
    const items = [
      ...document.querySelectorAll<HTMLElement>("[data-slot='accordion-item']"),
    ];
    const item = items.find((each) =>
      each.textContent?.includes("Typed toggle"),
    );
    const empty = item?.querySelector(`:scope > ${content} > p`);
    return {
      title: item?.querySelector("[data-slot='accordion-trigger']")
        ?.textContent,
      state: item?.dataset.state,
      hint: empty ? getComputedStyle(empty, "::before").content : null,
    };
  }, CONTENT);
  assert.equal(typed.title, "Typed toggle", '">> " makes a toggle');
  assert.equal(typed.state, "open", "A new toggle is open");
  assert.equal(
    typed.hint,
    '"Empty toggle. Type or drop blocks inside."',
    "An empty toggle says what goes in it",
  );

  // "Turn into" makes a toggle of a block, a toggle of another level, and a
  // block of a toggle again.
  const turnInto = async (label: string) => {
    await tab.click('button[aria-label="Block type"]');
    // An item's label is its own text, apart from the shortcut it shows.
    const item = await tab.waitForFunction(
      (label) =>
        [...document.querySelectorAll('[role="menuitemradio"]')].find((each) =>
          [...each.childNodes].some(
            (child) =>
              child.nodeType === Node.TEXT_NODE &&
              child.textContent?.trim() === label,
          ),
        ),
      { timeout: 5000 },
      label,
    );
    await (item as ElementHandle<Element>).click();
    await pause(400);
  };
  const typedBlock = () =>
    tab.evaluate(() => {
      const block = [
        ...document.querySelectorAll<HTMLElement>(".document-content > *"),
      ].find((each) => each.textContent?.includes("Typed toggle"));
      const toggle = block?.dataset.slot === "accordion-item";
      return {
        toggle,
        tag: toggle
          ? block.querySelector("[data-slot='accordion-trigger'] > *")?.tagName
          : block?.tagName,
      };
    });
  await turnInto("Toggle heading 2");
  assert.deepEqual(
    await typedBlock(),
    { toggle: true, tag: "H2" },
    "Turn into Toggle heading 2 makes the title a heading",
  );
  await turnInto("Normal");
  assert.deepEqual(
    await typedBlock(),
    { toggle: false, tag: "P" },
    "Turn into Normal makes a toggle its title's block again",
  );
  await turnInto("Toggle");
  assert.deepEqual(
    await typedBlock(),
    { toggle: true, tag: "P" },
    "Turn into Toggle folds a block into a toggle",
  );

  // Jumping from the contents to a heading folded away opens every toggle
  // around it, and the heading comes into sight.
  await tab.click('button[aria-label="Table of contents"]');
  const entry = await tab.waitForSelector(
    'nav[aria-label="Table of contents"] button[title="Nested heading"]',
  );
  await entry?.click();
  await pause(1000);
  const jumped = await tab.evaluate(() => {
    const heading = [...document.querySelectorAll("h4")].find(
      (each) => each.textContent === "Nested heading",
    );
    const states: (string | undefined)[] = [];
    for (let at = heading?.parentElement; at; at = at.parentElement)
      if (at.dataset.slot === "accordion-item") states.push(at.dataset.state);
    const box = heading?.getBoundingClientRect();
    return {
      states,
      top: box?.top ?? -1,
      bottom: box?.bottom ?? -1,
      height: box?.height ?? 0,
      viewport: innerHeight,
    };
  });
  assert.deepEqual(
    jumped.states,
    ["open", "open"],
    "A jump to a heading opens the toggles it is folded in",
  );
  assert(
    jumped.height > 0 && jumped.top >= 0 && jumped.bottom <= jumped.viewport,
    `A jump brings the heading into sight (${jumped.top}px to ${jumped.bottom}px of ${jumped.viewport}px)`,
  );

  await tab.close();
  await page.bringToFront();
}
