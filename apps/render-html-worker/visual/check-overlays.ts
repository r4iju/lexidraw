import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";
import { signInToDev } from "./check-typography";

const CONTENT = '[id^="lexical-content-"]';
const BAR = '[role="toolbar"][data-bar-mode]';
const PHONE = { width: 375, height: 812, hasTouch: true, isMobile: true };
const TABLET = { width: 768, height: 1024, hasTouch: true, isMobile: true };
const DESKTOP = { width: 1280, height: 900 };

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Box = { left: number; right: number; top: number; bottom: number };

async function open(page: Page, path: string) {
  await page.evaluate(() => localStorage.removeItem("lexidraw.sidebar"));
  await page.goto(`${appUrl}${path}`, { waitUntil: "networkidle2" });
  // The dev overlay's badge sits over the phone bar's first buttons.
  await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
  await pause(500);
}

async function openDocument(page: Page, id: string) {
  await open(page, `/documents/${id}`);
  await page.waitForSelector(`${CONTENT} > p`);
}

function rect(page: Page, selector: string): Promise<Box> {
  return page.$eval(selector, (element) => {
    const { left, right, top, bottom } = element.getBoundingClientRect();
    return { left, right, top, bottom };
  });
}

/** Presses what `selector` finds, whose text starts with `text` if given. */
async function press(page: Page, selector: string, text?: string) {
  const handle = await page.evaluateHandle(
    (selector, text) =>
      [...document.querySelectorAll<HTMLElement>(selector)].find(
        (element) =>
          element.getClientRects().length > 0 &&
          (text === undefined || element.textContent?.trim().startsWith(text)),
      ) ?? null,
    selector,
    text,
  );
  const element = handle.asElement();
  assert(element, `Missing ${selector}${text ? ` “${text}”` : ""}`);
  const box = await element.boundingBox();
  assert(box, `${selector} is not rendered`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (page.viewport()?.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await pause(400);
}

/** The menus open now, with the ones hidden behind a submenu left out. */
function visibleMenus(page: Page) {
  return page.$$eval('[role="menu"]', (menus) =>
    menus
      .filter((menu) => getComputedStyle(menu).visibility !== "hidden")
      .map((menu) => {
        const { left, right, top, bottom } = menu.getBoundingClientRect();
        return {
          box: { left, right, top, bottom },
          items: [...menu.querySelectorAll('[role^="menuitem"]')]
            .filter((item) => item.closest('[role="menu"]') === menu)
            .map((item) => item.textContent?.trim() ?? ""),
        };
      }),
  );
}

function assertSheet(box: Box, what: string) {
  const { width, height } = PHONE;
  assert(
    Math.abs(box.left) < 1 && Math.abs(box.right - width) < 1,
    `${what} spans the phone (${box.left}–${box.right})`,
  );
  assert(
    Math.abs(box.bottom - height) < 1,
    `${what} sits on the bottom edge (${box.bottom})`,
  );
}

async function assertNoSideways(page: Page, where: string) {
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  const viewport = page.viewport()?.width ?? 0;
  assert(
    width <= viewport,
    `${where} does not scroll sideways (${width}px > ${viewport}px)`,
  );
}

/** Controls a finger can reach in `root` that are smaller than 44px. */
function smallTargets(page: Page, root: string) {
  return page.$$eval(
    `${root} :is(button, a[href], [role="menuitem"], [role="menuitemcheckbox"], [role="tab"], input[type="checkbox"])`,
    (controls) =>
      controls
        .filter((control) => {
          if (control.closest("[inert], [aria-hidden='true']")) return false;
          const style = getComputedStyle(control);
          if (style.visibility === "hidden" || style.display === "none")
            return false;
          const { width, height } = control.getBoundingClientRect();
          return width > 0 && height > 0 && (width < 43.5 || height < 43.5);
        })
        .map((control) => {
          const { width, height } = control.getBoundingClientRect();
          const name =
            control.getAttribute("aria-label") ??
            control.textContent?.trim().slice(0, 30) ??
            control.tagName;
          return `${name} ${Math.round(width)}×${Math.round(height)}`;
        }),
  );
}

/** Selects the first `length` characters of the first long paragraph. */
async function selectText(page: Page, length: number) {
  await page.evaluate(
    (content, length) => {
      const paragraph = [
        ...document.querySelectorAll<HTMLElement>(`${content} > p`),
      ].find((p) => (p.textContent?.length ?? 0) > 60);
      let text: Node | null = null;
      if (paragraph) {
        const walker = document.createTreeWalker(
          paragraph,
          NodeFilter.SHOW_TEXT,
        );
        do text = walker.nextNode();
        while (text && (text.textContent?.length ?? 0) <= length);
      }
      if (!paragraph || !text) throw new Error("No paragraph to select in");
      paragraph.scrollIntoView({ block: "center" });
      paragraph.closest<HTMLElement>("[contenteditable]")?.focus();
      window.getSelection()?.setBaseAndExtent(text, 0, text, length);
    },
    CONTENT,
    length,
  );
  await pause(300);
}

async function footerOrder(page: Page) {
  return page.$eval('[role="dialog"]', (dialog) => {
    const cancel = [...dialog.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Cancel",
    );
    const primary = cancel?.nextElementSibling;
    return {
      cancel: Boolean(cancel),
      primary: primary?.textContent?.trim() ?? "",
      last: primary ? primary.nextElementSibling === null : false,
    };
  });
}

async function closeDialog(page: Page) {
  await page.keyboard.press("Escape");
  await pause(400);
  assert(!(await page.$('[role="dialog"]')), "Escape closes the dialog");
}

/**
 * Overlays by device: phone sheets that drill down, a bar above the keyboard
 * that follows the selection, tablet drawers with 44px targets, and dialogs
 * sized for what they hold with Cancel before the primary.
 */
export async function checkOverlays(
  page: Page,
  fixtureId: string,
  output: string,
) {
  if (!page.listenerCount("dialog"))
    page.on("dialog", (dialog) => void dialog.accept());
  await page.bringToFront();
  await signInToDev(page);

  // Phone: the bar, and what it opens as sheets.
  await page.setViewport(PHONE);
  await openDocument(page, fixtureId);
  await assertNoSideways(page, "A document at 375px");
  await page.waitForSelector(BAR);
  const bar = await rect(page, BAR);
  assert(
    Math.abs(bar.bottom - PHONE.height) < 1 && bar.left === 0,
    "The phone bar sits on the bottom edge",
  );
  assert(bar.bottom - bar.top >= 44, "The phone bar is 44px tall");
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--keyboard-inset", "300px"),
  );
  await pause(100);
  assert(
    Math.abs((await rect(page, BAR)).bottom - (PHONE.height - 300)) < 1,
    "The bar rides on top of the keyboard",
  );
  await page.evaluate(() =>
    document.documentElement.style.removeProperty("--keyboard-inset"),
  );
  await selectText(page, 12);
  assert.equal(
    await page.$eval(BAR, (bar) => bar.getAttribute("data-bar-mode")),
    "selection",
    "A text selection turns the bar to formatting it",
  );
  await page.screenshot({ path: resolve(output, "overlays-bar-375.png") });

  await selectText(page, 0);
  await press(page, `${BAR} button[aria-label="Insert"]`);
  const [insert] = await visibleMenus(page);
  assert(insert, "Insert opens a menu");
  assertSheet(insert.box, "Insert");
  await assertNoSideways(page, "The Insert sheet");
  await page.screenshot({ path: resolve(output, "overlays-insert-375.png") });
  await page.keyboard.press("Escape");
  await pause(300);

  await press(page, 'button[aria-label="Document actions"]');
  const [actions] = await visibleMenus(page);
  assert(actions, "⋯ opens the document actions");
  assertSheet(actions.box, "The document actions");
  for (const item of ["Share", "Table of contents", "Comments", "Export"])
    assert(
      actions.items.some((text) => text.startsWith(item)),
      `The phone ⋯ sheet offers ${item}`,
    );
  assert(
    actions.items.at(-1)?.startsWith("Delete"),
    "Delete is the last of the document actions",
  );
  await press(page, '[role="menuitem"]', "Export");
  const exportMenus = await visibleMenus(page);
  assert.equal(exportMenus.length, 1, "Export takes the sheet's place");
  const [exported] = exportMenus;
  assert(exported, "Export opens");
  assert.equal(exported.items[0], "Back", "The drilled-down sheet leads back");
  assert(
    exported.items.some((text) => text.startsWith("PDF")),
    "Export offers PDF",
  );
  assertSheet(exported.box, "Export");
  await page.screenshot({ path: resolve(output, "overlays-export-375.png") });
  await press(page, '[role="menuitem"]', "Back");
  assert(
    (await visibleMenus(page))[0]?.items.some((text) =>
      text.startsWith("Export"),
    ),
    "Back returns to the document actions",
  );
  await page.keyboard.press("Escape");
  await pause(300);

  // Phone: a sidebar is a half sheet; Escape closes it; a jump closes the TOC.
  const TOC = 'aside[aria-label="Table of Contents"]';
  const openContents = async () => {
    await press(page, 'button[aria-label="Document actions"]');
    await press(page, '[role="menuitemcheckbox"]', "Table of contents");
    await page.waitForSelector(TOC);
    await pause(300);
  };
  await openContents();
  const toc = await rect(page, TOC);
  assertSheet(toc, "The table of contents");
  assert(
    Math.abs(toc.bottom - toc.top - PHONE.height / 2) < 2,
    "The table of contents opens at half height",
  );
  assert(
    await page.$eval(TOC, (aside) => aside.contains(document.activeElement)),
    "Focus moves into the sidebar",
  );
  await page.screenshot({ path: resolve(output, "overlays-toc-375.png") });
  await page.keyboard.press("Escape");
  await pause(300);
  assert(!(await page.$(TOC)), "Escape closes the sidebar");
  await openContents();
  const before = await page.evaluate(() => scrollY);
  await press(page, `${TOC} nav a, ${TOC} nav button`, "Heading three");
  await pause(600);
  assert(!(await page.$(TOC)), "Choosing a heading closes the contents");
  assert(
    (await page.evaluate(() => scrollY)) !== before,
    "Choosing a heading scrolls to it",
  );

  // Phone: the emoji typeahead is a strip of chips above the keyboard.
  await selectText(page, 0);
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type(":smi");
  await page.waitForSelector('[role="listbox"] [role="option"]', {
    visible: true,
  });
  await pause(200);
  const strip = await page.evaluate(() => {
    const list = [...document.querySelectorAll('[role="listbox"]')].find(
      (candidate) => candidate.querySelector('[role="option"]'),
    );
    const options = [...(list?.querySelectorAll('[role="option"]') ?? [])];
    const tops = new Set(
      options.map((option) => Math.round(option.getBoundingClientRect().top)),
    );
    const first = options[0]?.getBoundingClientRect();
    const box = list?.getBoundingClientRect();
    return {
      rows: tops.size,
      height: first?.height ?? 0,
      left: box?.left ?? -1,
      right: box?.right ?? -1,
    };
  });
  assert.equal(strip.rows, 1, "Emoji suggestions line up in one strip");
  assert(strip.height >= 44, "Each emoji chip is a 44px target");
  assert(
    strip.left >= 0 && strip.right <= PHONE.width,
    "The strip stays on screen",
  );
  await page.screenshot({ path: resolve(output, "overlays-emoji-375.png") });
  await page.keyboard.press("Escape");

  for (const path of ["/dashboard", "/settings"]) {
    await open(page, path);
    await assertNoSideways(page, `${path} at 375px`);
  }

  // Tablet with touch: sidebars are drawers over a scrim; targets are 44px.
  await page.setViewport(TABLET);
  await openDocument(page, fixtureId);
  await assertNoSideways(page, "A document at 768px");
  const column = await rect(page, CONTENT);
  await press(page, 'header button[aria-label="Table of contents"]');
  await page.waitForSelector(TOC);
  await pause(300);
  const drawer = await rect(page, TOC);
  assert(
    Math.abs(drawer.right - TABLET.width) < 1 &&
      Math.abs(drawer.right - drawer.left - 360) < 1,
    `The tablet contents is a 360px drawer (${drawer.left}–${drawer.right})`,
  );
  assert(
    await page.$('[aria-label="Close Table of Contents"]:not(header *)'),
    "A scrim sits behind the drawer",
  );
  const after = await rect(page, CONTENT);
  assert.equal(after.left, column.left, "The drawer does not push the page");
  const small = [
    ...(await smallTargets(page, "header")),
    ...(await smallTargets(page, '[role="toolbar"][aria-label="Formatting"]')),
    ...(await smallTargets(page, TOC)),
  ];
  assert.deepEqual(small, [], "Every target is 44px under a finger");
  await page.screenshot({ path: resolve(output, "overlays-drawer-768.png") });
  await page.keyboard.press("Escape");
  await pause(300);
  assert(!(await page.$(TOC)), "Escape closes the drawer");

  // Desktop: dialogs sized to what they hold, Cancel before the primary.
  await page.setViewport(DESKTOP);
  await openDocument(page, fixtureId);
  await page.$eval(`${CONTENT} [data-media-type="mermaid"]`, (node) =>
    node.scrollIntoView({ block: "center" }),
  );
  await press(page, `${CONTENT} [data-media-type="mermaid"]`);
  await press(page, `${CONTENT} button[aria-label="Edit diagram"]`);
  await page.waitForSelector('[role="dialog"]');
  await pause(300);
  const mermaid = await rect(page, '[role="dialog"]');
  assert.equal(
    Math.round(mermaid.right - mermaid.left),
    1024,
    "At 1280px the diagram editor is 1024px wide",
  );
  assert.equal(
    await page.$$eval("[data-backdrop]", (backdrops) => backdrops.length),
    1,
    "One backdrop behind the dialog",
  );
  const order = await footerOrder(page);
  assert(
    order.cancel && order.last && order.primary === "Save diagram",
    `The diagram editor ends Cancel, Save diagram (${JSON.stringify(order)})`,
  );
  await page.screenshot({ path: resolve(output, "overlays-mermaid-1280.png") });
  await closeDialog(page);

  await press(page, 'button[aria-label="Document actions"]');
  await press(page, '[role="menuitem"]', "Import");
  const importFile = resolve(output, "overlays-import.md");
  await writeFile(importFile, "# Imported\n\nA paragraph.\n");
  const [chooser] = await Promise.all([
    page.waitForFileChooser(),
    press(page, '[role="menuitem"]', "Markdown"),
  ]);
  await chooser.accept([importFile]);
  await page.waitForSelector('[role="dialog"]');
  await pause(300);
  const markdown = await rect(page, '[role="dialog"]');
  assert.equal(
    Math.round(markdown.right - markdown.left),
    768,
    "Import Markdown opens at 768px",
  );
  assert((await footerOrder(page)).cancel, "Import Markdown has a Cancel");
  await closeDialog(page);

  // Phone: a dialog is a sheet with its footer stacked.
  await page.setViewport(PHONE);
  await openDocument(page, fixtureId);
  await press(page, 'button[aria-label="Document actions"]');
  await press(page, '[role="menuitem"]', "Rename");
  await page.waitForSelector('[role="dialog"]');
  await pause(300);
  const rename = await rect(page, '[role="dialog"]');
  assertSheet(rename, "A dialog on a phone");
  assert.notEqual(
    await page.evaluate(() => document.activeElement?.tagName),
    "INPUT",
    "No field takes focus, and the keyboard, before it is tapped",
  );
  await page.screenshot({ path: resolve(output, "overlays-dialog-375.png") });
  await closeDialog(page);

  await page.setViewport(DESKTOP);
  console.log(
    "Overlays: phone sheets drill down, the bar follows the selection, tablet drawers and dialogs fit",
  );
}
