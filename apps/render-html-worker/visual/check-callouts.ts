import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";

const CONTENT = ".document-content";
const TOOLBAR = '[role="toolbar"][aria-label="Formatting"]';
const HEADER = ".callout > .callout-header";
const MENU = '[role="dialog"][aria-label="Callout"]';
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A tip titled "Handy" between two lines. */
export const CALLOUTS_MARKDOWN = "Before\n\n> [!TIP] Handy\n> Inside\n\nAfter";

/** Each callout's kind and the title its header shows. */
const callouts = (page: Page) =>
  page.$$eval(".callout", (all) =>
    all.map((callout) => ({
      kind: callout.getAttribute("data-callout-kind"),
      title: callout.querySelector(".callout-title")?.textContent,
      body: callout.querySelector(".callout-body")?.textContent,
    })),
  );

async function openMenu(page: Page) {
  await page.click(HEADER);
  await page.waitForSelector(MENU, { timeout: 5000 });
  await pause(250);
}

/** Whether the editor has focus again, as after the menu closes. */
const editorFocused = (page: Page) =>
  page.evaluate(
    (content) => document.activeElement?.matches(content) ?? false,
    CONTENT,
  );

async function setEditable(page: Page, editable: boolean) {
  await page.evaluate((editable) => {
    const root = document.querySelector<
      HTMLElement & { __lexicalEditor?: { setEditable(on: boolean): void } }
    >(".document-content[contenteditable]");
    root?.__lexicalEditor?.setEditable(editable);
  }, editable);
  await page.waitForSelector(
    `.document-content[contenteditable="${editable}"]`,
  );
  await pause(200);
}

/**
 * A callout's icon and title open a menu that changes its kind and title or
 * removes it, keeping what it says; Insert > Callout puts one in at once;
 * and a read-only document's callout header is not a control.
 */
