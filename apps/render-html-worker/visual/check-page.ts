import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";
import { signInToDev } from "./check-typography";

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(page: Page, id: string, sidebar: string | null = null) {
  await page.evaluate((value) => {
    if (value) localStorage.setItem("lexidraw.sidebar", value);
    else localStorage.removeItem("lexidraw.sidebar");
  }, sidebar);
  await page.goto(`${appUrl}/documents/${id}`, { waitUntil: "networkidle2" });
  await page.waitForSelector('[id^="lexical-content-"]');
  await pause(300);
}

/** Where a heading's top sits in the viewport, and where the toolbar ends. */
async function headingTop(page: Page, text: string) {
  return page.evaluate((text) => {
    const heading = [
      ...document.querySelectorAll<HTMLElement>(
        '[id^="lexical-content-"] :is(h1,h2,h3,h4,h5,h6)',
      ),
    ].find((element) => element.textContent === text);
    const toolbar = document.querySelector('[data-component-name="Toolbar"]');
    if (!heading || !toolbar) throw new Error(`Missing ${text} or toolbar`);
    return {
      top: heading.getBoundingClientRect().top,
      below: toolbar.getBoundingClientRect().bottom,
    };
  }, text);
}

/** Puts the caret inside the first text that starts with `text`. */
async function placeCaret(page: Page, text: string) {
  await page.evaluate((text) => {
    const content = document.querySelector<HTMLElement>(
      '[id^="lexical-content-"]',
    );
    const walker = document.createTreeWalker(
      content ?? document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.startsWith(text)) continue;
      content?.focus();
      window.getSelection()?.setBaseAndExtent(node, 2, node, 2);
      return;
    }
    throw new Error(`Missing ${text}`);
  }, text);
}

async function currentEntry(page: Page) {
  return page.$eval(
    'nav[aria-label="Table of contents"]',
    (nav) => nav.querySelector('[aria-current="location"]')?.textContent,
  );
}

/**
 * The document page as a page: it scrolls itself, its reading tools follow,
 * an empty document invites writing, and comments read as comments.
 */
