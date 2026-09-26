import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";
import { signInToDev } from "@packages/dev-stack";

const TOOLBAR = '[role="toolbar"][aria-label="Formatting"]';
const FLOATING = '[role="toolbar"][aria-label="Selection formatting"]';
const CONTENT = '[id^="lexical-content-"]';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function open(page: Page, id: string, search = "") {
  await page.evaluate(() => localStorage.removeItem("lexidraw.sidebar"));
  await page.goto(`${appUrl}/documents/${id}${search}`, {
    waitUntil: "networkidle2",
  });
  await page.waitForSelector(`${CONTENT} > p`);
  await page.waitForSelector(TOOLBAR);
  await pause(400);
}

async function theme(page: Page, name: "light" | "dark") {
  await page.evaluate((name) => {
    for (const theme of ["light", "dark"])
      document.documentElement.classList.toggle(theme, theme === name);
    document.documentElement.style.colorScheme = name;
  }, name);
  await pause(150);
}

/**
 * Puts the caret in, or selects, the first text inside `selector` that starts
 * with `text`: `length` 0 is a caret, -1 the whole text node.
 */
async function select(page: Page, selector: string, text = "", length = 0) {
  await page.evaluate(
    (selector, text, length) => {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (!node.textContent?.trim() || !node.textContent.startsWith(text))
            continue;
          node.parentElement?.scrollIntoView({ block: "center" });
          element.closest<HTMLElement>("[contenteditable]")?.focus();
          const end = length < 0 ? (node.textContent?.length ?? 0) : 1 + length;
          window.getSelection()?.setBaseAndExtent(node, 1, node, end);
          if (length === 0)
            window.getSelection()?.setBaseAndExtent(node, 1, node, 1);
          return;
        }
      }
      throw new Error(`Missing text in ${selector}`);
    },
    selector,
    text,
    length,
  );
  await pause(250);
}

function rectOf(page: Page, selector: string) {
  return page.$eval(selector, (element) => {
    const { left, right, top, bottom, width, height } =
      element.getBoundingClientRect();
    return { left, right, top, bottom, width, height };
  });
}

/** The toolbar's reachable controls: what is not folded into More. */
function controls(page: Page) {
  return page.$eval(TOOLBAR, (bar) => {
    const box = bar.getBoundingClientRect();
    return [...bar.querySelectorAll<HTMLElement>("button, input")]
      .filter((control) => !control.closest("[inert]"))
      .map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          name:
            control.getAttribute("aria-label") ??
            control.textContent?.trim() ??
            "",
          left: rect.left,
          right: rect.right,
          tabIndex: control.tabIndex,
          clipped:
            rect.left < Math.max(0, box.left) - 0.5 ||
            rect.right > Math.min(innerWidth, box.right) + 0.5,
        };
      });
  });
}

async function menuItems(page: Page) {
  await page.waitForSelector('[role="menu"]');
  return page.$$eval(
    '[role="menu"] :is([role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"])',
    (items) =>
      items.map((item) => {
        const copy = item.cloneNode(true) as Element;
        for (const hidden of copy.querySelectorAll('[aria-hidden="true"]'))
          hidden.remove();
        return {
          text: copy.textContent?.trim() ?? "",
          checked: item.getAttribute("aria-checked"),
        };
      }),
  );
}

async function closeMenus(page: Page) {
  for (let i = 0; i < 3; i++) {
    if (!(await page.$('[role="menu"], [role="dialog"]'))) return;
    await page.keyboard.press("Escape");
    await pause(150);
  }
}