export async function checkCallouts(page: Page, id: string) {
  await page.goto(`${appUrl}/documents/${id}`, { waitUntil: "networkidle2" });
  await page.waitForSelector(HEADER);
  await pause(400);

  const header = await page.$eval(HEADER, (element) => ({
    role: element.getAttribute("role"),
    popup: element.getAttribute("aria-haspopup"),
    name: element.getAttribute("aria-label"),
    cursor: getComputedStyle(element).cursor,
  }));
  assert.deepEqual(
    header,
    {
      role: "button",
      popup: "dialog",
      name: "Handy: change the callout's kind or title",
      cursor: "pointer",
    },
    "An editable callout's header is the button for its menu",
  );

  // Picking a kind changes it at once, and the menu stays to go on with.
  await openMenu(page);
  const kinds = await page.$$eval(`${MENU} [role="radio"]`, (radios) =>
    radios.map((radio) => ({
      name: radio.textContent?.trim(),
      checked: radio.getAttribute("aria-checked"),
    })),
  );
  assert.deepEqual(
    kinds,
    [
      { name: "Note", checked: "false" },
      { name: "Tip", checked: "true" },
      { name: "Important", checked: "false" },
      { name: "Warning", checked: "false" },
      { name: "Caution", checked: "false" },
    ],
    "The menu offers the five kinds, the callout's own checked",
  );
  // A radio group: Tab reaches only the checked kind, arrows move between them.
  await page.keyboard.press("ArrowDown");
  assert.deepEqual(
    await page.$$eval(`${MENU} [role="radio"]`, (radios) =>
      radios.map((radio) => ({
        tabIndex: radio.tabIndex,
        focused: radio === document.activeElement,
      })),
    ),
    [
      { tabIndex: -1, focused: false },
      { tabIndex: 0, focused: false },
      { tabIndex: -1, focused: true },
      { tabIndex: -1, focused: false },
      { tabIndex: -1, focused: false },
    ],
    "ArrowDown from Tip focuses Important, and only the checked kind is tabbable",
  );
  const warning = await page.$(`${MENU} [role="radio"]:nth-child(4)`);
  await warning?.click();
  await pause(250);
  assert.deepEqual(
    await callouts(page),
    [{ kind: "warning", title: "Handy", body: "Inside" }],
    "Picking Warning makes the callout a warning",
  );

  // The title field saves on Enter, and the menu hands focus back.
  const title = await page.$(`${MENU} input[name="title"]`);
  assert.equal(
    await title?.evaluate((input) => input.getAttribute("placeholder")),
    "Warning",
    "The title field's placeholder is the kind's name",
  );
  await title?.click({ count: 3 });
  await page.keyboard.type("Mind the gap");
  await page.keyboard.press("Enter");
  await pause(300);
  assert.equal(await page.$(MENU), null, "Enter in the title closes the menu");
  assert.deepEqual(await callouts(page), [
    { kind: "warning", title: "Mind the gap", body: "Inside" },
  ]);
  assert(await editorFocused(page), "Closing the menu focuses the editor");

  // Escape leaves the title as it was; a cleared title shows the kind.
  await openMenu(page);
  await page.click(`${MENU} input[name="title"]`, { count: 3 });
  await page.keyboard.type("Not kept");
  await page.keyboard.press("Escape");
  await pause(300);
  assert.equal(await page.$(MENU), null, "Escape closes the menu");
  assert(await editorFocused(page), "Escape focuses the editor");
  assert.equal((await callouts(page))[0]?.title, "Mind the gap");
  await openMenu(page);
  await page.click(`${MENU} input[name="title"]`, { count: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await pause(300);
  assert.equal(
    (await callouts(page))[0]?.title,
    "Warning",
    "A callout without a title shows its kind",
  );

  // Removing the callout keeps what it said.
  await openMenu(page);
  await page.click(`${MENU} button[name="remove"]`);
  await pause(300);
  assert.deepEqual(await callouts(page), [], "Remove callout removes it");
  assert.deepEqual(
    await page.$$eval(`${CONTENT} > p`, (lines) =>
      lines.map((line) => line.textContent),
    ),
    ["Before", "Inside", "After"],
    "Its text stays, as ordinary lines",
  );

  // Insert > Callout puts a note in at once, with the caret inside.
  await page.evaluate((content) => {
    const last = [...document.querySelectorAll(`${content} > p`)].at(-1);
    const text = last?.firstChild?.firstChild ?? last?.firstChild;
    if (!text) return;
    last?.closest<HTMLElement>("[contenteditable]")?.focus();
    getSelection()?.setBaseAndExtent(
      text,
      text.textContent?.length ?? 0,
      text,
      text.textContent?.length ?? 0,
    );
  }, CONTENT);
  await pause(200);
  await page.click(`${TOOLBAR} button[aria-label="Insert"]`);
  const item = await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[role="menuitem"]')].find(
        (each) => each.textContent?.trim() === "Callout",
      ),
    { timeout: 5000 },
  );
  await item.asElement()?.click();
  await pause(400);
  assert.equal(
    await page.$('[role="dialog"]'),
    null,
    "Inserting a callout asks nothing",
  );
  await page.keyboard.type("Typed");
  await pause(300);
  assert.deepEqual(
    await callouts(page),
    [{ kind: "note", title: "Note", body: "Typed" }],
    "Insert > Callout makes a note with the caret inside",
  );

  // Read-only, the header is plain text again.
  await setEditable(page, false);
  const readOnly = await page.$eval(HEADER, (element) => ({
    role: element.getAttribute("role"),
    cursor: getComputedStyle(element).cursor,
  }));
  assert.deepEqual(
    readOnly,
    { role: null, cursor: "default" },
    "A read-only callout's header is no control",
  );
  await page.click(HEADER);
  await pause(300);
  assert.equal(await page.$(MENU), null, "Read-only, the header opens nothing");
  await setEditable(page, true);
}

/** A callout whose title wraps, and one with a title and nothing else. */
export const CALLOUT_LAYOUT_MARKDOWN = [
  "> [!WARNING] A very long callout title that keeps going and going and going, so that it has to wrap onto a second line on a phone and on a laptop alike · 長いタイトル",
  "> Body.",
  "",
  "> [!INFO] Obsidian info alias",
  "",
  "> [!TIP] Tip",
  "> Body.",
  "",
  "> [!IMPORTANT] Important",
  "> Body.",
  "",
  "> [!CAUTION] Caution",
  "> Body.",
].join("\n");

/**
 * Each callout's kind and the WCAG contrast of its title on its tint over
 * the page, the colours composited by painting them as the page does.
 */