export async function checkPage(
  page: Page,
  fixtureId: string,
  emptyId: string,
) {
  await signInToDev(page);
  await page.setViewport({ width: 1280, height: 900 });
  await open(page, fixtureId);

  assert.match(
    (await page.$eval('meta[name="viewport"]', (meta) => meta.content)) ?? "",
    /viewport-fit=cover/,
    "The page extends under the notch and home indicator",
  );
  const scrolled = await page.evaluate(() => {
    const content = document.querySelector('[id^="lexical-content-"]');
    let inner = 0;
    for (let el = content?.parentElement; el; el = el.parentElement) {
      const { overflowY } = getComputedStyle(el);
      if (
        el !== document.body &&
        /auto|scroll/.test(overflowY) &&
        el.scrollHeight > el.clientHeight
      )
        inner++;
    }
    return { inner, page: document.documentElement.scrollHeight > innerHeight };
  });
  assert.equal(scrolled.inner, 0, "No inner column scrolls the document");
  assert(scrolled.page, "The page itself scrolls");
  const opened = await page.evaluate(() => ({
    y: scrollY,
    focus: document.activeElement?.id ?? "",
  }));
  assert.equal(opened.y, 0, "A document opens at its top");
  assert.match(
    opened.focus,
    /^lexical-content-/,
    "The caret starts in the text",
  );
  await page.mouse.move(24, 600);
  await page.mouse.wheel({ deltaY: 800 });
  await page.waitForFunction(() => scrollY > 0, { timeout: 3000 });
  const toolbarTop = await page.$eval(
    '[data-component-name="Toolbar"]',
    (toolbar) => toolbar.getBoundingClientRect().top,
  );
  assert.equal(toolbarTop, 0, "The toolbar stays at the top while scrolling");

  // Table of contents.
  await open(page, fixtureId, "toc");
  await page.waitForSelector('nav[aria-label="Table of contents"] button');
  const entries = await page.$$eval(
    'nav[aria-label="Table of contents"] button',
    (buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        const text = button.firstElementChild ?? button;
        return {
          text: button.textContent ?? "",
          title: button.title,
          left: text.getBoundingClientRect().left,
          size: style.fontSize,
          weight: style.fontWeight,
          lines: Math.round(
            button.getBoundingClientRect().height /
              Number.parseFloat(style.lineHeight),
          ),
        };
      }),
  );
  const [top, second, third] = entries;
  assert(top && second && third, "The fixture's headings are listed");
  assert.equal(second.left - top.left, 14, "One outline level is 14px");
  assert.equal(third.left - second.left, 14, "Each level adds 14px");
  assert.equal(top.size, "14px");
  assert.equal(top.weight, "600");
  assert.equal(second.size, "13px");
  const long = entries.find((entry) => entry.text.includes("京都"));
  assert(long, "The long heading is listed");
  assert.equal(long.lines, 1, "Entries stay on one line");
  assert.equal(long.title, "Heading two · 京都の秋をゆっくり歩くための見出し");

  const sidebar = await page.$eval("aside", (aside) => {
    const rect = aside.getBoundingClientRect();
    return { left: rect.left, top: rect.top, bottom: rect.bottom };
  });
  const column = await page.$eval('[id^="lexical-content-"] > p', (p) => {
    const rect = p.getBoundingClientRect();
    return rect.left + rect.width / 2;
  });
  assert(
    Math.abs(column - sidebar.left / 2) <= 2,
    `The text column centres in the space the sidebar leaves (${column} vs ${sidebar.left / 2})`,
  );

  const target = "Rich blocks · 図とメディア";
  await page
    .locator(`nav[aria-label="Table of contents"] button[title="${target}"]`)
    .click();
  await page.waitForFunction(
    (target) =>
      document.querySelector('nav [aria-current="location"]')?.textContent ===
      target,
    { timeout: 3000 },
    target,
  );
  await pause(1200);
  const jumped = await headingTop(page, target);
  assert(
    jumped.top >= jumped.below && jumped.top <= jumped.below + 64,
    `The heading lands under the toolbar (${jumped.top}, toolbar ${jumped.below})`,
  );
  assert.equal(await currentEntry(page), target);
  const pinned = await page.$eval("aside", (aside) => {
    const rect = aside.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  });
  assert.deepEqual(
    pinned,
    { top: sidebar.top, bottom: sidebar.bottom },
    "The sidebar stays in place while reading",
  );
  const rule = await page.$eval(
    'nav[aria-label="Table of contents"] [aria-current="location"]',
    (entry) => getComputedStyle(entry).borderLeftWidth,
  );
  assert.equal(rule, "2px", "The current entry has a 2px rule");

  // Reading back up moves the highlight with it.
  await page.mouse.move(24, 600);
  await page.mouse.wheel({ deltaY: -100_000 });
  await page.waitForFunction(() => scrollY === 0, { timeout: 3000 });
  await page.waitForFunction(
    () =>
      document
        .querySelector('nav [aria-current="location"]')
        ?.textContent?.startsWith("Kitchen sink"),
    { timeout: 3000 },
  );

  // Reduced motion jumps without travelling.
  await pause(500);
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page
    .locator(`nav[aria-label="Table of contents"] button[title="${target}"]`)
    .click();
  await pause(50);
  const instant = await headingTop(page, target);
  assert(
    instant.top >= instant.below && instant.top <= instant.below + 64,
    "Reduced motion jumps straight to the heading",
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "no-preference" },
  ]);

  // Comments.
  await open(page, fixtureId, "comments");
  const comments = await page.evaluate(() => {
    const panel = document.querySelector('[data-component-name="CommentUI"]');
    const aside = panel?.closest("aside");
    return {
      text: panel?.textContent ?? "",
      width: aside?.getBoundingClientRect().width,
      resizable: Boolean(aside?.querySelector('[role="separator"]')),
    };
  });
  assert(
    comments.text.includes("Is this the right term? · 用語は正しい？") &&
      comments.text.includes("Editor"),
    "A thread opens showing its comment and author",
  );
  assert.equal(comments.width, 360, "The comments sidebar has a fixed width");
  assert(!comments.resizable, "The comments sidebar is not resizable");

  await placeCaret(page, "English and");
  await pause(200);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      for (const name of ["light", "dark"])
        document.documentElement.classList.toggle(name, name === theme);
    }, theme);
    const marks = await page.evaluate(() => {
      const all = [
        ...document.querySelectorAll<HTMLElement>(
          '[id^="lexical-content-"] mark',
        ),
      ];
      const comment = all.find((mark) =>
        mark.textContent?.startsWith("Commented text"),
      );
      const highlight = all.find((mark) => mark.textContent === "highlight");
      if (!comment || !highlight) throw new Error("Missing marks");
      const look = (element: HTMLElement) => {
        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          underline: `${style.borderBottomWidth} ${style.borderBottomColor}`,
        };
      };
      return { comment: look(comment), highlight: look(highlight) };
    });
    assert.notEqual(
      marks.comment.background,
      marks.highlight.background,
      `${theme}: a comment is not a highlight`,
    );
    assert.notEqual(marks.comment.underline.split(" ")[0], "0px");
    await placeCaret(page, "Commented text");
    await pause(200);
    const active = await page.evaluate(() => {
      const mark = [
        ...document.querySelectorAll<HTMLElement>(
          '[id^="lexical-content-"] mark',
        ),
      ].find((element) => element.textContent?.startsWith("Commented text"));
      if (!mark) throw new Error("Missing commented text");
      return getComputedStyle(mark).backgroundColor;
    });
    assert.notEqual(
      active,
      marks.comment.background,
      `${theme}: the active thread's range is stronger`,
    );
    await placeCaret(page, "English and");
    await pause(200);
  }
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    localStorage.removeItem("lexidraw.sidebar");
  });

  // An empty document.
  for (const [width, height] of [
    [375, 812],
    [1280, 900],
  ] as const) {
    await page.setViewport({ width, height });
    await open(page, emptyId);
    const empty = await page.evaluate(() => {
      const main = document.querySelector("#main-content");
      const content = document.querySelector<HTMLElement>(
        '[id^="lexical-content-"]',
      );
      const paragraph = content?.querySelector("p");
      const placeholder = [...(main?.querySelectorAll("*") ?? [])].find(
        (element) =>
          element.childElementCount === 0 &&
          element.textContent === "Start writing…",
      );
      if (!content || !paragraph || !placeholder)
        return { found: false } as const;
      const at = placeholder.getBoundingClientRect();
      const line = paragraph.getBoundingClientRect();
      return {
        found: true,
        visible:
          getComputedStyle(placeholder).visibility !== "hidden" &&
          at.width > 0 &&
          document.elementsFromPoint(at.left + 2, at.top + at.height / 2)
            .length > 0,
        left: at.left - line.left,
        top: at.top - line.top,
        focused: document.activeElement === content,
        outline: getComputedStyle(content).outlineStyle,
        pageWidth: document.documentElement.scrollWidth,
      };
    });
    assert(empty.found, `${width}: an empty document shows its placeholder`);
    assert(empty.visible, `${width}: the placeholder is visible`);
    assert(
      Math.abs(empty.left) <= 1 && Math.abs(empty.top) <= 4,
      `${width}: the placeholder sits where the first line starts (${empty.left}, ${empty.top})`,
    );
    assert(empty.focused, `${width}: the empty document is ready to type`);
    assert.equal(empty.outline, "none", `${width}: no outline around the page`);
    assert(empty.pageWidth <= width, `${width}: nothing scrolls sideways`);
  }
  console.log(
    "Page: page scroll, TOC jump and outline, sidebar centring, comments, placeholder",
  );
}