/** Opens a toolbar menu, from the toolbar or from More when it is folded. */
async function openToolbarMenu(page: Page, label: string) {
  const direct = await page.$(
    `${TOOLBAR} [role="group"]:not([inert]) button[aria-label="${label}"]`,
  );
  if (direct) {
    await direct.click();
    return menuItems(page);
  }
  await page.locator(`${TOOLBAR} button[aria-label="More"]`).click();
  await page.waitForSelector('[role="menu"]');
  const sub = await page.$$('[role="menu"] [role="menuitem"]');
  for (const item of sub) {
    if ((await item.evaluate((node) => node.textContent?.trim())) === label) {
      // By keyboard: on the way there the pointer opens its neighbours.
      await item.focus();
      await page.keyboard.press("ArrowRight");
      const submenu = await item.evaluate((node) =>
        node.getAttribute("aria-controls"),
      );
      await page.waitForSelector(`[id="${submenu}"]`);
      await pause(250);
      return page.$$eval(
        `[id="${submenu}"] :is([role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"])`,
        (items) =>
          items.map((item) => {
            const copy = item.cloneNode(true) as Element;
            for (const hidden of copy.querySelectorAll('[aria-hidden="true"]'))
              hidden.remove();
            return {
              text: copy.textContent?.trim() ?? "",
              checked: item.getAttribute("aria-checked"),
            };
          }),
      );
    }
  }
  throw new Error(`No ${label} menu in the toolbar or in More`);
}