const titleContrasts = (page: Page) =>
  page.$$eval(".callout", (all) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const paint = (colours: string[]) => {
      if (!context) return [0, 0, 0];
      context.clearRect(0, 0, 1, 1);
      for (const colour of ["#fff", ...colours]) {
        context.fillStyle = colour;
        context.fillRect(0, 0, 1, 1);
      }
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const luminance = (rgb: number[]) => {
      const [r = 0, g = 0, b = 0] = rgb.map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return all.map((callout) => {
      const backgrounds: string[] = [];
      for (let at: Element | null = callout; at; at = at.parentElement)
        backgrounds.unshift(getComputedStyle(at).backgroundColor);
      const title = callout.querySelector(".callout-title");
      const text = luminance(
        paint([...backgrounds, title ? getComputedStyle(title).color : ""]),
      );
      const ground = luminance(paint(backgrounds));
      const contrast =
        (Math.max(text, ground) + 0.05) / (Math.min(text, ground) + 0.05);
      return {
        kind: callout.getAttribute("data-callout-kind"),
        contrast: Math.round(contrast * 100) / 100,
      };
    });
  });

/** Where a callout's header and body sit, by the callout's index. */
const layout = (page: Page, index: number) =>
  page.$$eval(
    ".callout",
    (all, index) => {
      const callout = all[index];
      const box = (selector: string) => {
        const element = selector ? callout?.querySelector(selector) : callout;
        if (!element) return null;
        const { top, bottom, height } = element.getBoundingClientRect();
        return { top, bottom, height };
      };
      const title = callout?.querySelector(".callout-title");
      return {
        callout: box(""),
        header: box(":scope > .callout-header"),
        icon: box(".callout-icon"),
        title: box(".callout-title"),
        body: box(":scope > .callout-body"),
        lineHeight: title
          ? Number.parseFloat(getComputedStyle(title).lineHeight)
          : 0,
      };
    },
    index,
  );

/**
 * A wrapping title keeps its icon beside its first line, and a callout with
 * only a title is just its header once nothing can be typed into it.
 */
export async function checkCalloutLayout(page: Page, id: string) {
  await page.goto(`${appUrl}/documents/${id}`, { waitUntil: "networkidle2" });
  await page.waitForSelector(HEADER);
  await pause(400);
  for (const width of [1280, 375]) {
    await page.setViewport({ width, height: 900 });
    await pause(300);
    const long = await layout(page, 0);
    assert.ok(
      long.title && long.title.height > long.lineHeight * 1.5,
      `The long title wraps at ${width}`,
    );
    const iconMiddle = long.icon ? (long.icon.top + long.icon.bottom) / 2 : 0;
    const firstLineMiddle = (long.title?.top ?? 0) + long.lineHeight / 2;
    assert.ok(
      Math.abs(iconMiddle - firstLineMiddle) <= 1,
      `At ${width}, the icon sits beside the title's first line, not its middle (${iconMiddle} vs ${firstLineMiddle})`,
    );

    const editable = await layout(page, 1);
    assert.ok(
      (editable.body?.height ?? 0) > 0,
      `At ${width}, an editable title-only callout keeps a line to type into`,
    );
    await setEditable(page, false);
    const { callout, header, body } = await layout(page, 1);
    assert.ok(callout && header && body, "The title-only callout is drawn");
    assert.equal(
      body.height,
      0,
      `At ${width}, a read-only title-only callout shows no empty body`,
    );
    assert.ok(
      Math.abs(header.top - callout.top - (callout.bottom - header.bottom)) <=
        1,
      `At ${width}, its header is padded alike above and below`,
    );
    await setEditable(page, true);
  }
  await page.setViewport({ width: 1280, height: 900 });

  // #241: every kind's title reads at AA contrast on its tint.
  const under: string[] = [];
  for (const dark of [false, true]) {
    await page.evaluate((dark) => {
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
    }, dark);
    await pause(200);
    for (const { kind, contrast } of await titleContrasts(page))
      if (contrast < 4.5)
        under.push(`${kind} ${dark ? "dark" : "light"} ${contrast}:1`);
  }
  assert.deepEqual(under, [], "Every callout title reads at AA's 4.5:1");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
}