async function tap(page: Page, selector: string) {
  const handle = await page.$(selector);
  assert(handle, `Missing ${selector}`);
  await handle.evaluate((element) =>
    element.scrollIntoView({ block: "center" }),
  );
  await pause(200);
  const box = await handle.boundingBox();
  assert(box, `${selector} is not rendered`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await pause(400);
}

/**
 * The editor's controls: a toolbar that fits and is one keyboard stop, menus
 * that show their value, a selection toolbar and typeahead that stay on
 * screen, developer tools only for developers, and every block action
 * reachable by touch.
 */
export async function checkEditorControls(
  page: Page,
  fixtureId: string,
  output: string,
) {
  // Leaving the fixture can ask first; earlier checks may already answer.
  if (!page.listenerCount("dialog"))
    page.on("dialog", (dialog) => void dialog.accept());
  await page.bringToFront();
  await signInToDev(page, appUrl);
  await page.evaluate(() => localStorage.removeItem("lexidraw-developer"));

  for (const width of [768, 1280]) {
    await page.setViewport({ width, height: 900 });
    await open(page, fixtureId);
    for (const name of ["light", "dark"] as const) {
      await theme(page, name);
      await page.screenshot({
        path: resolve(output, `editor-controls-${width}-${name}.png`),
        clip: { x: 0, y: 0, width, height: 160 },
      });
    }
    await theme(page, "light");
    const reachable = await controls(page);
    assert.deepEqual(
      reachable.filter((control) => control.clipped).map((c) => c.name),
      [],
      `No toolbar control is clipped at ${width}px`,
    );
    const folded = await page.$$eval(
      `${TOOLBAR} [role="group"][inert]`,
      (groups) => groups.length,
    );
    if (folded)
      assert(
        reachable.some((control) => control.name === "More"),
        `What does not fit at ${width}px goes into More`,
      );
    if (width === 768)
      assert(folded > 0, "At 768px part of the toolbar is folded into More");
  }

  // 1280 from here on, unless said otherwise.
  await select(page, `${CONTENT} > p`);
  const plain = await rectOf(page, TOOLBAR);
  await select(page, `${CONTENT} code`);
  const inCode = await rectOf(page, TOOLBAR);
  assert.equal(
    inCode.height,
    plain.height,
    "The caret moving into code does not change the toolbar's height",
  );
  await select(page, `${CONTENT} > p`);
  assert.equal((await rectOf(page, TOOLBAR)).height, plain.height);

  // One tab stop; arrows move within.
  const stops = (await controls(page)).filter((c) => c.tabIndex === 0);
  assert.equal(stops.length, 1, "Tab enters the toolbar once");
  await page.focus(`${TOOLBAR} [tabindex="0"]`);
  const first = await page.evaluate(() =>
    document.activeElement?.getAttribute("aria-label"),
  );
  await page.keyboard.press("ArrowRight");
  const moved = await page.evaluate((toolbar) => {
    const active = document.activeElement;
    return {
      inside: Boolean(active?.closest(toolbar)),
      name: active?.getAttribute("aria-label"),
    };
  }, TOOLBAR);
  assert(moved.inside && moved.name !== first, "ArrowRight moves along");
  await page.keyboard.press("Tab");
  assert(
    !(await page.evaluate(
      (toolbar) => Boolean(document.activeElement?.closest(toolbar)),
      TOOLBAR,
    )),
    "Tab leaves the toolbar",
  );

  // Pressed states and the block-type menu's value.
  await select(page, `${CONTENT} strong`);
  assert.equal(
    await page.$eval(`${TOOLBAR} button[aria-label="Bold"]`, (b) =>
      b.getAttribute("aria-pressed"),
    ),
    "true",
    "Bold shows as on in bold text",
  );
  assert.equal(
    await page.$eval(`${TOOLBAR} button[aria-label="Italic"]`, (b) =>
      b.getAttribute("aria-pressed"),
    ),
    "false",
  );
  await select(page, `${CONTENT} h2`);
  assert.match(
    (await page.$eval(`${TOOLBAR} button[aria-label="Block type"]`, (b) =>
      b.textContent?.trim(),
    )) ?? "",
    /Heading 2/,
    "The block-type trigger names the block",
  );
  const blockTypes = await openToolbarMenu(page, "Block type");
  assert.deepEqual(
    blockTypes.filter((item) => item.checked === "true").map((i) => i.text),
    ["Heading 2"],
    "The block-type menu marks the current type",
  );
  assert(blockTypes.some((item) => item.text === "Heading 4"));
  await closeMenus(page);

  // The Insert menu, grouped, with an icon of its own per item.
  await select(page, `${CONTENT} > p`);
  await openToolbarMenu(page, "Insert");
  const insert = await page.$eval('[role="menu"]', (menu) => ({
    groups: [...menu.querySelectorAll('[role="group"]')].map((group) =>
      group.getAttribute("aria-label"),
    ),
    nested: menu.querySelectorAll('[role="menuitem"] :is(button, a)').length,
    icons: [...menu.querySelectorAll('[role="menuitem"] svg')].map(
      (svg) => svg.innerHTML,
    ),
    items: menu.querySelectorAll('[role="menuitem"]').length,
  }));
  assert.deepEqual(insert.groups, [
    "Basic",
    "Media",
    "Diagrams and data",
    "Embeds",
    "Interactive",
  ]);
  assert.equal(insert.nested, 0, "No control is nested inside an item");
  assert.equal(insert.icons.length, insert.items, "Every item has an icon");
  assert.equal(
    new Set(insert.icons).size,
    insert.icons.length,
    "No two insert items share an icon",
  );
  await closeMenus(page);

  // The text colour picker on unstyled text.
  await select(page, `${CONTENT} > p`);
  const before = await page.$eval(CONTENT, (content) => content.innerHTML);
  await page.locator(`${TOOLBAR} button[aria-label="Text colour"]`).click();
  const picker = await page.waitForSelector('[role="dialog"]');
  assert.match(
    (await picker?.evaluate((dialog) => dialog.textContent)) ?? "",
    /Text colour/,
    "The picker says what it colours",
  );
  const swatch = await page.$eval(
    '[role="dialog"] [role="radio"][aria-checked="true"]',
    (radio) => radio.getAttribute("aria-label"),
  );
  assert.equal(swatch, "Automatic", "Unstyled text starts at Automatic");
  await closeMenus(page);
  assert.equal(
    await page.$eval(CONTENT, (content) => content.innerHTML),
    before,
    "Closing the colour picker changes nothing",
  );

  // The selection toolbar: active formats, both edges, and flipping.
  await select(page, `${CONTENT} strong`, "", -1);
  await page.waitForSelector(FLOATING, { visible: true });
  await pause(250);
  assert.equal(
    await page.$eval(`${FLOATING} button[aria-label="Bold"]`, (b) =>
      b.getAttribute("aria-pressed"),
    ),
    "true",
    "The selection toolbar shows active formats",
  );
  await page.setViewport({ width: 375, height: 812 });
  await pause(300);
  for (const edge of ["left", "right"] as const) {
    await page.evaluate(
      (content, edge) => {
        const paragraph = [
          ...document.querySelectorAll<HTMLElement>(`${content} > p`),
        ].find((p) => (p.textContent?.length ?? 0) > 120);
        const text =
          paragraph &&
          document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT).nextNode();
        if (!paragraph || !text?.textContent) throw new Error("No long text");
        paragraph.scrollIntoView({ block: "center" });
        const range = document.createRange();
        let best = 0;
        let bestX = edge === "left" ? Infinity : -Infinity;
        const firstTop = (() => {
          range.setStart(text, 0);
          range.setEnd(text, 1);
          return range.getBoundingClientRect().top;
        })();
        for (let i = 0; i < text.textContent.length - 1; i++) {
          range.setStart(text, i);
          range.setEnd(text, i + 1);
          const rect = range.getBoundingClientRect();
          if (Math.abs(rect.top - firstTop) > 2) break;
          const x = edge === "left" ? rect.left : rect.right;
          if (edge === "left" ? x < bestX : x > bestX) {
            best = i;
            bestX = x;
          }
        }
        paragraph.closest<HTMLElement>("[contenteditable]")?.focus();
        window.getSelection()?.setBaseAndExtent(text, best, text, best + 1);
      },
      CONTENT,
      edge,
    );
    await page.waitForSelector(FLOATING, { visible: true });
    await pause(300);
    const box = await rectOf(page, FLOATING);
    assert(
      box.left >= 0 && box.right <= 375,
      `The selection toolbar stays on screen at the ${edge} edge (${box.left}–${box.right})`,
    );
  }
  await page.screenshot({
    path: resolve(output, "editor-controls-selection-375.png"),
  });
  await page.setViewport({ width: 1280, height: 900 });
  await select(page, `${CONTENT} > p`, "", 3);
  await page.evaluate((toolbar) => {
    const selection = window.getSelection();
    const rect = selection?.getRangeAt(0).getBoundingClientRect();
    const bar = document.querySelector(toolbar)?.getBoundingClientRect();
    if (rect && bar) scrollBy(0, rect.top - bar.bottom - 12);
  }, TOOLBAR);
  await pause(400);
  const flipped = await page.evaluate((floating) => {
    const selection = window
      .getSelection()
      ?.getRangeAt(0)
      .getBoundingClientRect();
    const bar = document.querySelector(floating)?.getBoundingClientRect();
    return { selection: selection?.bottom ?? 0, bar: bar?.top ?? 0 };
  }, FLOATING);
  assert(
    flipped.bar >= flipped.selection,
    "Near the top the selection toolbar flips below the selection",
  );

  // The context menu, on the shared menu.
  await select(page, `${CONTENT} > p`);
  const paragraph = await rectOf(page, `${CONTENT} > p`);
  await page.mouse.click(paragraph.left + 20, paragraph.top + 8, {
    button: "right",
  });
  const context = (await menuItems(page)).map((item) => item.text);
  for (const label of [
    "Cut",
    "Copy",
    "Paste",
    "Paste as plain text",
    "Comment",
    "Link",
    "Turn into",
    "Delete block",
  ])
    assert(
      context.some((text) => text.startsWith(label)),
      `The context menu offers ${label}`,
    );
  await closeMenus(page);

  // The drag handle sits next to the text and shows in dark mode.
  await theme(page, "dark");
  const target = await rectOf(page, `${CONTENT} > p`);
  await page.mouse.move(target.left + 40, target.top + 6);
  await page.waitForSelector('button[aria-label="Block actions"]', {
    visible: true,
  });
  const handle = await page.$eval('button[aria-label="Block actions"]', (b) => {
    const rect = b.getBoundingClientRect();
    // As sRGB whatever the colour space: `oklch()` reads as its own numbers.
    const canvas = document.createElement("canvas").getContext("2d");
    if (canvas) {
      canvas.fillStyle = getComputedStyle(b).color;
      canvas.fillRect(0, 0, 1, 1);
    }
    const color = [...(canvas?.getImageData(0, 0, 1, 1).data ?? [])];
    return { right: rect.right, top: rect.top, color };
  });
  assert(
    handle.right <= target.left && handle.right >= target.left - 64,
    `The drag handle sits next to the text (${handle.right} vs ${target.left})`,
  );
  assert(
    (handle.color[0] ?? 0) > 100,
    "The drag handle is visible in dark mode",
  );
  assert(await page.$('button[aria-label="Insert a block below"]'));
  // The window scrolls, and a clip is measured from the top of the page.
  const scrolled = await page.evaluate(() => scrollY);
  await page.screenshot({
    path: resolve(output, "editor-controls-handle-1280-dark.png"),
    clip: {
      x: 0,
      y: Math.max(0, scrolled + target.top - 60),
      width: 1280,
      height: 200,
    },
  });
  await page.locator('button[aria-label="Block actions"]').click();
  const block = (await menuItems(page)).map((item) => item.text);
  for (const label of ["Turn into", "Duplicate", "Delete"])
    assert(
      block.some((text) => text.startsWith(label)),
      `The block menu offers ${label}`,
    );
  await closeMenus(page);
  await theme(page, "light");

  // Node toolbars wait for selection or focus.
  await page.mouse.move(4, 890);
  const standing = await page.$$eval(
    `${CONTENT} :is(.editor-image, [data-media-type]) button`,
    (buttons) =>
      buttons.filter(
        (button) =>
          button.textContent?.trim().startsWith("Edit") &&
          getComputedStyle(button).opacity !== "0" &&
          getComputedStyle(button).visibility !== "hidden",
      ).length,
  );
  assert.equal(standing, 0, "No Edit button stands on an unselected node");

  // AI and Listen, and nothing for developers.
  const ai = (await openToolbarMenu(page, "AI")).map((item) => item.text);
  assert.deepEqual(ai, ["Ask AI…", "Autocomplete", "AI settings…"]);
  const autocomplete = await page.$('[role="menu"] [role="menuitemcheckbox"]');
  assert(autocomplete, "Autocomplete is a check item");
  await closeMenus(page);
  await openToolbarMenu(page, "AI");
  await page.$$eval('[role="menuitem"]', (items) =>
    (
      items.find((item) => item.textContent?.includes("Ask AI…")) as
        | HTMLElement
        | undefined
    )?.focus(),
  );
  await page.keyboard.press("Enter");
  await page.waitForSelector('[role="tablist"]');
  const sidebar = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) =>
      tab.textContent?.trim(),
    ),
    text: document.querySelector("aside")?.textContent ?? "",
    fresh: Boolean(
      document.querySelector('button[aria-label="New conversation"]'),
    ),
  }));
  assert(!sidebar.tabs.includes("Debug"), "No Debug tab without the flag");
  assert(sidebar.text.includes("AI assistant"));
  assert(sidebar.fresh, "A labelled New conversation button");
  assert(
    await page.$('button[aria-label="Play from cursor"]'),
    "The play button says what it does",
  );
  assert(
    !(await page.$(`${TOOLBAR} button[aria-label="Developer tools"]`)),
    "No developer tools without the flag",
  );
  await open(page, fixtureId, "?developer=on");
  assert(
    await page.$(`${TOOLBAR} button[aria-label="Developer tools"]`),
    "The developer flag shows the developer tools",
  );
  await page.evaluate(() => localStorage.removeItem("lexidraw-developer"));

  // The emoji typeahead at the right edge of a phone.
  await page.setViewport({ width: 375, height: 812 });
  await open(page, fixtureId);
  await select(page, `${CONTENT} > p`);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 40; i++) {
    const x = await page.evaluate(
      () =>
        window.getSelection()?.getRangeAt(0).getBoundingClientRect().right ?? 0,
    );
    if (x > 375 - 70) break;
    await page.keyboard.type("ab ");
  }
  await page.keyboard.type(":smi");
  await page.waitForSelector('[role="listbox"] [role="option"]', {
    visible: true,
  });
  await pause(200);
  const emoji = await page.evaluate(() => {
    // Lexical keeps an empty anchor per typeahead plugin; only the one with
    // options is the menu.
    const lists = [...document.querySelectorAll('[role="listbox"]')].filter(
      (list) => list.querySelector('[role="option"]'),
    );
    const option = lists[0]?.querySelector('[role="option"]');
    const rect = option?.parentElement?.getBoundingClientRect();
    return {
      lists: lists.map((list) => {
        const by = list.getAttribute("aria-labelledby");
        return by
          ? document.getElementById(by)?.textContent
          : list.getAttribute("aria-label");
      }),
      nested: document.querySelectorAll('[role="listbox"] [role="listbox"]')
        .length,
      left: rect?.left ?? -1,
      right: rect?.right ?? -1,
      width: rect?.width ?? 0,
      label: option?.textContent ?? "",
      selected: lists[0]?.querySelectorAll('[aria-selected="true"]').length,
    };
  });
  assert.deepEqual(
    emoji.lists,
    ["Emoji"],
    "One listbox, named for what it lists",
  );
  assert.equal(emoji.nested, 0, "No listbox inside another");
  assert(emoji.width >= 192, "The emoji menu is at least 12rem wide");
  assert(emoji.left >= 0 && emoji.right <= 375, "It stays on screen");
  assert.match(emoji.label, /\p{L}{3,}/u, "Rows read as labels");
  assert.equal(emoji.selected, 1, "One row is highlighted");
  await page.screenshot({
    path: resolve(output, "editor-controls-emoji-375.png"),
  });
  await page.keyboard.press("Escape");

  // Touch: every block action without hover or double-click.
  await page.setViewport({ width: 768, height: 1024, hasTouch: true });
  await open(page, fixtureId);
  assert(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "The touch viewport reports a coarse pointer",
  );
  const propertyEdits = () =>
    page.$$eval('.document-header button[aria-label^="Edit "]', (buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        return style.visibility === "visible" && style.opacity !== "0";
      }),
    );
  const hidden = await propertyEdits();
  assert(
    hidden.length > 0 && hidden.every((shown) => !shown),
    "A property's Edit stays out of sight on touch until asked for",
  );
  await tap(page, ".document-header button[aria-controls]");
  assert(
    (await propertyEdits()).every(Boolean),
    "One header action shows every property's Edit",
  );
  await tap(page, '.document-header button[aria-label^="Edit "]');
  assert(
    await page.$('.document-header input[aria-label="Property name"]'),
    "Edit opens the property",
  );
  await open(page, fixtureId);
  await tap(page, `${CONTENT} p`);
  assert(!(await page.$(`${FLOATING}`)), "No selection toolbar on touch");
  const blockMenu = (await openToolbarMenu(page, "Block")).map((i) => i.text);
  for (const label of ["Turn into", "Duplicate", "Move up", "Move down"])
    assert(
      blockMenu.some((text) => text.startsWith(label)),
      `Touch reaches ${label}`,
    );
  await closeMenus(page);
  await tap(page, `${CONTENT} code`);
  assert(
    await page.$eval(
      'button[aria-label="Copy code"]',
      (b) => getComputedStyle(b).opacity !== "0",
    ),
    "Code copy shows on touch",
  );
  await tap(page, `${CONTENT} td`);
  const cellButton = await rectOf(
    page,
    'button[aria-label="Table cell actions"]',
  );
  assert(
    cellButton.width >= 44 && cellButton.height >= 44,
    "The table cell menu is a 44px target on touch",
  );
  await tap(page, `${CONTENT} .editor-equation`);
  assert(
    await page.$(`${CONTENT} .editor-equation :is(input, textarea)`),
    "A tap opens the equation editor",
  );
  await open(page, fixtureId);
  for (const [node, name] of [
    [".editor-image", "Edit image"],
    ['[data-media-type="excalidraw"]', "Edit drawing"],
    ['[data-media-type="mermaid"]', "Edit diagram"],
    ['[data-media-type="chart"]', "Edit chart"],
    [".slide-deck-container", "Edit slides"],
  ] as const) {
    await tap(page, `${CONTENT} ${node}`);
    const button = await rectOf(
      page,
      `${CONTENT} button[aria-label="${name}"]`,
    );
    assert(
      button.width >= 44 && button.height >= 44,
      `${name} is a 44px target on touch`,
    );
    await tap(page, `${CONTENT} button[aria-label="${name}"]`);
    // The drawing editor is Excalidraw's own full-screen surface.
    await page.waitForSelector('[role="dialog"], .excalidraw', {
      timeout: 5000,
    });
    await page.screenshot({
      path: resolve(output, `editor-controls-touch-${name.split(" ")[1]}.png`),
    });
    await open(page, fixtureId);
  }
  await page.setViewport({ width: 1280, height: 900, hasTouch: false });
  console.log("Editor controls fit, show their state and work by touch");
}
